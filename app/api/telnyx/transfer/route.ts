import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { call_control_id, transfer_to_call_control_id } = body;

  const apiKey = process.env.TELNYX_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Telnyx API not configured" },
      { status: 500 }
    );
  }

  try {
    // Transfer the original call to the transfer target
    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${call_control_id}/actions/transfer`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transfer_to: transfer_to_call_control_id,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.errors?.[0]?.detail || "Transfer failed" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Failed to execute transfer" },
      { status: 500 }
    );
  }
}
