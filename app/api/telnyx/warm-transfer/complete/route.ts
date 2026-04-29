import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Warm transfer — step 2a (Complete).
//
// Strategy: hangup the consult leg (rep ↔ target), then /actions/transfer
// on the customer's PSTN inbound leg with `to=target_phone_number`. Telnyx
// redials the target; when the target picks up, customer↔target is
// bridged automatically because /actions/transfer keeps the
// call_control_id's owner connected (and for the customer leg the owner
// IS the customer). Rep drops naturally as Telnyx unbridges them.
//
// This replaces the earlier /actions/bridge approach, which produced an
// undefined media state for warm transfer (Stephen's report: "dropped
// the call for everyone except Pepper kept acting as if the call was
// live"). /actions/bridge between two single-leg calls didn't reliably
// merge the two PSTN sides.
//
// /actions/transfer on the customer's leg with a phone number is the
// SAME primitive that already works for blind transfer (commit
// 39dc099). This makes warm transfer = consult + blind transfer at the
// end, which is the standard SIP handoff pattern.
//
// Body: { repCcid, targetRepCcid, targetPhoneNumber }
//   repCcid             = rep's ccid on the original (held) call
//   targetRepCcid       = rep's ccid on the outbound consult call
//   targetPhoneNumber   = phone number the rep typed for the transfer target
// Returns: { success, externalCcid, targetPhoneNumber }
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

  // Reverted from /actions/bridge primary. Even with external_ccid
  // pointing at the customer's PSTN leg, /actions/bridge between that
  // leg and the consult call (target_call_ccid) returns HTTP 200 but
  // silently produces a broken media state — Stephen tested:
  // "able to speak to the third party but when I tried to make the
  // transfer happen it dropped the whole call for all 3". The HTTP
  // success makes the failure invisible to our fallback logic, so we
  // can't recover gracefully.
  //
  // Sticking with hangup+transfer: target's phone gets briefly hung
  // up and redialed, but the handoff completes reliably. Stephen
  // confirmed the previous deploy of this path "worked successfully"
  // — that's the path we keep.

  // Pre-flight liveness check on the customer leg.
  //
  // Production 2026-04-29 19:39 UTC: an earlier blind-transfer attempt
  // killed the customer leg ~28 seconds before /complete fired. Step 2
  // /actions/transfer then returned 422 "Call has already ended" —
  // technically correct but confusing as a UI message. A pre-flight
  // GET on the customer leg lets us return a specific 409 instead, so
  // the rep sees "Original caller's leg is no longer active" rather
  // than a generic Telnyx error. Same pattern as warm-transfer/initiate
  // (commit 0640b13).
  try {
    const probe = await fetch(
      `https://api.telnyx.com/v2/calls/${externalCcid}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (probe.ok) {
      const pbody = (await probe.json().catch(() => ({}))) as {
        data?: { is_alive?: boolean };
      };
      const alive = pbody?.data?.is_alive;
      if (alive === false) {
        console.log(
          `[warm/complete] customer leg not alive externalCcid=${externalCcid} — refusing transfer`
        );
        return NextResponse.json(
          {
            error:
              "Original caller's leg is no longer active. Hang up the consult and call the destination separately if needed.",
          },
          { status: 409 }
        );
      }
    }
    // Non-OK probe response (404, transient 5xx) is treated as
    // inconclusive — fall through to the existing hangup+transfer
    // and let Telnyx's response surface the real state.
  } catch (err) {
    console.warn(
      `[warm/complete] pre-flight probe threw — continuing:`,
      (err as Error).message
    );
  }

  // Step 1: hangup the consult call. Frees target's phone for redial.
  console.log(
    `[warm/complete] step 1: hangup consult targetRepCcid=${targetRepCcid}`
  );
  const hangupRes = await fetch(
    `https://api.telnyx.com/v2/calls/${targetRepCcid}/actions/hangup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );
  const hangupBody = await hangupRes.json().catch(() => ({}));
  console.log(
    `[warm/complete] hangup status=${hangupRes.status} body=${JSON.stringify(hangupBody).slice(0, 300)}`
  );

  // Step 2: /actions/transfer the customer's leg to target's phone.
  // Same primitive that works for blind transfer.
  const fromNumber = (repRow?.from_number as string | null) || null;
  const transferBody: Record<string, unknown> = { to: normalizedTarget };
  if (fromNumber && /^\+?\d{7,15}$/.test(fromNumber)) {
    transferBody.from = fromNumber.startsWith("+") ? fromNumber : `+${fromNumber}`;
  } else if (process.env.TELNYX_PHONE_NUMBER) {
    const env = process.env.TELNYX_PHONE_NUMBER;
    transferBody.from = env.startsWith("+") ? env : `+${env}`;
  }

  console.log(
    `[warm/complete] step 2: /actions/transfer customer_leg=${externalCcid} to=${normalizedTarget}`
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
    `[warm/complete] transfer status=${transferRes.status} body=${JSON.stringify(transferData).slice(0, 400)}`
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
    mode: "hangup_transfer",
    externalCcid,
    targetPhoneNumber: normalizedTarget,
  });
}
