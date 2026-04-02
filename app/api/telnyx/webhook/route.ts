import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function updateByCallControlId(
  callControlId: string,
  updates: Record<string, unknown>
) {
  const admin = getAdmin();
  const { data, error } = await admin
    .from("call_logs")
    .update(updates)
    .eq("call_control_id", callControlId)
    .select("id");

  if (error) {
    console.error(`[Webhook] DB update failed for ${callControlId}:`, error);
  } else {
    console.log(
      `[Webhook] Updated ${data?.length || 0} rows for ${callControlId}:`,
      Object.keys(updates).join(", ")
    );
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const eventType = body?.data?.event_type;
  const payload = body?.data?.payload;
  const callControlId = payload?.call_control_id;

  console.log(`[Webhook] ${eventType} ccid=${callControlId}`);

  const apiKey = process.env.TELNYX_API_KEY;

  switch (eventType) {
    case "call.initiated":
      console.log(
        `[Webhook] ${payload?.direction} ${payload?.from} -> ${payload?.to}`
      );
      break;

    case "call.answered":
    case "call.bridged": {
      console.log(`[Webhook] Call connected: ${callControlId}`);

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

      // Mark call as connected with the answer timestamp
      if (callControlId) {
        await updateByCallControlId(callControlId, {
          status: "connected",
        });
      }
      break;
    }

    case "call.hangup": {
      console.log(
        `[Webhook] Hangup: ${callControlId} cause=${payload?.hangup_cause}`
      );

      if (callControlId) {
        // Calculate duration from Telnyx timestamps
        let durationSeconds = 0;
        const startTime = payload?.start_time;
        const endTime = payload?.end_time;

        if (startTime && endTime) {
          durationSeconds = Math.floor(
            (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000
          );
        }

        // Telnyx may also provide duration directly
        if (!durationSeconds && payload?.duration_seconds) {
          durationSeconds = Math.floor(payload.duration_seconds);
        }

        const wasConnected = durationSeconds > 0;
        console.log(
          `[Webhook] Duration: ${durationSeconds}s, status: ${wasConnected ? "completed" : "missed"}`
        );

        await updateByCallControlId(callControlId, {
          status: wasConnected ? "completed" : "missed",
          duration_seconds: durationSeconds,
        });
      }
      break;
    }

    case "call.recording.saved": {
      const recordingUrl =
        payload?.recording_urls?.mp3 || payload?.recording_urls?.wav;
      console.log(`[Webhook] Recording saved: ${recordingUrl}`);

      if (recordingUrl && callControlId) {
        await updateByCallControlId(callControlId, {
          recording_url: recordingUrl,
        });
      }
      break;
    }

    default:
      console.log(`[Webhook] Unhandled: ${eventType}`);
  }

  return NextResponse.json({ status: "ok" });
}
