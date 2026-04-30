import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Conference "End for All" — hang up every participant leg. Used by
// the UI's "End for All" button when the rep wants the entire 3-way
// conversation to end (vs. "Leave Conference" which keeps customer
// and destination connected).
//
// Body: { conferenceId }
// Returns: { success: true, hung_up: ['rep','customer','consult'] }
//
// Logged with [conf/end-for-all] prefix.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { conferenceId } = body as { conferenceId?: string };

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!conferenceId) {
    return NextResponse.json(
      { error: "conferenceId required" },
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

  // Look up the persisted ccids for this conference.
  const admin = createAdminClient();
  const { data: row } = await admin
    .from("call_conferences")
    .select("rep_ccid, customer_ccid, consult_ccid, status")
    .eq("telnyx_conference_id", conferenceId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json(
      { error: "Conference not found" },
      { status: 404 }
    );
  }

  console.log(
    `[conf/end-for-all] user=${user.id} conferenceId=${conferenceId}`
  );

  const targets = [
    { label: "rep", ccid: row.rep_ccid as string },
    { label: "customer", ccid: row.customer_ccid as string },
    { label: "consult", ccid: row.consult_ccid as string },
  ];

  const hungUp: string[] = [];
  for (const t of targets) {
    try {
      const res = await fetch(
        `https://api.telnyx.com/v2/calls/${t.ccid}/actions/hangup`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      console.log(
        `[conf/end-for-all] hangup ${t.label} ccid=${t.ccid} status=${res.status}`
      );
      // 422 ("Call has already ended") is acceptable — leg might
      // already be down. Don't fail the whole operation on it.
      if (res.ok || res.status === 422) {
        hungUp.push(t.label);
      }
    } catch (err) {
      console.warn(
        `[conf/end-for-all] hangup ${t.label} threw:`,
        (err as Error).message
      );
    }
  }

  return NextResponse.json({
    success: true,
    hung_up: hungUp,
  });
}
