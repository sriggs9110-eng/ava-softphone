import { NextRequest, NextResponse } from "next/server";

// Warm transfer — Cancel.
//
// The consult is server-originated now (see warm-transfer/start), so
// cancel needs to hang up the rep_consult leg from the server side —
// the SDK can't tear down a leg it didn't initiate (it can only end
// its own /Verto-side/ call object). Telnyx then hangs up the bridged
// target_consult leg automatically because its peer just disappeared.
//
// The SDK still calls callRef.unhold() client-side to bring the
// original customer back from hold music.
//
// Body: { repConsultCcid }

const TELNYX_API = "https://api.telnyx.com/v2";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repConsultCcid } = body as { repConsultCcid?: string };

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!repConsultCcid) {
    return NextResponse.json(
      { error: "repConsultCcid required" },
      { status: 400 }
    );
  }

  console.log(`[warm/cancel] hangup repConsultCcid=${repConsultCcid}`);
  const res = await fetch(
    `${TELNYX_API}/calls/${repConsultCcid}/actions/hangup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );
  const data = await res.json().catch(() => ({}));
  console.log(
    `[warm/cancel] hangup status=${res.status} body=${JSON.stringify(data).slice(0, 200)}`
  );
  // Tolerate failure — the consult might already have ended (e.g., target
  // hung up). Returning success keeps the client UI clean.
  return NextResponse.json({ success: true });
}
