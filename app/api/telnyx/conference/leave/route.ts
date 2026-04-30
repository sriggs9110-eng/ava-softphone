import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";

// Conference leave — server-side. Removes a participant (typically
// the rep) from a conference. The conference.participant_left webhook
// then handles call_logs closure, recording stop, and AI-analysis
// pipeline trigger. See app/api/telnyx/webhook/route.ts.
//
// Body: { conferenceId, ccid }
//   conferenceId = telnyx_conference_id
//   ccid         = the leg leaving (rep's WebRTC ccid in the typical
//                  flow). The client should call SDK.hangup() on its
//                  own WebRTC call object after this returns to free
//                  local resources; Telnyx will BYE the leg as part
//                  of the leave/hangup chain.
//
// Returns: { success: true } on 2xx.
//
// Logged with [conf/leave] prefix.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { conferenceId, ccid } = body as {
    conferenceId?: string;
    ccid?: string;
  };

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!conferenceId || !ccid) {
    return NextResponse.json(
      { error: "conferenceId and ccid required" },
      { status: 400 }
    );
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  console.log(
    `[conf/leave] request user=${user.id} conferenceId=${conferenceId} ccid=${ccid}`
  );

  const res = await fetch(
    `https://api.telnyx.com/v2/conferences/${conferenceId}/actions/leave`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: ccid }),
    }
  );
  const respBody = await res.json().catch(() => ({}));
  console.log(
    `[conf/leave] response status=${res.status} body=${JSON.stringify(respBody).slice(0, 300)}`
  );

  if (!res.ok) {
    const detail =
      respBody?.errors?.[0]?.detail ||
      respBody?.errors?.[0]?.title ||
      "Leave failed";
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  return NextResponse.json({ success: true });
}
