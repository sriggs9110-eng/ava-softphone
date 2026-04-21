import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Warm transfer — step 2b (Cancel).
//
// Releases the hold on the original caller's external leg so the rep
// can resume talking to them. The client hangs up the transfer-target
// leg via the SDK — we don't need the server to do that.
//
// Body: { repCcid }
// Returns: { success, externalCcid }
//
// Logged with [warm/cancel] prefix.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repCcid } = body as { repCcid?: string };

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!repCcid) {
    return NextResponse.json({ error: "repCcid required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("call_logs")
    .select("external_ccid")
    .eq("call_control_id", repCcid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const externalCcid = (row?.external_ccid as string | null) || null;
  if (!externalCcid) {
    console.log(
      `[warm/cancel] no external_ccid for repCcid=${repCcid} — cannot unhold`
    );
    return NextResponse.json(
      { error: "External leg not captured" },
      { status: 409 }
    );
  }

  console.log(
    `[warm/cancel] request repCcid=${repCcid} externalCcid=${externalCcid} — unhold`
  );

  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${externalCcid}/actions/unhold`,
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
    `[warm/cancel] response status=${res.status} responseBody=${JSON.stringify(data)}`
  );

  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.title ||
      "Unhold failed";
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  return NextResponse.json({ success: true, externalCcid });
}
