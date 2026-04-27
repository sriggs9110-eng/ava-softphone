import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Warm transfer — Complete.
//
// Architecture (after warm-transfer/start refactor):
//   repCcid          ↔ customerCcid          (original; customer on hold)
//   repConsultCcid   ↔ targetConsultCcid     (consult; rep talking to target)
//
// All four legs are originated through the Call Control App (no
// cross-connection bridging), and all four ccids are stamped in
// call_logs:
//
//   row(repCcid).external_ccid        = customerCcid
//   row(repConsultCcid).external_ccid = targetConsultCcid
//
// Complete = ONE atomic operation: /actions/bridge customerCcid ↔
// targetConsultCcid. Telnyx breaks both rep bridges and joins
// customer↔target. Both rep legs become unbridged and Telnyx tears
// them down; the SDK gets BYE on each.
//
// Why this works where prior attempts didn't:
//   - SDK.newCall consult put the consult target on the credential
//     connection. Bridging across credential ↔ Call Control App
//     connections has been silently broken.
//   - /actions/transfer on a server-originated leg has been returning
//     "no longer active" or dropping the third party.
//   - With ALL legs in the Call Control App, /actions/bridge between
//     them is well-defined.
//
// Body: { repCcid, repConsultCcid }
// Returns: { success, customerCcid, targetConsultCcid }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repCcid, repConsultCcid } = body as {
    repCcid?: string;
    repConsultCcid?: string;
  };

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!repCcid || !repConsultCcid) {
    return NextResponse.json(
      { error: "repCcid and repConsultCcid required" },
      { status: 400 }
    );
  }

  // Look up customerCcid via the original call's row.
  const admin = createAdminClient();
  const { data: repRow } = await admin
    .from("call_logs")
    .select("call_control_id, external_ccid")
    .eq("call_control_id", repCcid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const customerCcid = (repRow?.external_ccid as string | null) || null;

  if (!customerCcid) {
    console.error(
      `[warm/complete] no external_ccid for repCcid=${repCcid} — customer leg not stamped`
    );
    return NextResponse.json(
      { error: "Customer leg not found — cannot complete transfer" },
      { status: 500 }
    );
  }

  // Look up targetConsultCcid via the consult call's row.
  const { data: consultRow } = await admin
    .from("call_logs")
    .select("call_control_id, external_ccid")
    .eq("call_control_id", repConsultCcid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const targetConsultCcid =
    (consultRow?.external_ccid as string | null) || null;

  if (!targetConsultCcid) {
    console.error(
      `[warm/complete] no external_ccid for repConsultCcid=${repConsultCcid} — target leg not stamped (webhook race?)`
    );
    return NextResponse.json(
      {
        error:
          "Target leg not found — try again, or cancel and retry the warm transfer",
      },
      { status: 500 }
    );
  }

  console.log(
    `[warm/complete] bridging customerCcid=${customerCcid} ↔ targetConsultCcid=${targetConsultCcid}`
  );
  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${customerCcid}/actions/bridge`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: targetConsultCcid }),
    }
  );
  const data = await res.json().catch(() => ({}));
  console.log(
    `[warm/complete] bridge status=${res.status} body=${JSON.stringify(data).slice(0, 400)}`
  );

  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.title ||
      "Bridge failed";
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  // Repoint the original row's external_ccid at targetConsultCcid so a
  // subsequent transfer-after-warm-transfer addresses the new bridged
  // far party. Best-effort.
  try {
    await admin
      .from("call_logs")
      .update({ external_ccid: targetConsultCcid })
      .eq("call_control_id", repCcid);
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    success: true,
    customerCcid,
    targetConsultCcid,
  });
}
