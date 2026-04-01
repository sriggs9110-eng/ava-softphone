import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { call_control_ids } = body;

  const apiKey = process.env.TELNYX_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Telnyx API not configured" },
      { status: 500 }
    );
  }

  try {
    // Create a conference
    const createRes = await fetch(
      "https://api.telnyx.com/v2/conferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          call_control_id: call_control_ids[0],
          name: `conference-${Date.now()}`,
          beep_enabled: "never",
        }),
      }
    );

    const createData = await createRes.json();

    if (!createRes.ok) {
      return NextResponse.json(
        { error: createData.errors?.[0]?.detail || "Conference creation failed" },
        { status: createRes.status }
      );
    }

    const conferenceId = createData.data?.id;

    // Join the second call to the conference
    if (conferenceId && call_control_ids[1]) {
      await fetch(
        `https://api.telnyx.com/v2/conferences/${conferenceId}/actions/join`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            call_control_id: call_control_ids[1],
          }),
        }
      );
    }

    return NextResponse.json({ conference_id: conferenceId });
  } catch {
    return NextResponse.json(
      { error: "Failed to create conference" },
      { status: 500 }
    );
  }
}
