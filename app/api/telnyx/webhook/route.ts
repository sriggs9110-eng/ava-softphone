import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Dispatch ring-group fan-out: look up the group for the dialed number,
// find available members, broadcast via Supabase Realtime, and schedule
// a timeout hangup if nobody answers.
async function dispatchRingGroup({
  callControlId,
  from,
  to,
}: {
  callControlId: string | undefined;
  from: string;
  to: string;
}) {
  if (!to) return;

  const admin = getAdmin();

  // Try both forms of the number — DB may store with or without + prefix.
  const candidates = new Set<string>();
  candidates.add(to);
  if (to.startsWith("+")) candidates.add(to.slice(1));
  else candidates.add(`+${to}`);

  const { data: group } = await admin
    .from("ring_groups")
    .select("id, name, inbound_number, strategy, ring_timeout_seconds, fallback_action")
    .in("inbound_number", Array.from(candidates))
    .limit(1)
    .maybeSingle();

  if (!group) return;

  const { data: members } = await admin
    .from("ring_group_members")
    .select("user_id, priority, softphone_users!inner(id, status, full_name)")
    .eq("group_id", group.id);

  type MemberRow = {
    user_id: string;
    priority: number;
    softphone_users: { id: string; status: string; full_name: string };
  };

  const rows = (members || []) as unknown as MemberRow[];
  const available = rows
    .filter((m) => m.softphone_users?.status === "available")
    .sort((a, b) => a.priority - b.priority);

  if (available.length === 0) {
    console.log(`[Webhook/ring] group=${group.name} — no available members`);
    return;
  }

  // For simultaneous, notify everyone at once. For round_robin, still notify
  // all but the client sorts by priority. Proper round-robin rotation is
  // a future iteration — flag in ops doc.
  const recipients = available.map((m) => ({
    user_id: m.user_id,
    name: m.softphone_users.full_name,
  }));
  const memberIds = recipients.map((r) => r.user_id);

  const payload = {
    call_control_id: callControlId,
    from,
    to,
    group_id: group.id,
    group_name: group.name,
    strategy: group.strategy,
    member_user_ids: memberIds,
    fallback_action: group.fallback_action,
    ring_timeout_seconds: group.ring_timeout_seconds,
    sent_at: new Date().toISOString(),
  };

  for (const r of recipients) {
    try {
      const ch = admin.channel(`user:${r.user_id}`, {
        config: { broadcast: { ack: false, self: false } },
      });
      await ch.subscribe();
      await ch.send({
        type: "broadcast",
        event: "incoming_group_call",
        payload,
      });
      await admin.removeChannel(ch);
    } catch (err) {
      console.error(`[Webhook/ring] broadcast to ${r.user_id} failed:`, err);
    }
  }
  console.log(
    `[Webhook/ring] group=${group.name} notified ${recipients.length} members`
  );

  // Timeout enforcement. Best-effort in a serverless function — fires only
  // while the function instance is alive (Vercel limit applies). For robust
  // enforcement at scale, wire a cron to sweep ring_attempts.
  const apiKey = process.env.TELNYX_API_KEY;
  if (!callControlId || !apiKey) return;

  after(async () => {
    await new Promise((res) =>
      setTimeout(res, (group.ring_timeout_seconds ?? 20) * 1000)
    );

    try {
      // Check if the call was answered — if so, don't hang up.
      const { data: row } = await admin
        .from("call_logs")
        .select("status")
        .eq("call_control_id", callControlId)
        .limit(1)
        .maybeSingle();

      if (row?.status === "connected" || row?.status === "completed") {
        console.log(`[Webhook/ring] ccid=${callControlId} answered — no hangup`);
        return;
      }

      console.log(
        `[Webhook/ring] ccid=${callControlId} timed out — fallback=${group.fallback_action}`
      );

      // v1: only hangup. voicemail fallback is stubbed for a later iteration.
      if (group.fallback_action === "hangup" || group.fallback_action === "voicemail") {
        const res = await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`[Webhook/ring] hangup status=${res.status}`);
      }
    } catch (err) {
      console.error(`[Webhook/ring] timeout handler error:`, err);
    }
  });
}

function cleanNumber(raw: string): string {
  return raw.replace(/^sip:/, "").replace(/@.*$/, "");
}

// Match by call_control_id (stamped on the row by earlier events)
async function findByCallControlId(ccid: string) {
  const admin = getAdmin();
  const { data } = await admin
    .from("call_logs")
    .select("id")
    .eq("call_control_id", ccid)
    .limit(1);

  if (data && data.length > 0) {
    console.log(`[Webhook] Found row ${data[0].id} by ccid`);
    return data[0];
  }
  return null;
}

