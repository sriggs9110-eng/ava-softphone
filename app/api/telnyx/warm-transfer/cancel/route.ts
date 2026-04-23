import { NextRequest, NextResponse } from "next/server";

// Warm transfer — step 2b (historical).
//
// DEPRECATED. Unhold is handled client-side via the Telnyx WebRTC SDK's
// call.unhold() method (see app/hooks/useTelnyxClient.ts →
// warmTransferCancel). Telnyx's v2 Call Control HTTP API has NO
// /actions/unhold endpoint — same reason as /actions/hold (see
// initiate/route.ts). Old clients may still POST here.
export async function POST(_req: NextRequest) {
  console.log("[warm/cancel] deprecated — unhold is now SDK-side, no-op");
  return NextResponse.json({
    success: true,
    deprecated: true,
    note: "unhold is handled client-side via SDK call.unhold()",
  });
}
