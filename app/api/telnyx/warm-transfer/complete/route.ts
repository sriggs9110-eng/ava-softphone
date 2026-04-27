import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Warm transfer — Complete.
//
// PREVIOUS APPROACHES (all unreliable):
//   1. /actions/bridge customer ↔ targetRepCcid (rep's SDK consult leg).
//      Returned 200 OK silently producing broken media — call dropped
//      for everyone.
//   2. hangup consult + /actions/transfer customer to=number. Telnyx
//      tears down target's phone via the consult hangup, then redials
//      from the customer leg. The redial has been failing in the
//      rep-first dial architecture: /actions/transfer on a server-
//      originated leg returns "no longer active" or drops the third
//      party (Stephen confirmed both).
//
// CURRENT APPROACH: /actions/bridge between the customer's PSTN leg
// (external_ccid on rep's row) and the consult-target's PSTN leg
// (looked up from call_logs). This breaks both of the rep's bridges
// atomically and joins customer↔target without ever hanging up the
// target's phone — they stay connected end-to-end.
//
// Finding the consult-target PSTN ccid: when the rep's SDK newCalls
// the target, Telnyx allocates a separate ccid for the outbound PSTN
// leg. The webhook on call.initiated inserts a call_logs row for it
// (direction=outbound, phone_number=target, with session_id), so we
// query for that row at complete-time.
//
// Body: { repCcid, targetRepCcid, targetPhoneNumber }
//   repCcid             = rep's ccid on the original (held) call
//   targetRepCcid       = rep's ccid on the SDK consult call
//   targetPhoneNumber   = phone number the rep typed for the transfer target
// Returns: { success, mode, customerCcid, consultTargetCcid?, targetPhoneNumber }
//
// Logged with [warm/complete] prefix.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repCcid, targetRepCcid, targetPhoneNumber } = body as {
    repCcid?: string;
    targetRepCcid?: string;
    targetPhoneNumber?: string;
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
  if (!targetPhoneNumber) {
    return NextResponse.json(
      { error: "targetPhoneNumber required" },
      { status: 400 }
    );
  }

  const normalizedTarget = targetPhoneNumber.startsWith("+")
    ? targetPhoneNumber
    : `+${targetPhoneNumber}`;

  // Look up the rep's row to find the customer's external_ccid.
  const admin = createAdminClient();
  const { data: repRow } = await admin
    .from("call_logs")
    .select("call_control_id, external_ccid, from_number")
    .eq("call_control_id", repCcid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const externalCcid = (repRow?.external_ccid as string | null) || null;

  if (!externalCcid) {
    console.log(
      `[warm/complete] no external_ccid for repCcid=${repCcid} — cannot do customer-leg transfer; falling back to /actions/bridge`
    );
    // Fall back to old bridge behavior (still broken for some cases,
    // but matches prior contract). Cleaner UX path requires
    // external_ccid, which only exists for inbound calls routed via
    // fan-out pairing (or post-hoc cross-stamp).
    const res = await fetch(
      `https://api.telnyx.com/v2/calls/${repCcid}/actions/bridge`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ call_control_id: targetRepCcid }),
      }
    );
    const data = await res.json().catch(() => ({}));
    console.log(
      `[warm/complete/fallback-bridge] status=${res.status} body=${JSON.stringify(data).slice(0, 400)}`
    );
    if (!res.ok) {
      return NextResponse.json(
        {
          error:
            data?.errors?.[0]?.detail ||
            data?.errors?.[0]?.title ||
            "Bridge failed",
        },
        { status: res.status }
      );
    }
    return NextResponse.json({
      success: true,
      mode: "fallback_bridge",
    });
  }

  // Strategy: /actions/bridge customer's leg → consult-target's PSTN
  // leg. The rep is in two simultaneous bridges (rep↔customer original
  // call, and rep↔target consult call). Bridging customer↔target
  // directly breaks BOTH of the rep's bridges atomically and joins
  // customer↔target without ever hanging up target's phone (which is
  // what the previous hangup+/actions/transfer path was doing — and
  // failing on, because /actions/transfer on a server-originated leg
  // has been unreliable with the rep-first dial architecture).
  //
  // The catch: we need the consult-target's PSTN ccid. The rep's SDK
  // only knows ITS leg of the consult (targetRepCcid); the PSTN leg
  // Telnyx allocated to dial the target has a different ccid. The
  // webhook on call.initiated inserts a call_logs row for that PSTN
  // leg (direction=outbound, phone_number=targetPhoneNumber,
  // call_session_id=<consult session>), which we can look up here.

  // Step 1: find the consult-target's PSTN ccid. Most recent outbound
  // row for targetPhoneNumber within the last ~3 minutes that is NOT
  // the original customer leg.
  const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const targetBare = normalizedTarget.startsWith("+")
    ? normalizedTarget.slice(1)
    : normalizedTarget;
  const phoneCandidates = [normalizedTarget, targetBare];
  let consultTargetCcid: string | null = null;
  let consultRowId: string | null = null;
  for (const p of phoneCandidates) {
    const { data: rows } = await admin
      .from("call_logs")
      .select("id, call_control_id, call_session_id, created_at")
      .eq("phone_number", p)
      .eq("direction", "outbound")
      .gte("created_at", cutoff)
      .not("call_control_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const r of (rows || []) as Array<{
      id: string;
      call_control_id: string | null;
      call_session_id: string | null;
      created_at: string;
    }>) {
      // Skip the original customer leg (already bridged with rep).
      if (r.call_control_id === externalCcid) continue;
      // Skip the rep's SDK consult leg if it happens to match.
      if (r.call_control_id === targetRepCcid) continue;
      // Skip the rep's main leg.
      if (r.call_control_id === repCcid) continue;
      consultTargetCcid = r.call_control_id;
      consultRowId = r.id;
      break;
    }
    if (consultTargetCcid) break;
  }

  if (!consultTargetCcid) {
    console.error(
      `[warm/complete] could NOT find consult-target PSTN ccid for to=${normalizedTarget} repCcid=${repCcid} customerCcid=${externalCcid} targetRepCcid=${targetRepCcid} — no call_logs row matched. Falling back to hangup+transfer.`
    );
    return await fallbackHangupTransfer({
      apiKey,
      targetRepCcid,
      externalCcid,
      normalizedTarget,
      fromNumber: (repRow?.from_number as string | null) || null,
    });
  }

  console.log(
    `[warm/complete] resolved consultTargetCcid=${consultTargetCcid} (row=${consultRowId}) — bridging customer=${externalCcid} → consultTarget=${consultTargetCcid}`
  );

  // Step 2: /actions/bridge customer leg → consult target leg. This is
  // a single atomic operation in Telnyx: it breaks both existing
  // bridges (rep↔customer and rep↔consultTarget) and joins
  // customer↔consultTarget. Both rep legs become unbridged; Telnyx
  // tears them down.
  const bridgeRes = await fetch(
    `https://api.telnyx.com/v2/calls/${externalCcid}/actions/bridge`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: consultTargetCcid }),
    }
  );
  const bridgeData = await bridgeRes.json().catch(() => ({}));
  console.log(
    `[warm/complete] bridge status=${bridgeRes.status} customerCcid=${externalCcid} consultTargetCcid=${consultTargetCcid} body=${JSON.stringify(bridgeData).slice(0, 400)}`
  );

  if (!bridgeRes.ok) {
    const detail =
      bridgeData?.errors?.[0]?.detail ||
      bridgeData?.errors?.[0]?.title ||
      "Bridge failed";
    console.error(
      `[warm/complete] bridge FAILED ${bridgeRes.status} — falling back to hangup+transfer: ${detail}`
    );
    return await fallbackHangupTransfer({
      apiKey,
      targetRepCcid,
      externalCcid,
      normalizedTarget,
      fromNumber: (repRow?.from_number as string | null) || null,
    });
  }

  // Stamp Row A's external_ccid → consultTargetCcid so the new bridged
  // leg becomes the addressable customer leg for any subsequent
  // transfer the rep might do (chain transfer). Best-effort.
  try {
    await admin
      .from("call_logs")
      .update({ external_ccid: consultTargetCcid })
      .eq("call_control_id", repCcid);
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    success: true,
    mode: "actions_bridge",
    customerCcid: externalCcid,
    consultTargetCcid,
    targetPhoneNumber: normalizedTarget,
  });
}

