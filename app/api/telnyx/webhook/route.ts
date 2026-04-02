import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Match by phone_number + recent time window. This is the primary strategy
// because WebRTC SDK and Telnyx webhooks use different call_control_ids.
async function findRecentCall(phoneNumber: string) {
  const admin = getAdmin();
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();

  // Try exact number
  const { data } = await admin
    .from("call_logs")
    .select("id, call_control_id")
    .eq("phone_number", phoneNumber)
    .gte("created_at", oneMinAgo)
    .order("created_at", { ascending: false })
    .limit(1);

  if (data && data.length > 0) return data[0];

  // Try with/without + prefix
  const alt = phoneNumber.startsWith("+")
    ? phoneNumber.slice(1)
    : `+${phoneNumber}`;

  const { data: data2 } = await admin
    .from("call_logs")
    .select("id, call_control_id")
    .eq("phone_number", alt)
    .gte("created_at", oneMinAgo)
    .order("created_at", { ascending: false })
    .limit(1);

  if (data2 && data2.length > 0) return data2[0];
  return null;
}

function extractPhone(payload: Record<string, unknown>): string {
  const dir = payload?.direction as string;
  const raw = (dir === "outbound" ? payload?.to : payload?.from) as string || "";
  // Strip SIP URI if present: sip:+14695551234@...
  return raw.replace(/^sip:/, "").replace(/@.*$/, "");
}

async function updateRow(id: string, updates: Record<string, unknown>) {
  const admin = getAdmin();
  const { error } = await admin
    .from("call_logs")
    .update(updates)
    .eq("id", id);
  if (error) {
    console.error(`[Webhook] Update failed for row ${id}:`, error.message);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const eventType = body?.data?.event_type;
  const payload = body?.data?.payload || {};
  const ccid = payload?.call_control_id as string | undefined;
  const phone = extractPhone(payload);

  console.log(`[Webhook] ${eventType} phone=${phone} ccid=${ccid}`);

  const apiKey = process.env.TELNYX_API_KEY;

  switch (eventType) {
    case "call.initiated": {
      // Link the webhook's ccid to the existing row (created by the client)
      if (phone) {
        const row = await findRecentCall(phone);
        if (row) {
          await updateRow(row.id, {
            call_control_id: ccid,
            call_session_id: payload?.call_session_id || null,
          });
          console.log(`[Webhook] Linked ccid to row ${row.id}`);
        } else {
          console.log(`[Webhook] No recent row for ${phone} — client hasn't created it yet`);
        }
      }
      break;
    }

    case "call.answered":
    case "call.bridged": {
      // Start recording
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

      // Update status
      if (phone) {
        const row = await findRecentCall(phone);
        if (row) {
          await updateRow(row.id, {
            status: "connected",
            call_control_id: ccid,
            call_session_id: payload?.call_session_id || null,
          });
          console.log(`[Webhook] ${eventType} → connected, row ${row.id}`);
        } else {
          console.warn(`[Webhook] ${eventType} no row found for ${phone}`);
        }
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

      if (phone) {
        const row = await findRecentCall(phone);
        if (row) {
          await updateRow(row.id, {
            status: duration > 0 ? "completed" : "missed",
            duration_seconds: duration,
            call_control_id: ccid,
          });
          console.log(`[Webhook] hangup → ${duration > 0 ? "completed" : "missed"}, row ${row.id}`);
        } else {
          console.warn(`[Webhook] hangup no row found for ${phone}`);
        }
      }
      break;
    }

    case "call.recording.saved": {
      const url =
        (payload?.recording_urls as Record<string, string>)?.mp3 ||
        (payload?.recording_urls as Record<string, string>)?.wav;
      console.log(`[Webhook] Recording: ${url}`);

      if (url && phone) {
        const row = await findRecentCall(phone);
        if (row) {
          await updateRow(row.id, { recording_url: url });
          console.log(`[Webhook] recording saved, row ${row.id}`);
        } else {
          console.warn(`[Webhook] recording.saved no row for ${phone}`);
        }
      }
      break;
    }

    default:
      console.log(`[Webhook] Unhandled: ${eventType}`);
  }

  return NextResponse.json({ status: "ok" });
}
