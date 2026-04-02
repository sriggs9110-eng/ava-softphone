import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
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
      let row = await findRecentCall(payload);

      if (row) {
        await updateRow(row.id, {
          call_control_id: ccid,
          call_session_id: sessionId,
        });
        console.log(`[Webhook] initiated — linked to row ${row.id}`);
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
      console.log(`[Webhook] Recording url=${url} ccid=${ccid} from=${from} to=${to}`);

      if (url) {
        // Try call_control_id first (stamped by earlier events)
        let row = ccid ? await findByCallControlId(ccid) : null;

        // Fallback: phone match with 5 minute window (recordings arrive late)
        if (!row) {
          row = await findRecentCall(payload, 5);
        }

        if (row) {
          await updateRow(row.id, { recording_url: url });
          console.log(`[Webhook] recording saved, row ${row.id}`);
        } else {
          console.warn(`[Webhook] recording.saved — no row found`);
        }
      }
      break;
    }

    default:
      console.log(`[Webhook] Unhandled: ${eventType}`);
  }

  return NextResponse.json({ status: "ok" });
}
