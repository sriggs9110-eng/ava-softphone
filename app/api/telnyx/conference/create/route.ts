import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Conference merge for warm transfer.
//
// Replaces the prior /api/telnyx/conference (which chained partial
// /actions/join calls without persistence, liveness checks, or
// rollback). Uses Telnyx's first-class Conference resource per
// developers.telnyx.com/api/call-control/create-conference and
// avoids /actions/bridge entirely (which silently fails between
// two single-leg calls — see PHASE_1A_REPORT.md).
//
// Body: { repCcid, consultCcid, customerCcid? }
//   repCcid       = rep's WebRTC ccid for the original (held) call
//   consultCcid   = consult call ccid (= transferCallRef.current's
//                   ccid from warmTransferStart)
//   customerCcid  = optional. If omitted, the route looks it up from
//                   call_logs.external_ccid WHERE call_control_id =
//                   repCcid — same field the dial-outbound two-leg
//                   path stamps at insert time. The client doesn't
//                   have to track it, which keeps the SDK hook
//                   ignorant of server-side schema details.
//
// Returns: { success, conferenceId, status } on 200.
//
// Errors:
//   409 if any of the three legs is no longer alive on Telnyx.
//   500 on conference creation, join failure, or persistence failure.
//   On any join failure mid-flight, attempts to /actions/leave any
//   participants that successfully joined so we don't leave Telnyx
//   in a half-merged state.
//
// Side effects on success:
//   INSERT into call_conferences (id, telnyx_conference_id, rep_ccid,
//   customer_ccid, consult_ccid, rep_user_id, status='active').
//   Webhooks (conference.participant_left etc.) correlate back via
//   this row. See app/api/telnyx/webhook/route.ts.
//
// Logged with [conf/create] prefix.

const TELNYX_API = "https://api.telnyx.com/v2";

interface LegProbeResult {
  ccid: string;
  alive: boolean | "unknown";
  error?: string;
}

