import { NextResponse } from "next/server";

export async function GET() {
  const username = process.env.TELNYX_SIP_USERNAME;
  const password = process.env.TELNYX_SIP_PASSWORD;

  if (!username || !password) {
    return NextResponse.json(
      { error: "SIP credentials not configured" },
      { status: 500 }
    );
  }

  return NextResponse.json({ username, password });
}
