import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Try multiple strategies to find the call_logs row
async function findAndUpdate(
  payload: Record<string, unknown>,
  updates: Record<string, unknown>
): Promise<number> {
  const admin = getAdmin();
  const ccid = payload?.call_control_id as string | undefined;
  const sessionId = payload?.call_session_id as string | undefined;
  const callLegId = payload?.call_leg_id as string | undefined;
  const from = payload?.from as string | undefined;
  const to = payload?.to as string | undefined;
  const direction = payload?.direction as string | undefined;

  // Determine the phone number (the external party, not us)
  const phoneNumber = direction === "outbound" ? to : from;

  // Strategy 1: match by call_control_id
  if (ccid) {
    const { data } = await admin
      .from("call_logs")
      .update(updates)
      .eq("call_control_id", ccid)
      .select("id");
    if (data && data.length > 0) {
      console.log(`[Webhook] Matched by call_control_id: ${data.length} rows`);
      return data.length;
    }
  }

  // Strategy 2: match by call_session_id
  if (sessionId) {
    const { data } = await admin
      .from("call_logs")
      .update(updates)
      .eq("call_session_id", sessionId)
      .select("id");
    if (data && data.length > 0) {
      console.log(`[Webhook] Matched by call_session_id: ${data.length} rows`);
      return data.length;
    }
  }

  // Strategy 3: match by call_leg_id stored as call_control_id
  if (callLegId) {
    const { data } = await admin
      .from("call_logs")
      .update(updates)
      .eq("call_control_id", callLegId)
      .select("id");
    if (data && data.length > 0) {
      console.log(`[Webhook] Matched by call_leg_id: ${data.length} rows`);
      return data.length;
    }
  }

  // Strategy 4: match by phone_number + created in last 2 minutes
  if (phoneNumber) {
    // Clean the phone number (remove SIP URI parts if present)
    const cleanNumber = phoneNumber.replace(/^sip:/, "").replace(/@.*$/, "");
    const twoMinAgo = new Date(Date.now() - 120_000).toISOString();

    const { data } = await admin
      .from("call_logs")
      .update({
        ...updates,
        // Also store the webhook's ccid + session_id for future events
        ...(ccid ? { call_control_id: ccid } : {}),
        ...(sessionId ? { call_session_id: sessionId } : {}),
      })
      .eq("phone_number", cleanNumber)
      .gte("created_at", twoMinAgo)
      .is("call_session_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .select("id");

    if (data && data.length > 0) {
      console.log(`[Webhook] Matched by phone ${cleanNumber} + recent: ${data.length} rows`);
      return data.length;
    }

    // Strategy 4b: try with + prefix
    const plusNumber = cleanNumber.startsWith("+") ? cleanNumber : `+${cleanNumber}`;
    const { data: data2 } = await admin
      .from("call_logs")
      .update({
        ...updates,
        ...(ccid ? { call_control_id: ccid } : {}),
        ...(sessionId ? { call_session_id: sessionId } : {}),
      })
      .eq("phone_number", plusNumber)
      .gte("created_at", twoMinAgo)
      .is("call_session_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .select("id");

    if (data2 && data2.length > 0) {
      console.log(`[Webhook] Matched by phone ${plusNumber} + recent: ${data2.length} rows`);
      return data2.length;
    }
  }

  // Strategy 5: last resort — most recent call_logs row in last 2 min with no session_id
  const twoMinAgo = new Date(Date.now() - 120_000).toISOString();
  const { data: fallback } = await admin
    .from("call_logs")
    .update({
      ...updates,
      ...(ccid ? { call_control_id: ccid } : {}),
      ...(sessionId ? { call_session_id: sessionId } : {}),
    })
    .gte("created_at", twoMinAgo)
    .is("call_session_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .select("id");

  if (fallback && fallback.length > 0) {
    console.log(`[Webhook] Matched by recent row fallback: ${fallback.length} rows`);
    return fallback.length;
  }

  console.warn(`[Webhook] NO MATCH for ccid=${ccid} session=${sessionId} phone=${phoneNumber}`);
  return 0;
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const eventType = body?.data?.event_type;
  const payload = body?.data?.payload || {};
  const callControlId = payload?.call_control_id;
  const callSessionId = payload?.call_session_id;
  const callLegId = payload?.call_leg_id;

  console.log(
    `[Webhook] ${eventType} ccid=${callControlId} session=${callSessionId} leg=${callLegId} from=${payload?.from} to=${payload?.to} dir=${payload?.direction}`
  );

  const apiKey = process.env.TELNYX_API_KEY;

  switch (eventType) {
    case "call.initiated":
      // Store session_id on the row early if we can match
      if (callSessionId) {
        const matched = await findAndUpdate(payload, {});
        console.log(`[Webhook] call.initiated — linked session: ${matched} rows`);
      }
      break;

    case "call.answered":
    case "call.bridged": {
      // Start recording
      if (apiKey && callControlId) {
        try {
          const res = await fetch(
            `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                format: "mp3",
                channels: "dual",
              }),
            }
          );
          console.log(`[Webhook] record_start: ${res.status}`);
        } catch (err) {
          console.error("[Webhook] record_start failed:", err);
        }
      }

      const matched = await findAndUpdate(payload, { status: "connected" });
      console.log(`[Webhook] ${eventType} — updated status: ${matched} rows`);
      break;
    }

    case "call.hangup": {
      let durationSeconds = 0;
      const startTime = payload?.start_time;
      const endTime = payload?.end_time;

      if (startTime && endTime) {
        durationSeconds = Math.floor(
          (new Date(endTime as string).getTime() -
            new Date(startTime as string).getTime()) /
            1000
        );
      }

      if (!durationSeconds && payload?.duration_seconds) {
        durationSeconds = Math.floor(payload.duration_seconds as number);
      }

      const wasConnected = durationSeconds > 0;
      console.log(`[Webhook] hangup duration=${durationSeconds}s connected=${wasConnected}`);

      const matched = await findAndUpdate(payload, {
        status: wasConnected ? "completed" : "missed",
        duration_seconds: durationSeconds,
      });
      console.log(`[Webhook] call.hangup — updated: ${matched} rows`);
      break;
    }

    case "call.recording.saved": {
      const recordingUrl =
        payload?.recording_urls?.mp3 || payload?.recording_urls?.wav;
      console.log(`[Webhook] Recording: ${recordingUrl}`);

      if (recordingUrl) {
        const matched = await findAndUpdate(payload, {
          recording_url: recordingUrl,
        });
        console.log(`[Webhook] recording.saved — updated: ${matched} rows`);
      }
      break;
    }

    default:
      console.log(`[Webhook] Unhandled: ${eventType}`);
  }

  return NextResponse.json({ status: "ok" });
}
