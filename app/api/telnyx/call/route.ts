import { NextRequest, NextResponse } from "next/server";
import { getLocalNumber } from "@/app/lib/local-presence";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { to, from } = body;

  const apiKey = process.env.TELNYX_API_KEY;
  // POST /v2/calls expects a Call Control Application ID in
  // connection_id, not the SIP credential connection ID. The agents
  // register on the credential connection (TELNYX_CONNECTION_ID) for
  // SIP endpoint auth; server-side call orchestration goes through the
  // Call Control App so webhooks fire and phone numbers (which are
  // now assigned to the app) route correctly.
  const callControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;

  if (!apiKey || !callControlAppId) {
    return NextResponse.json(
      { error: "Telnyx API not configured (missing TELNYX_API_KEY or TELNYX_CALL_CONTROL_APP_ID)" },
      { status: 500 }
    );
  }

  // Use local presence: match area code to a local number
  const fromNumber = from || (await getLocalNumber(to));

  try {
    const response = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connection_id: callControlAppId,
        to,
        from: fromNumber,
        record: "record-from-answer",
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.errors?.[0]?.detail || "Call failed" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Failed to initiate call" },
      { status: 500 }
    );
  }
}