// Fallback: the legacy hangup+transfer path. Used when we can't find
// the consult-target's PSTN ccid (race / missing call_logs row) or
// when /actions/bridge fails. Imperfect — Stephen has reported this
// path dropping the third party — but better than no transfer attempt.
async function fallbackHangupTransfer(args: {
  apiKey: string;
  targetRepCcid: string;
  externalCcid: string;
  normalizedTarget: string;
  fromNumber: string | null;
}): Promise<NextResponse> {
  const { apiKey, targetRepCcid, externalCcid, normalizedTarget, fromNumber } =
    args;

  console.log(
    `[warm/complete/fallback] hangup consult targetRepCcid=${targetRepCcid}`
  );
  await fetch(
    `https://api.telnyx.com/v2/calls/${targetRepCcid}/actions/hangup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  ).catch(() => {});

  const transferBody: Record<string, unknown> = { to: normalizedTarget };
  if (fromNumber && /^\+?\d{7,15}$/.test(fromNumber)) {
    transferBody.from = fromNumber.startsWith("+") ? fromNumber : `+${fromNumber}`;
  } else if (process.env.TELNYX_PHONE_NUMBER) {
    const env = process.env.TELNYX_PHONE_NUMBER;
    transferBody.from = env.startsWith("+") ? env : `+${env}`;
  }

  console.log(
    `[warm/complete/fallback] /actions/transfer customer_leg=${externalCcid} to=${normalizedTarget}`
  );
  const transferRes = await fetch(
    `https://api.telnyx.com/v2/calls/${externalCcid}/actions/transfer`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(transferBody),
    }
  );
  const transferData = await transferRes.json().catch(() => ({}));
  console.log(
    `[warm/complete/fallback] transfer status=${transferRes.status} body=${JSON.stringify(transferData).slice(0, 400)}`
  );

  if (!transferRes.ok) {
    const detail =
      transferData?.errors?.[0]?.detail ||
      transferData?.errors?.[0]?.title ||
      "Warm transfer failed";
    return NextResponse.json({ error: detail }, { status: transferRes.status });
  }

  return NextResponse.json({
    success: true,
    mode: "fallback_hangup_transfer",
    externalCcid,
    targetPhoneNumber: normalizedTarget,
  });
}
