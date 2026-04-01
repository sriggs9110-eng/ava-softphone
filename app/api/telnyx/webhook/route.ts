import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const eventType = body?.data?.event_type;
  const payload = body?.data?.payload;

  console.log(`[Telnyx Webhook] ${eventType}`, JSON.stringify(payload, null, 2));

  switch (eventType) {
    case "call.initiated":
      console.log(
        `Call initiated: ${payload?.direction} - ${payload?.from} -> ${payload?.to}`
      );
      break;
    case "call.answered":
      console.log(`Call answered: ${payload?.call_control_id}`);
      break;
    case "call.hangup":
      console.log(
        `Call hangup: ${payload?.call_control_id} - reason: ${payload?.hangup_cause}`
      );
      break;
    case "call.recording.saved":
      console.log(`Recording saved: ${payload?.recording_urls?.mp3}`);
      break;
    default:
      console.log(`Unhandled event: ${eventType}`);
  }

  return NextResponse.json({ status: "ok" });
}
