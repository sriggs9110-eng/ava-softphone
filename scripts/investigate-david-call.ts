/**
 * Read-only investigation: find missing call recordings for a given user.
 *
 * Written for David Madison (david@connectwithava.com) whose ~20-min call
 * on 2026-04-22 didn't appear in Pepper's history UI. Parameterized so it
 * can be reused for any user with a SIP credential username + day.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/investigate-david-call.ts
 *
 * Constants at the top control the target user + window. This script
 * performs READ-ONLY queries against Telnyx and Supabase — no mutations.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const TARGET_SIP_USERNAME = "gencredCQQE4wTVhpVBubrVWay2Wn7CTbTUhAOVJpwMga6OQx";
const TARGET_EMAIL = "david@connectwithava.com";
const WINDOW_START = "2026-04-22T00:00:00Z";
const WINDOW_END = "2026-04-23T00:00:00Z";
const MIN_DURATION_SECONDS = 15 * 60; // 15 minutes
const CALL_CONTROL_APP_ID = "2922071721655666224";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TELNYX_API = "https://api.telnyx.com/v2";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(1);
  }
  return v;
}

async function tget(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`${TELNYX_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    return { _status: res.status, _body: body };
  }
  return body;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

// ---------------------------------------------------------------------------
// Phase 1: Telnyx — list calls in window
// ---------------------------------------------------------------------------

async function phase1ListCalls(apiKey: string): Promise<any[]> {
  console.log("\n=== Phase 1: Telnyx /v2/calls ===");

  // Telnyx's /v2/calls is for active calls only in most accounts.
  // For historical calls we need /v2/detail_records (CDRs). The valid
  // record_type values are "call" (Telnyx Call Control calls). Try a
  // few shapes in order and report what's usable.
  const attempts: Array<{ label: string; path: string }> = [
    {
      label: "detail_records — record_type=call",
      path: `/detail_records?filter[record_type]=call&filter[start_time][gte]=${WINDOW_START}&filter[start_time][lte]=${WINDOW_END}&page[size]=250`,
    },
    {
      label: "detail_records — record_type=calls",
      path: `/detail_records?filter[record_type]=calls&filter[start_time][gte]=${WINDOW_START}&filter[start_time][lte]=${WINDOW_END}&page[size]=250`,
    },
    {
      label: "legacy call events",
      path: `/reporting/call_events?filter[connection_id]=${CALL_CONTROL_APP_ID}&filter[start_time][gte]=${WINDOW_START}&filter[start_time][lte]=${WINDOW_END}&page[size]=250`,
    },
  ];

  for (const a of attempts) {
    const result = await tget(a.path, apiKey);
    if (result && result._status) {
      console.log(
        `[phase1] ${a.label} — HTTP ${result._status}:`,
        JSON.stringify(result._body).slice(0, 300)
      );
      continue;
    }
    const data = (result?.data || []) as any[];
    const meta = result?.meta;
    console.log(
      `[phase1] ${a.label} — ok, count=${data.length}, meta=${JSON.stringify(meta || {})}`
    );
    if (data.length > 0) {
      return data;
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Phase 2: Filter to candidates (>= 15 min, involving David's SIP username
// or David's likely from/to business numbers)
// ---------------------------------------------------------------------------

interface CandidateCall {
  id: string;
  call_control_id?: string | null;
  call_session_id?: string | null;
  call_leg_id_alias?: string | null;
  from?: string | null;
  to?: string | null;
  direction?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_seconds?: number | null;
  recording_id?: string | null;
  raw: any;
}

function normalizeRecord(rec: any): CandidateCall {
  // Normalize across CDR / detail_records / calls shapes.
  return {
    id: rec.id || rec.call_control_id || "",
    call_control_id: rec.call_control_id || rec.call_leg_id || null,
    call_session_id: rec.call_session_id || null,
    from: rec.from || rec.from_number || rec.source || null,
    to: rec.to || rec.to_number || rec.destination || null,
    direction: rec.direction || null,
    start_time: rec.start_time || rec.started_at || rec.created_at || null,
    end_time: rec.end_time || rec.ended_at || null,
    duration_seconds:
      rec.duration_seconds ??
      rec.duration ??
      (rec.billed_duration ? Number(rec.billed_duration) : null),
    recording_id: rec.recording_id || null,
    raw: rec,
  };
}

function phase2Filter(records: any[]): CandidateCall[] {
  console.log("\n=== Phase 2: filter 15+ min involving David ===");
  const cands: CandidateCall[] = [];
  for (const r of records) {
    const n = normalizeRecord(r);
    const dur = n.duration_seconds || 0;
    const fromStr = (n.from || "").toLowerCase();
    const toStr = (n.to || "").toLowerCase();
    const touchesDavid =
      fromStr.includes(TARGET_SIP_USERNAME.toLowerCase()) ||
      toStr.includes(TARGET_SIP_USERNAME.toLowerCase());
    if (dur < MIN_DURATION_SECONDS && !touchesDavid) continue;
    cands.push(n);
  }
  console.log(`[phase2] ${cands.length} candidate(s)`);
  for (const c of cands) {
    console.log(
      `  ccid=${c.call_control_id} session=${c.call_session_id} from=${c.from} to=${c.to} dur=${c.duration_seconds}s start=${c.start_time}`
    );
  }
  return cands;
}

// ---------------------------------------------------------------------------
// Phase 3: Supabase call_logs lookup for each candidate
// ---------------------------------------------------------------------------

async function phase3SupabaseLookup(cands: CandidateCall[]) {
  console.log("\n=== Phase 3: Supabase call_logs ===");
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Also print ALL rows for David's user on that day, for context.
  const { data: davidUser } = await admin
    .from("softphone_users")
    .select("id, email, full_name, sip_username")
    .eq("email", TARGET_EMAIL)
    .maybeSingle();
  console.log(
    `[phase3] David's user row:`,
    davidUser
      ? { id: davidUser.id, email: davidUser.email, sip_username: davidUser.sip_username }
      : "NOT FOUND"
  );

  if (davidUser?.id) {
    const { data: userRows } = await admin
      .from("call_logs")
      .select(
        "id, created_at, direction, status, call_control_id, external_ccid, call_session_id, phone_number, from_number, duration_seconds, recording_id, recording_url, transcript_status, ai_status"
      )
      .eq("user_id", davidUser.id)
      .gte("created_at", WINDOW_START)
      .lt("created_at", WINDOW_END)
      .order("created_at", { ascending: true });
    console.log(
      `[phase3] call_logs for David in window: ${userRows?.length ?? 0} rows`
    );
    for (const r of userRows || []) {
      console.log("  ", JSON.stringify(r));
    }
  }

  // Per-candidate lookup by ccid and session
  for (const c of cands) {
    console.log(`\n[phase3] candidate ccid=${c.call_control_id}`);
    if (c.call_control_id) {
      const { data } = await admin
        .from("call_logs")
        .select("*")
        .eq("call_control_id", c.call_control_id);
      console.log(`  by ccid: ${data?.length ?? 0} rows`, (data || []).map(d => d.id));
    }
    if (c.call_session_id) {
      const { data } = await admin
        .from("call_logs")
        .select("*")
        .eq("call_session_id", c.call_session_id);
      console.log(`  by session: ${data?.length ?? 0} rows`, (data || []).map(d => d.id));
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 4: Recording existence per candidate
// ---------------------------------------------------------------------------

async function phase4RecordingLookup(cands: CandidateCall[], apiKey: string) {
  console.log("\n=== Phase 4: Telnyx /v2/recordings per candidate ===");
  for (const c of cands) {
    const paths: string[] = [];
    if (c.call_control_id) {
      paths.push(`/recordings?filter[call_control_id]=${encodeURIComponent(c.call_control_id)}`);
    }
    if (c.call_session_id) {
      paths.push(`/recordings?filter[call_session_id]=${encodeURIComponent(c.call_session_id)}`);
    }
    if (c.call_leg_id_alias) {
      paths.push(`/recordings?filter[call_leg_id]=${encodeURIComponent(c.call_leg_id_alias)}`);
    }
    for (const p of paths) {
      const r = await tget(p, apiKey);
      if (r && r._status) {
        console.log(`[phase4] ${p} HTTP ${r._status}:`, JSON.stringify(r._body).slice(0, 300));
        continue;
      }
      const recs = (r?.data || []) as any[];
      console.log(
        `[phase4] ${p} → ${recs.length} recording(s)` +
          (recs[0]
            ? ` first=${JSON.stringify({
                id: recs[0].id,
                status: recs[0].status,
                download_urls: recs[0].download_urls,
                recording_started_at: recs[0].recording_started_at,
                recording_ended_at: recs[0].recording_ended_at,
              })}`
            : "")
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 1 fallback: look at ALL calls (no filter) if focused queries return
// nothing. Useful because the "from" filter doesn't accept SIP usernames and
// because the credential leg is INCOMING from Telnyx's POV.
// ---------------------------------------------------------------------------

async function phase1FallbackScan(apiKey: string): Promise<any[]> {
  console.log(
    "\n=== Phase 1b: fallback — dump all /v2/recordings for the window ==="
  );
  const all: any[] = [];
  // /v2/recordings supports filter[call_session_id] etc., but also a raw
  // window scan is fine for one day.
  const path = `/recordings?page[size]=250`;
  const r = await tget(path, apiKey);
  if (r && r._status) {
    console.log(`[phase1b] HTTP ${r._status}:`, JSON.stringify(r._body).slice(0, 500));
    return all;
  }
  const data = (r?.data || []) as any[];
  console.log(`[phase1b] /recordings returned ${data.length} rows total`);
  // Filter to window client-side.
  const start = new Date(WINDOW_START).getTime();
  const end = new Date(WINDOW_END).getTime();
  for (const rec of data) {
    const t = rec.recording_started_at || rec.created_at;
    const ts = t ? new Date(t).getTime() : 0;
    if (ts >= start && ts <= end) all.push(rec);
  }
  console.log(`[phase1b] in window: ${all.length} recordings`);
  for (const rec of all) {
    console.log(
      `  rec_id=${rec.id} call_leg_id=${rec.call_leg_id} call_session_id=${rec.call_session_id} ccid=${rec.call_control_id} duration=${rec.duration_millis ? Math.round(rec.duration_millis / 1000) : "?"}s started=${rec.recording_started_at}`
    );
  }
  return all;
}

async function collectDavidRecordingIds(): Promise<string[]> {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: davidUser } = await admin
    .from("softphone_users")
    .select("id")
    .eq("email", TARGET_EMAIL)
    .maybeSingle();
  if (!davidUser?.id) return [];
  const { data: rows } = await admin
    .from("call_logs")
    .select("recording_id")
    .eq("user_id", davidUser.id)
    .gte("created_at", WINDOW_START)
    .lt("created_at", WINDOW_END);
  return ((rows || []) as Array<{ recording_id: string | null }>)
    .map((r) => r.recording_id)
    .filter((r): r is string => Boolean(r));
}

// Look up specific recording_ids from Supabase and Telnyx for metadata.
async function lookupRecordingDetails(
  recordingIds: string[],
  apiKey: string
) {
  console.log("\n=== Recording detail lookup (from Supabase IDs) ===");
  for (const id of recordingIds) {
    if (!id) continue;
    const r = await tget(`/recordings/${id}`, apiKey);
    if (r && r._status) {
      console.log(`  rec ${id} → HTTP ${r._status}:`, JSON.stringify(r._body).slice(0, 300));
      continue;
    }
    const d = r?.data || {};
    const durSec = d.duration_millis ? Math.round(d.duration_millis / 1000) : null;
    console.log(
      `  rec ${id}: duration=${durSec}s (${durSec ? (durSec / 60).toFixed(1) : "?"}min) status=${d.status} ccid=${d.call_control_id} session=${d.call_session_id} leg=${d.call_leg_id} started=${d.recording_started_at} ended=${d.recording_ended_at}`
    );
    const dl = d.download_urls || {};
    if (dl.mp3) console.log(`    mp3 url (signed, short-lived): ${dl.mp3}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const apiKey = requireEnv("TELNYX_API_KEY");

  console.log(`target sip_username=${TARGET_SIP_USERNAME}`);
  console.log(`target email=${TARGET_EMAIL}`);
  console.log(`window=${WINDOW_START} → ${WINDOW_END}`);
  console.log(`min duration=${MIN_DURATION_SECONDS}s (${MIN_DURATION_SECONDS / 60}m)`);

  let records = await phase1ListCalls(apiKey);
  if (records.length === 0) {
    records = await phase1FallbackScan(apiKey);
  }

  const cands = phase2Filter(records);

  if (cands.length > 0) {
    await phase3SupabaseLookup(cands);
    await phase4RecordingLookup(cands, apiKey);
  } else {
    console.log(
      "\n(no candidates from Telnyx CDR endpoints — Phase 3/4 fall back to Supabase-sourced recording_ids.)"
    );
  }

  // Always: pull David's call_logs rows and cross-check each recording_id
  // with Telnyx for duration. This is the primary evidence path since the
  // webhook has already stored recording_ids on his rows.
  const recIds = await collectDavidRecordingIds();
  if (recIds.length > 0) {
    await lookupRecordingDetails(recIds, apiKey);
  }
  if (cands.length === 0) {
    await phase3SupabaseLookup([]);
  }

  console.log("\n=== Done. ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
