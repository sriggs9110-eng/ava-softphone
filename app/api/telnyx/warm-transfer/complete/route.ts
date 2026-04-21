import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Warm transfer — step 2a (Complete).
//
// Bridges the ORIGINAL caller's external leg (currently on hold) to
// the transfer TARGET's external leg. Rep's two WebRTC legs drop as
// Telnyx reassigns the bridges. Analogous to the blind-transfer fix:
// we target carrier legs, not the rep's WebRTC legs.
//
// Body: { repCcid, targetRepCcid }
//   repCcid       = rep's WebRTC ccid on the original (held) call
//   targetRepCcid = rep's WebRTC ccid on the outbound to the transfer target
// Returns: { success, externalCcid, targetExternalCcid }
//
// Logged with [warm/complete] prefix.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repCcid, targetRepCcid } = body as {
    repCcid?: string;
    targetRepCcid?: string;
  };

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!repCcid || !targetRepCcid) {
    return NextResponse.json(
      { error: "repCcid and targetRepCcid required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const rows = await admin
    .from("call_logs")
    .select("call_control_id, external_ccid, created_at")
    .in("call_control_id", [repCcid, targetRepCcid])
    .order("created_at", { ascending: false });

  const byCcid = new Map<string, string | null>();
  for (const r of (rows.data || []) as Array<{
    call_control_id: string;
    external_ccid: string | null;
  }>) {
    if (!byCcid.has(r.call_control_id)) {
      byCcid.set(r.call_control_id, r.external_ccid);
    }
  }

  const externalCcid = byCcid.get(repCcid) || null;
  const targetExternalCcid = byCcid.get(targetRepCcid) || null;

  if (!externalCcid || !targetExternalCcid) {
    console.log(
      `[warm/complete] missing external ccid(s) — repCcid=${repCcid} externalCcid=${externalCcid ?? "(missing)"} targetRepCcid=${targetRepCcid} targetExternalCcid=${targetExternalCcid ?? "(missing)"}`
    );
    return NextResponse.json(
      {
        error:
          "External legs not captured on one or both calls. call.bridged hasn't fired yet — try again in a moment.",
      },
      { status: 409 }
    );
  }

  console.log(
    `[warm/complete] request repCcid=${repCcid} externalCcid=${externalCcid} targetRepCcid=${targetRepCcid} targetExternalCcid=${targetExternalCcid}`
  );

  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${externalCcid}/actions/bridge`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: targetExternalCcid }),
    }
  );
  const data = await res.json().catch(() => ({}));
  console.log(
    `[warm/complete] response status=${res.status} responseBody=${JSON.stringify(data)}`
  );

  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "Bridge failed";
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  return NextResponse.json({
    success: true,
    externalCcid,
    targetExternalCcid,
  });
}
