import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { call_control_id, mode } = body;

  const apiKey = process.env.TELNYX_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Telnyx API not configured" },
      { status: 500 }
    );
  }

  const supervisorActions: Record<string, string> = {
    listen: "supervisor_listen",
    whisper: "supervisor_whisper",
    barge: "supervisor_barge_in",
  };

  const action = supervisorActions[mode];
  if (!action) {
    return NextResponse.json(
      { error: "Invalid mode. Use: listen, whisper, or barge" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${call_control_id}/actions/${action}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.errors?.[0]?.detail || `${mode} failed` },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: `Failed to ${mode}` },
      { status: 500 }
    );
  }
}
