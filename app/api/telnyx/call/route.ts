import { NextRequest, NextResponse } from "next/server";
import { getLocalNumber } from "@/app/lib/local-presence";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { to, from } = body;

  const apiKey = process.env.TELNYX_API_KEY;
  const connectionId = process.env.TELNYX_CONNECTION_ID;

  if (!apiKey || !connectionId) {
    return NextResponse.json(
      { error: "Telnyx API not configured" },
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
        connection_id: connectionId,
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
