import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Transfer modes.
 *
 *   Blind transfer (default UI path): { call_control_id, to }
 *     Instead of Telnyx's `/actions/transfer` (which half-bridged on
 *     WebRTC source legs — destination answered but never got
 *     call.bridged, so audio never flowed) we now dial a new outbound
 *     call with link_to + bridge_on_answer. Telnyx auto-bridges the new
 *     leg into the existing call's session on answer. The rep's WebRTC
 *     leg is then hung up client-side, leaving the original far-side
 *     party talking to the new destination.
 *
 *     Endpoint: POST /v2/calls
 *     Body: { to, from, connection_id, link_to, bridge_on_answer,
 *             bridge_intent }
 *
 *   Attended/bridge transfer (warm): { call_control_id, transfer_to_call_control_id }
 *     POST /v2/calls/{id}/actions/bridge — for the warm-transfer flow
 *     where the rep already has two WebRTC legs and wants to merge them.
 *     Kept for the "Complete Transfer" button and Conference (Merge All).
 *
 * Both paths leave the rep's WebRTC leg for the client to hang up;
 * Telnyx's hangup webhook cleans up state.
 */

const TELNYX_API = "https://api.telnyx.com/v2";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { call_control_id, transfer_to_call_control_id, to } = body as {
    call_control_id?: string;
    transfer_to_call_control_id?: string;
    to?: string;
  };

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Telnyx API not configured" },
      { status: 500 }
    );
  }
  if (!call_control_id) {
    return NextResponse.json(
      { error: "call_control_id is required" },
      { status: 400 }
    );
  }
  if (!to && !transfer_to_call_control_id) {
    return NextResponse.json(
      { error: "Either `to` (blind) or `transfer_to_call_control_id` (attended) required" },
      { status: 400 }
    );
  }

  const mode: "blind" | "attended" = to ? "blind" : "attended";

  try {
    if (mode === "blind") {
      return await blindTransfer({ callControlId: call_control_id, to: to!, apiKey });
    }
    return await attendedBridge({
      callControlId: call_control_id,
      transferToCallControlId: transfer_to_call_control_id!,
      apiKey,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[transfer] threw mode=${mode}: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function blindTransfer(args: {
  callControlId: string;
  to: string;
  apiKey: string;
}): Promise<NextResponse> {
  const { callControlId, to, apiKey } = args;

  // Blind transfer split by call direction:
  //
  // INBOUND (unchanged): /actions/transfer on external_ccid (the
  // customer's PSTN inbound leg). Telnyx bridges customer→new_dest
  // and drops the rep's fan-out leg. Works because the customer is
  // the "owner" of their own PSTN ccid.
  //
  // OUTBOUND: originate-then-bridge.
  //
  //   Replaces the prior link_to + bridge_on_answer mechanism, which
  //   pre-unbridged the customer's PSTN leg in anticipation of the
  //   auto-bridge. Confirmed in production 2026-04-29 19:39 UTC: a
  //   link_to originate at 19:39:22 caused Leg A (customer PSTN, ccid
  //   YVpDcom...) to die at 19:39:31 — 9 seconds after the new leg was
  //   created, BEFORE the destination ever answered.
  //
  //   New flow:
  //     1. POST /v2/calls (no link_to, no bridge_on_answer) with
  //        client_state={type:"blind_xfer_bridge", customer_ccid, rep_ccid}.
  //     2. Return success immediately to the client.
  //     3. The call.answered webhook handler reads client_state when
  //        the new leg picks up, and POSTs /actions/bridge to merge
  //        the new leg with the customer's PSTN leg. Telnyx unbridges
  //        the rep's WebRTC leg as a side effect.
  //     4. If the new leg never answers (no_answer / busy / declined /
  //        canceled), the call.hangup webhook broadcasts
  //        blind_xfer_failed on user:<repUserId> Realtime so the UI
  //        can show "Transfer destination didn't pick up — call still
  //        active." within ~35s.
  //     5. If the customer's leg dies before the bridge fires, the
  //        bridge POST returns non-2xx and we /actions/hangup the
  //        orphan new leg explicitly.
  //
  //   Requires the original call to have an external_ccid stamped
  //   (i.e., dialed via ?new_dial=1's two-leg path). Without it, we
  //   don't know which customer leg to bridge into.

  const admin = createAdminClient();
  const { data: logRow } = await admin
    .from("call_logs")
    .select(
      "id, direction, call_control_id, external_ccid, phone_number, from_number"
    )
    .eq("call_control_id", callControlId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const externalCcid = (logRow?.external_ccid as string | null) || null;
  const direction = (logRow?.direction as string | null) || null;

  const normalizedTo = to.startsWith("+") ? to : `+${to}`;
  const storedFrom = logRow?.from_number as string | null | undefined;
  const envFrom = process.env.TELNYX_PHONE_NUMBER;
  let fromNumber: string | null = null;
  if (storedFrom && /^\+?\d{7,15}$/.test(storedFrom)) {
    fromNumber = storedFrom.startsWith("+") ? storedFrom : `+${storedFrom}`;
  } else if (envFrom) {
    fromNumber = envFrom.startsWith("+") ? envFrom : `+${envFrom}`;
  }

  if (direction === "outbound") {
    const callControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;
    if (!callControlAppId) {
      return NextResponse.json(
        { error: "TELNYX_CALL_CONTROL_APP_ID not configured" },
        { status: 500 }
      );
    }
    if (!externalCcid) {
      console.log(
        `[transfer/blind/out] no external_ccid for ccid=${callControlId} — outbound blind transfer requires the two-leg dial path`
      );
      return NextResponse.json(
        {
          error:
            "Blind transfer not supported on this call. Outbound calls placed via the legacy SDK path don't have a separately addressable customer leg. Place the call with ?new_dial=1 (two-leg) to enable transfer.",
        },
        { status: 409 }
      );
    }
    // Telnyx limits client_state to 4KB. Current payload is ~150 bytes
    // base64. Don't pile fields here without checking the size.
    const clientStatePayload = {
      type: "blind_xfer_bridge" as const,
      customer_ccid: externalCcid,
      rep_ccid: callControlId,
    };
    const clientState = Buffer.from(
      JSON.stringify(clientStatePayload)
    ).toString("base64");

    const bodySent: Record<string, unknown> = {
      to: normalizedTo,
      from: fromNumber || normalizedTo,
      connection_id: callControlAppId,
      timeout_secs: 30,
      client_state: clientState,
    };
    console.log(
      `[transfer/blind/out] originate to=${normalizedTo} from=${fromNumber ?? "(none)"} customer_ccid=${externalCcid} rep_ccid=${callControlId} (bridge fires on call.answered via webhook)`
    );
    const res = await fetch(`${TELNYX_API}/calls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bodySent),
    });
    const data = await res.json().catch(() => ({}));
    console.log(
      `[transfer/blind/out] response status=${res.status} body=${JSON.stringify(data).slice(0, 600)}`
    );
    if (!res.ok) {
      const detail =
        data?.errors?.[0]?.detail ||
        data?.errors?.[0]?.title ||
        "Outbound transfer originate failed";
      return NextResponse.json({ error: detail }, { status: res.status });
    }
    return NextResponse.json({
      success: true,
      mode: "outbound_originate_then_bridge",
      new_leg_ccid: data?.data?.call_control_id,
    });
  }

  // INBOUND path (and fallback when direction is unknown):
  // /actions/transfer on the external_ccid (or repCcid as last-ditch
  // fallback for legacy rows without a stamped external).
  const targetCcid = externalCcid || callControlId;
  if (!externalCcid) {
    console.log(
      `[transfer/fallback] no external_ccid captured for ccid=${callControlId} (direction=${direction ?? "?"}) — transferring rep's leg (may fail)`
    );
  }

  const bodySent: Record<string, unknown> = { to: normalizedTo };
  if (fromNumber) bodySent.from = fromNumber;

  const endpoint = `${TELNYX_API}/calls/${targetCcid}/actions/transfer`;

  console.log(
    `[transfer/blind/in] request targetCcid=${targetCcid} externalCcid=${externalCcid ?? "(missing)"} repCcid=${callControlId} to=${normalizedTo} bodySent=${JSON.stringify(
      bodySent
    )}`
  );

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodySent),
  });
  const data = await res.json().catch(() => ({}));

  console.log(
    `[transfer/blind/in] response status=${res.status} responseBody=${JSON.stringify(
      data
    )}`
  );

  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.title ||
      "Blind transfer failed";
    console.log(
      `[transfer/blind/in] FAILED ${res.status} targetCcid=${targetCcid} to=${normalizedTo}: ${detail}`
    );
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  console.log(
    `[transfer/blind/in] ok targetCcid=${targetCcid} to=${normalizedTo} — waiting for hangup of rep's leg`
  );

  return NextResponse.json({
    success: true,
    target_call_control_id: targetCcid,
    used_external_leg: Boolean(externalCcid),
  });
}

async function attendedBridge(args: {
  callControlId: string;
  transferToCallControlId: string;
  apiKey: string;
}): Promise<NextResponse> {
  const { callControlId, transferToCallControlId, apiKey } = args;
  const endpoint = `${TELNYX_API}/calls/${callControlId}/actions/bridge`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ call_control_id: transferToCallControlId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail || "Bridge failed";
    console.log(
      `[transfer] bridge FAILED ${res.status} original=${callControlId} target=${transferToCallControlId}: ${detail}`
    );
    return NextResponse.json({ error: detail }, { status: res.status });
  }
  console.log(
    `[transfer] bridged original=${callControlId} target=${transferToCallControlId}`
  );
  return NextResponse.json(data);
}

