import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Warm (attended) transfer — step 1.
//
// Puts the original caller on hold at the Telnyx level by issuing
// actions/hold on the external leg (not the rep's WebRTC leg). The
// client then SDK-dials the transfer target so the rep can talk to
// them privately. Complete/Cancel bridge or resume as needed.
//
// Body: { repCcid: string }                 (destinationNumber is optional, not used here)
// Returns: { success, externalCcid }
//
// Logged with [warm/initiate] prefix.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repCcid } = body as { repCcid?: string; destinationNumber?: string };

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
      `[warm/initiate] no external_ccid captured for repCcid=${repCcid} — cannot hold external leg`
    );
    return NextResponse.json(
      {
        error:
          "External leg not captured yet — call.bridged webhook hasn't fired. Try again in a moment.",
      },
      { status: 409 }
    );
  }

  console.log(
    `[warm/initiate] request repCcid=${repCcid} externalCcid=${externalCcid} — hold`
  );

  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${externalCcid}/actions/hold`,
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
    `[warm/initiate] response status=${res.status} responseBody=${JSON.stringify(data)}`
  );

  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "Hold failed";
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  return NextResponse.json({ success: true, externalCcid });
}
