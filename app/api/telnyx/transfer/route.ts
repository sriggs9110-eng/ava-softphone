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

  // Blind transfer uses /actions/transfer on the EXTERNAL leg of the
  // rep's existing bridge. REFER was rejected by Telnyx because it
  // can't target a SIP address on their own domain; for PSTN hand-off,
  // /actions/transfer with a plain phone number is the right primitive.
  // The key correctness win is still targeting the external leg, not
  // the rep's WebRTC leg — the prior version transferred the rep's
  // side which collapsed the bridge.
  //
  // external_ccid is stamped on call_logs by the call.bridged webhook
  // handler. If it's not populated (e.g. call predates the feature),
  // we fall back to the rep's ccid with a [transfer/fallback] warning.

  const admin = createAdminClient();
  const { data: logRow } = await admin
    .from("call_logs")
    .select("id, call_control_id, external_ccid, phone_number, from_number")
    .eq("call_control_id", callControlId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const externalCcid =
    (logRow?.external_ccid as string | null) || null;

  const targetCcid = externalCcid || callControlId;
  if (!externalCcid) {
    console.log(
      `[transfer/fallback] no external_ccid captured for ccid=${callControlId} — transferring rep's leg (may fail)`
    );
  }

  // `from` on /actions/transfer must be a Telnyx-owned number. Without
  // it, Telnyx defaults to the original call's `to`, which for the
  // external leg is the PSTN destination — rejected with "Unverified
  // origination number D51". Priority: the business number that was
  // used as caller-ID on the original call (from_number stamped by the
  // webhook), then TELNYX_PHONE_NUMBER.
  const normalizedTo = to.startsWith("+") ? to : `+${to}`;
  const storedFrom = logRow?.from_number as string | null | undefined;
  const envFrom = process.env.TELNYX_PHONE_NUMBER;
  let fromNumber: string | null = null;
  if (storedFrom && /^\+?\d{7,15}$/.test(storedFrom)) {
    fromNumber = storedFrom.startsWith("+") ? storedFrom : `+${storedFrom}`;
  } else if (envFrom) {
    fromNumber = envFrom.startsWith("+") ? envFrom : `+${envFrom}`;
  }

  // For OUTBOUND SDK calls (single Call Control leg), Telnyx's default
  // /actions/transfer keeps the originator side (rep's WebRTC) bridged
  // to the new dial and drops the OPPOSITE side (the customer). That's
  // backwards from what we want — we want the customer redirected and
  // the rep dropped. target_legs="self" tells Telnyx to replace the
  // SELF leg (the one that owns this ccid = the originator) with the
  // new dial, so the OPPOSITE side (customer) gets bridged to it.
  // Documented for /actions/dtmf as "self|opposite"; not officially
  // listed for /actions/transfer but Telnyx's API often accepts it
  // silently. Harmless if ignored.
  const bodySent: Record<string, unknown> = {
    to: normalizedTo,
    target_legs: "self",
  };
  if (fromNumber) bodySent.from = fromNumber;

  const endpoint = `${TELNYX_API}/calls/${targetCcid}/actions/transfer`;

  console.log(
    `[transfer/blind] request targetCcid=${targetCcid} externalCcid=${externalCcid ?? "(missing)"} repCcid=${callControlId} to=${normalizedTo} bodySent=${JSON.stringify(
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
    `[transfer/blind] response status=${res.status} responseBody=${JSON.stringify(
      data
    )}`
  );

  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.title ||
      "Blind transfer failed";
    console.log(
      `[transfer/blind] FAILED ${res.status} targetCcid=${targetCcid} to=${normalizedTo}: ${detail}`
    );
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  console.log(
    `[transfer/blind] ok targetCcid=${targetCcid} to=${normalizedTo} — waiting for hangup of rep's leg`
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

