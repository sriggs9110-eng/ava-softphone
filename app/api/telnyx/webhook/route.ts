import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Use service role to bypass RLS — webhooks have no user session
function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const eventType = body?.data?.event_type;
  const payload = body?.data?.payload;

  console.log(`[Telnyx Webhook] ${eventType}`, JSON.stringify(payload, null, 2));

  const apiKey = process.env.TELNYX_API_KEY;
  const callControlId = payload?.call_control_id;

  switch (eventType) {
    case "call.initiated":
      console.log(
        `Call initiated: ${payload?.direction} - ${payload?.from} -> ${payload?.to}`
      );
      break;

    case "call.answered":
      console.log(`Call answered: ${callControlId}`);

      // Start recording via Call Control API
      if (apiKey && callControlId) {
        try {
          const recordRes = await fetch(
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
          const recordData = await recordRes.json();
          console.log(
            `[Telnyx Webhook] record_start response:`,
            recordRes.status,
            JSON.stringify(recordData)
          );
        } catch (err) {
          console.error("[Telnyx Webhook] Failed to start recording:", err);
        }
      }

      // Update call_logs status to connected
      if (callControlId) {
        const admin = getAdmin();
        await admin
          .from("call_logs")
          .update({ status: "connected" })
          .eq("call_control_id", callControlId);
      }
      break;

    case "call.hangup":
      console.log(
        `Call hangup: ${callControlId} - reason: ${payload?.hangup_cause}`
      );
      break;

    case "call.recording.saved": {
      const recordingUrl =
        payload?.recording_urls?.mp3 || payload?.recording_urls?.wav;
      console.log(`Recording saved: ${recordingUrl} for ${callControlId}`);

      if (recordingUrl && callControlId) {
        const admin = getAdmin();
        const { error } = await admin
          .from("call_logs")
          .update({ recording_url: recordingUrl })
          .eq("call_control_id", callControlId);

        if (error) {
          console.error("[Telnyx Webhook] Failed to save recording URL:", error);
        } else {
          console.log("[Telnyx Webhook] Recording URL saved to call_logs");
        }
      }
      break;
    }

    default:
      console.log(`Unhandled event: ${eventType}`);
  }

  return NextResponse.json({ status: "ok" });
}
