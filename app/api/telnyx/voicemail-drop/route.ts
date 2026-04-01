import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { call_control_id } = body;

  const apiKey = process.env.TELNYX_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Telnyx API not configured" },
      { status: 500 }
    );
  }

  try {
    // Play voicemail audio into the call
    const playRes = await fetch(
      `https://api.telnyx.com/v2/calls/${call_control_id}/actions/playback_start`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          audio_url: "https://www.soundjay.com/misc/sounds/bell-ringing-05.wav",
          loop: "1",
        }),
      }
    );

    if (!playRes.ok) {
      const data = await playRes.json();
      return NextResponse.json(
        { error: data.errors?.[0]?.detail || "Playback failed" },
        { status: playRes.status }
      );
    }

    // Hang up after a short delay to let playback start
    setTimeout(async () => {
      await fetch(
        `https://api.telnyx.com/v2/calls/${call_control_id}/actions/hangup`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
    }, 500);

    return NextResponse.json({ status: "voicemail_dropped" });
  } catch {
    return NextResponse.json(
      { error: "Failed to drop voicemail" },
      { status: 500 }
    );
  }
}