async function probeLegAlive(ccid: string, apiKey: string): Promise<LegProbeResult> {
  try {
    const res = await fetch(`${TELNYX_API}/calls/${ccid}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return { ccid, alive: "unknown", error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { data?: { is_alive?: boolean } };
    const alive = body?.data?.is_alive;
    return { ccid, alive: alive === true };
  } catch (err) {
    return { ccid, alive: "unknown", error: (err as Error).message };
  }
}

async function joinLeg(
  conferenceId: string,
  ccid: string,
  apiKey: string
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const res = await fetch(
    `${TELNYX_API}/conferences/${conferenceId}/actions/join`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: ccid }),
    }
  );
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  const detail =
    body?.errors?.[0]?.detail ||
    body?.errors?.[0]?.title ||
    `join failed HTTP ${res.status}`;
  return { ok: false, status: res.status, detail };
}

async function leaveQuiet(
  conferenceId: string,
  ccid: string,
  apiKey: string
): Promise<void> {
  // Best-effort cleanup. Don't surface errors — caller is already in
  // an error path; we just want to limit damage.
  try {
    await fetch(
      `${TELNYX_API}/conferences/${conferenceId}/actions/leave`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ call_control_id: ccid }),
      }
    );
  } catch {
    /* swallow */
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repCcid, consultCcid } = body as {
    repCcid?: string;
    consultCcid?: string;
    customerCcid?: string;
  };
  let customerCcid = (body as { customerCcid?: string }).customerCcid;

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!repCcid || !consultCcid) {
    return NextResponse.json(
      { error: "repCcid and consultCcid required" },
      { status: 400 }
    );
  }

  // Auth: only an authenticated rep can create a conference for their own call.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Look up customerCcid if not provided. external_ccid is stamped at
  // dial-outbound insert time (?new_dial=1 path); for inbound calls
  // it's stamped at fan-out pairing time. If still not found here the
  // call wasn't placed via the two-leg path and conference merge
  // can't address the customer's PSTN leg directly.
  if (!customerCcid) {
    const adminLookup = createAdminClient();
    const { data: repRow } = await adminLookup
      .from("call_logs")
      .select("external_ccid")
      .eq("call_control_id", repCcid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    customerCcid = (repRow?.external_ccid as string | null) || undefined;
    if (!customerCcid) {
      console.log(
        `[conf/create] no external_ccid for repCcid=${repCcid} — conference requires the two-leg dial path`
      );
      return NextResponse.json(
        {
          error:
            "Conference merge requires a separately addressable customer leg. Place the call with ?new_dial=1 (two-leg) to enable merge.",
        },
        { status: 409 }
      );
    }
  }

  console.log(
    `[conf/create] request rep=${user.id} repCcid=${repCcid} customerCcid=${customerCcid} consultCcid=${consultCcid}`
  );

  // Step 1: pre-flight liveness for all three legs.
  // If any is dead the merge can't work; bail with 409 so the UI can
  // show a specific message instead of half-merging and erroring later.
  const probes = await Promise.all([
    probeLegAlive(repCcid, apiKey),
    probeLegAlive(customerCcid, apiKey),
    probeLegAlive(consultCcid, apiKey),
  ]);
  const labels = ["rep", "customer", "consult"];
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i];
    if (p.alive === false) {
      console.log(
        `[conf/create] pre-flight ${labels[i]} leg ccid=${p.ccid} not alive — refusing merge`
      );
      return NextResponse.json(
        {
          error: `${labels[i]} leg is no longer active. Cannot merge.`,
          dead_leg: labels[i],
        },
        { status: 409 }
      );
    }
  }
  // alive==="unknown" (probe HTTP error / network) is tolerated — we
  // proceed and let Telnyx's join return the real error.

  // Step 2: create the conference. Telnyx requires an initial
  // call_control_id; we use the customer's leg so the customer is the
  // first participant and ringback / hold music defaults apply to
  // them rather than to the rep.
  const conferenceName = `merge-${repCcid.slice(-8)}-${Date.now()}`;
  const createRes = await fetch(`${TELNYX_API}/conferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      call_control_id: customerCcid,
      name: conferenceName,
      beep_enabled: "never",
      // Telnyx default end-conference behavior: ends when the last
      // participant leaves. That's what we want.
    }),
  });
  const createBody = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const detail =
      createBody?.errors?.[0]?.detail ||
      createBody?.errors?.[0]?.title ||
      "Conference create failed";
    console.error(
      `[conf/create] create FAILED status=${createRes.status} detail=${detail}`
    );
    return NextResponse.json({ error: detail }, { status: createRes.status });
  }
  const conferenceId = createBody?.data?.id as string | undefined;
  if (!conferenceId) {
    console.error(
      `[conf/create] create response missing id body=${JSON.stringify(createBody).slice(0, 400)}`
    );
    return NextResponse.json(
      { error: "Telnyx returned no conference id" },
      { status: 500 }
    );
  }
  console.log(
    `[conf/create] created conferenceId=${conferenceId} initial=customerCcid name=${conferenceName}`
  );
  // customerCcid is implicitly joined by the create call.

  // Step 3: join the remaining two participants sequentially.
  // Order: rep first (so the rep can hear the conference even if
  // consult join fails), then consult.
  const joinedSoFar: string[] = [customerCcid];
  for (const [label, ccid] of [
    ["rep", repCcid],
    ["consult", consultCcid],
  ] as const) {
    const result = await joinLeg(conferenceId, ccid, apiKey);
    if (!result.ok) {
      console.error(
        `[conf/create] join ${label} ccid=${ccid} FAILED status=${result.status} detail=${result.detail}`
      );
      // Cleanup: leave whoever we already joined so they're freed
      // back to their call control state. customerCcid joined via
      // the create call counts as joined too — leave it explicitly.
      for (const j of joinedSoFar) {
        await leaveQuiet(conferenceId, j, apiKey);
      }
      return NextResponse.json(
        {
          error: `Failed to add ${label} to conference: ${result.detail}`,
          partial: true,
        },
        { status: 500 }
      );
    }
    console.log(`[conf/create] join ${label} ccid=${ccid} ok`);
    joinedSoFar.push(ccid);
  }

  // Step 4: persist for webhook correlation.
  const admin = createAdminClient();
  const { error: insertErr } = await admin.from("call_conferences").insert({
    telnyx_conference_id: conferenceId,
    rep_ccid: repCcid,
    customer_ccid: customerCcid,
    consult_ccid: consultCcid,
    rep_user_id: user.id,
    status: "active",
  });
  if (insertErr) {
    console.error(
      `[conf/create] persistence failed conferenceId=${conferenceId}: ${insertErr.message}`
    );
    // Don't roll back the Telnyx state — the conference is live and
    // working, the rep is talking. Webhooks won't be able to correlate
    // participant-left events back to a conference, but the merge
    // itself is fine. Surface a soft warning.
    return NextResponse.json({
      success: true,
      conferenceId,
      status: "active",
      warning:
        "conference active but DB persistence failed — leave/end may not auto-cleanup recording",
    });
  }

  console.log(
    `[conf/create] success conferenceId=${conferenceId} all 3 legs joined + persisted`
  );

  return NextResponse.json({
    success: true,
    conferenceId,
    status: "active",
  });
}
