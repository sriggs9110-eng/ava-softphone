import { NextRequest, NextResponse } from "next/server";

// Warm transfer — step 1 (historical).
//
// DEPRECATED. Hold is handled client-side via the Telnyx WebRTC SDK's
// call.hold() method (see app/hooks/useTelnyxClient.ts → warmTransferStart).
//
// Telnyx's v2 Call Control HTTP API has NO /actions/hold endpoint — this
// was verified by probing every variant (hold, hold_audio, call_hold,
// play_audio); all return the same 404 "Resource not found" that actually
// non-existent paths return. Known-good actions like /speak /transfer
// /bridge return 422 "Call has already ended" on a dead call. The
// difference proves /actions/hold was never valid.
//
// Old clients may still POST here. Respond 200 with a no-op so we don't
// break them while they roll out. Remove this file once every deployed
// client uses the SDK-side hold path.
export async function POST(_req: NextRequest) {
  console.log("[warm/initiate] deprecated — hold is now SDK-side, no-op");
  return NextResponse.json({
    success: true,
    deprecated: true,
    note: "hold is handled client-side via SDK call.hold()",
  });
}
