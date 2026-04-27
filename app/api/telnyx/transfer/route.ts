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
  // INBOUND: Telnyx confirmed in their docs that /actions/transfer
  // bridges the call_control_id's owner with the new destination. For
  // inbound calls the external_ccid we stamp at fan-out time IS the
  // customer's PSTN inbound leg (whose "owner" is the customer), so
  // /actions/transfer on it correctly bridges customer→new_dest and
  // drops the rep's fan-out leg. Keep this path.
  //
  // OUTBOUND: the rep's SDK initiates a single Call Control leg whose
  // "owner" is the rep. /actions/transfer on it bridges rep→new_dest
  // and drops the customer — exactly the wrong direction (customer
  // dropped, rep stuck on the line with the new party). Telnyx
  // doesn't expose a target_legs param on /actions/transfer
  // (target_legs="self" was tested and made things worse). The fix:
  // mirror the inbound fan-out primitive — POST /v2/calls with
  // link_to=outbound_ccid + bridge_on_answer=true. When Leg B
  // (transfer destination) answers, Telnyx auto-bridges Leg B into
  // the linked call. The rep's WebRTC leg drops as Telnyx tears down
  // the original outbound bridge.
  //
  // ⚠ Theory not yet field-tested: this MAY still bridge the wrong
  // side for outbound. If so, the next iteration is to fully refactor
  // around an explicit /actions/bridge after originating Leg B. The
  // diagnostic logging below ([transfer/blind/out] vs
  // [transfer/blind/in]) makes it obvious which path ran.

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

  // OUTBOUND path: link_to + bridge_on_answer.
  if (direction === "outbound") {
    const callControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;
    if (!callControlAppId) {
      return NextResponse.json(
        { error: "TELNYX_CALL_CONTROL_APP_ID not configured" },
        { status: 500 }
      );
    }
    const bodySent: Record<string, unknown> = {
      to: normalizedTo,
      from: fromNumber || normalizedTo,
      connection_id: callControlAppId,
      link_to: callControlId,
      bridge_on_answer: true,
      bridge_intent: true,
      timeout_secs: 30,
    };
    console.log(
      `[transfer/blind/out] request originating new leg link_to=${callControlId} to=${normalizedTo} from=${fromNumber ?? "(none)"}`
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
        "Outbound transfer (link_to) failed";
      return NextResponse.json({ error: detail }, { status: res.status });
    }
    return NextResponse.json({
      success: true,
      mode: "outbound_link_to",
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