// Match by phone_number + time window
async function findRecentCall(
  payload: Record<string, unknown>,
  windowMinutes = 1
) {
  const admin = getAdmin();
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const from = cleanNumber((payload?.from as string) || "");
  const to = cleanNumber((payload?.to as string) || "");

  const candidates = new Set<string>();
  for (const num of [from, to]) {
    if (!num) continue;
    candidates.add(num);
    if (num.startsWith("+")) candidates.add(num.slice(1));
    else candidates.add(`+${num}`);
  }

  for (const phone of candidates) {
    const { data } = await admin
      .from("call_logs")
      .select("id")
      .eq("phone_number", phone)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      console.log(`[Webhook] Found row ${data[0].id} by phone=${phone}`);
      return data[0];
    }
  }

  console.log(`[Webhook] No row found for from=${from} to=${to} (window=${windowMinutes}m)`);
  return null;
}

async function updateRow(id: string, updates: Record<string, unknown>) {
  const admin = getAdmin();
  const { error } = await admin
    .from("call_logs")
    .update(updates)
    .eq("id", id);
  if (error) {
    console.error(`[Webhook] Update failed row ${id}:`, error.message);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const eventType = body?.data?.event_type;
  const payload = body?.data?.payload || {};
  const ccid = payload?.call_control_id as string | undefined;
  const sessionId = payload?.call_session_id as string | undefined;
  const from = cleanNumber((payload?.from as string) || "");
  const to = cleanNumber((payload?.to as string) || "");

  console.log(`[Webhook] ${eventType} from=${from} to=${to} ccid=${ccid}`);

  const apiKey = process.env.TELNYX_API_KEY;

  switch (eventType) {
    case "call.initiated": {
      const direction = payload?.direction as string | undefined;

      // Ring group fan-out for inbound calls. Runs alongside existing
      // bookkeeping — does not replace single-user inbound handling.
      if (direction === "incoming" || direction === "inbound") {
        // Fire and await — dispatchRingGroup is cheap and no-ops if no
        // matching group exists.
        await dispatchRingGroup({ callControlId: ccid, from, to });
      }

      let row = await findRecentCall(payload);

      if (row) {
        // Capture Telnyx's view of From/To too — previously these only wrote on
        // the insert branch, leaving from_number=null on existing rows.
        // This is what Telnyx actually put on the wire, so it's the ground
        // truth for diagnosing local-presence CID overrides.
        const telnyxDir = payload?.direction as string | undefined;
        const telnyxIsOutgoing =
          telnyxDir === "outgoing" || telnyxDir === "outbound";
        const telnyxFrom = telnyxIsOutgoing ? from : to;
        console.log(
          `[Webhook] initiated — row ${row.id} telnyx-from=${telnyxFrom} direction=${telnyxDir}`
        );
        await updateRow(row.id, {
          call_control_id: ccid,
          call_session_id: sessionId,
          from_number: telnyxFrom || null,
        });
      } else {
        const dir = payload?.direction as string;
        const prospectNumber = dir === "outbound" ? to : from;
        const fromNumber = dir === "outbound" ? from : to;

        const admin = getAdmin();
        const { data, error } = await admin
          .from("call_logs")
          .insert({
            direction: dir === "outbound" ? "outbound" : "inbound",
            phone_number: prospectNumber || to || from,
            from_number: fromNumber,
            status: "initiated",
            call_control_id: ccid,
            call_session_id: sessionId,
          })
          .select("id")
          .single();

        if (error) {
          console.log(`[Webhook] initiated — insert failed:`, error.message);
        } else {
          console.log(`[Webhook] initiated — created row ${data.id}`);
        }
      }
      break;
    }

    case "call.answered":
    case "call.bridged": {
      if (apiKey && ccid) {
        try {
          const res = await fetch(
            `https://api.telnyx.com/v2/calls/${ccid}/actions/record_start`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ format: "mp3", channels: "dual" }),
            }
          );
          console.log(`[Webhook] record_start: ${res.status}`);
        } catch (err) {
          console.error("[Webhook] record_start failed:", err);
        }
      }

      const row = await findRecentCall(payload);
      if (row) {
        await updateRow(row.id, {
          status: "connected",
          call_control_id: ccid,
          call_session_id: sessionId,
        });
        console.log(`[Webhook] ${eventType} → connected, row ${row.id}`);
      } else {
        console.warn(`[Webhook] ${eventType} — no row found`);
      }
      break;
    }

    case "call.hangup": {
      let duration = 0;
      const start = payload?.start_time as string | undefined;
      const end = payload?.end_time as string | undefined;
      if (start && end) {
        duration = Math.floor(
          (new Date(end).getTime() - new Date(start).getTime()) / 1000
        );
      }
      if (!duration && payload?.duration_seconds) {
        duration = Math.floor(payload.duration_seconds as number);
      }

      console.log(`[Webhook] hangup duration=${duration}s`);

      const row = await findRecentCall(payload);
      if (row) {
        await updateRow(row.id, {
          status: duration > 0 ? "completed" : "missed",
          duration_seconds: duration,
          call_control_id: ccid,
        });
        console.log(`[Webhook] hangup → ${duration > 0 ? "completed" : "missed"}, row ${row.id}`);
      } else {
        console.warn(`[Webhook] hangup — no row found`);
      }
      break;
    }

    case "call.recording.saved": {
      const urls = payload?.recording_urls as Record<string, string> | undefined;
      const url = urls?.mp3 || urls?.wav;
      const recSessionId = payload?.call_session_id as string | undefined;
      console.log(`[Webhook] Recording url=${url} ccid=${ccid} session=${recSessionId} from=${from} to=${to}`);

      if (url) {
        const admin = getAdmin();
        let rowId: string | null = null;

        // Strategy 1: call_control_id match
        if (!rowId && ccid) {
          const r = await findByCallControlId(ccid);
          if (r) rowId = r.id;
        }

        // Strategy 2: call_session_id match
        if (!rowId && recSessionId) {
          const { data } = await admin
            .from("call_logs")
            .select("id")
            .eq("call_session_id", recSessionId)
            .limit(1);
          if (data && data.length > 0) {
            rowId = data[0].id;
            console.log(`[Webhook] Recording matched by session_id, row ${rowId}`);
          }
        }

        // Strategy 3: phone match with 5 min window
        if (!rowId) {
          const r = await findRecentCall(payload, 5);
          if (r) rowId = r.id;
        }

        // Strategy 4: most recent completed call in 5 min (last resort)
        if (!rowId) {
          const fiveMinAgo = new Date(Date.now() - 300_000).toISOString();
          const { data } = await admin
            .from("call_logs")
            .select("id")
            .in("status", ["completed", "connected"])
            .is("recording_url", null)
            .gte("created_at", fiveMinAgo)
            .order("created_at", { ascending: false })
            .limit(1);
          if (data && data.length > 0) {
            rowId = data[0].id;
            console.log(`[Webhook] Recording matched by recent completed call, row ${rowId}`);
          }
        }

        if (rowId) {
          await updateRow(rowId, { recording_url: url });
          console.log(`[Webhook] recording saved to row ${rowId}`);

          // Auto-trigger transcription + analysis when the owner has it on
          // (default ON). Runs after the response returns so Telnyx doesn't
          // wait on Whisper/Claude.
          const rowIdForAfter = rowId;
          after(async () => {
            try {
              const admin = getAdmin();
              const { data: row } = await admin
                .from("call_logs")
                .select(
                  "id, user_id, phone_number, direction, duration_seconds, status, created_at, recording_url"
                )
                .eq("id", rowIdForAfter)
                .single();
              if (!row || !row.recording_url) return;

              let autoAnalyze = true;
              if (row.user_id) {
                const { data: owner } = await admin
                  .from("softphone_users")
                  .select("auto_analyze_calls")
                  .eq("id", row.user_id)
                  .single();
                if (owner && owner.auto_analyze_calls === false) {
                  autoAnalyze = false;
                }
              }
              if (!autoAnalyze) {
                console.log(
                  `[Webhook] auto-analyze off for row ${rowIdForAfter}`
                );
                return;
              }

              const origin = process.env.NEXT_PUBLIC_APP_URL || "";
              if (!origin) {
                console.warn(
                  "[Webhook] NEXT_PUBLIC_APP_URL not set — skipping auto-analyze"
                );
                return;
              }

              const r = await fetch(`${origin}/api/ai/analyze-call`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  recording_url: row.recording_url,
                  call_log_id: row.id,
                  call_metadata: {
                    number: row.phone_number,
                    direction: row.direction,
                    duration: row.duration_seconds,
                    status: row.status,
                    timestamp: new Date(row.created_at).getTime(),
                  },
                }),
              });
              console.log(`[Webhook] auto-analyze status=${r.status}`);

              // If the call originated from a CRM pop-up (external_id set),
              // push a summary to the owner's configured Signal webhook. This
              // covers the case where the pop-up has already closed by the
              // time analysis finishes.
              const { data: enriched } = await admin
                .from("call_logs")
                .select("external_id")
                .eq("id", rowIdForAfter)
                .single();
              if (enriched?.external_id) {
                try {
                  const cb = await fetch(`${origin}/api/dial/callback`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      call_log_id: rowIdForAfter,
                      external_id: enriched.external_id,
                    }),
                  });
                  console.log(`[Webhook] crm callback status=${cb.status}`);
                } catch (cbErr) {
                  console.error("[Webhook] crm callback failed:", cbErr);
                }
              }
            } catch (err) {
              console.error("[Webhook] auto-analyze failed:", err);
            }
          });
        } else {
          console.warn(`[Webhook] recording.saved — NO ROW FOUND for url=${url}`);
        }
      }
      break;
    }

    default:
      console.log(`[Webhook] Unhandled: ${eventType}`);
  }

  return NextResponse.json({ status: "ok" });
}
