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
  const connectionId = process.env.TELNYX_CONNECTION_ID;
  if (!connectionId) {
    console.log("[transfer] TELNYX_CONNECTION_ID missing");
    return NextResponse.json(
      { error: "TELNYX_CONNECTION_ID not configured" },
      { status: 500 }
    );
  }

  const from = await resolveBlindTransferFrom(callControlId);

  // POST /v2/calls with link_to + bridge_on_answer.
  //
  // - `link_to`: puts the new call into the same call_session_id as the
  //   existing call, so Telnyx's internal bookkeeping knows they're
  //   related.
  // - `bridge_on_answer`: once the destination answers, Telnyx auto-
  //   bridges the two calls.
  // - `bridge_intent`: declares up-front that we intend to bridge —
  //   Telnyx uses this to keep the parked state consistent.
  const bodySent: Record<string, unknown> = {
    to,
    from,
    connection_id: connectionId,
    link_to: callControlId,
    bridge_on_answer: true,
    bridge_intent: true,
    // Leave ringing for 30s before giving up on the destination.
    timeout_secs: 30,
  };

  console.log(
    `[transfer] request callControlId=${callControlId} to=${to} from=${from} bodySent=${JSON.stringify(
      bodySent
    )}`
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
    `[transfer] response status=${res.status} responseBody=${JSON.stringify(
      data
    )}`
  );

  if (!res.ok) {
    const detail = data?.errors?.[0]?.detail || "Blind transfer dial failed";
    console.log(
      `[transfer] blind FAILED ${res.status} ccid=${callControlId} to=${to} from=${from}: ${detail}`
    );
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  const newCcid =
    (data?.data?.call_control_id as string | undefined) || null;
  console.log(
    `[transfer] blind ok ccid=${callControlId} to=${to} from=${from} newCcid=${newCcid}`
  );

  return NextResponse.json({
    success: true,
    new_call_control_id: newCcid,
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

// Picks a Telnyx-owned phone number to use as the `from` (caller ID) of
// the new outbound leg for a blind transfer. Telnyx rejects any non-
// verified, non-account-owned number with "Unverified origination
// number D51".
//
// Priority:
//   1. The original call's recorded from_number or phone_number (whichever
//      is ours), IF it matches an active row in phone_number_pool.
//   2. TELNYX_PHONE_NUMBER env var — always guaranteed Telnyx-owned.
async function resolveBlindTransferFrom(callControlId: string): Promise<string> {
  const fallback = process.env.TELNYX_PHONE_NUMBER;
  try {
    const admin = createAdminClient();

    const { data: logRow } = await admin
      .from("call_logs")
      .select("from_number, phone_number")
      .eq("call_control_id", callControlId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const candidates = new Set<string>();
    for (const raw of [logRow?.from_number, logRow?.phone_number]) {
      if (!raw) continue;
      candidates.add(raw);
      if (raw.startsWith("+")) candidates.add(raw.slice(1));
      else candidates.add(`+${raw}`);
    }

    if (candidates.size > 0) {
      const { data: poolRows } = await admin
        .from("phone_number_pool")
        .select("phone_number")
        .eq("is_active", true)
        .in("phone_number", Array.from(candidates));

      if (poolRows && poolRows.length > 0) {
        const match = poolRows[0].phone_number as string;
        console.log(
          `[transfer] from resolved from pool ccid=${callControlId} from=${match}`
        );
        return match.startsWith("+") ? match : `+${match}`;
      }
    }
  } catch (err) {
    console.log(
      `[transfer] from-lookup failed, using env fallback: ${
        (err as Error).message
      }`
    );
  }

  if (!fallback) {
    throw new Error(
      "TELNYX_PHONE_NUMBER env var not set and no pool match — cannot set `from`"
    );
  }
  const normalized = fallback.startsWith("+") ? fallback : `+${fallback}`;
  console.log(
    `[transfer] from using env fallback ccid=${callControlId} from=${normalized}`
  );
  return normalized;
}
