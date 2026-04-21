import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Two transfer modes, chosen by request body shape.
 *
 *   Blind transfer (default UI path): { call_control_id, to }
 *     POST /v2/calls/{call_control_id}/actions/transfer { to, from }
 *     Telnyx creates a new outbound leg to `to` using `from` as caller
 *     ID, bridges it to the far side of `call_control_id`, and releases
 *     the rep's WebRTC leg. `from` MUST be a Telnyx-owned number on our
 *     account — if we omit it Telnyx defaults to the original call's
 *     `to` (an external number for rep-outbound calls), which trips the
 *     "Unverified origination number D51" rejection.
 *
 *   Attended/bridge transfer (warm): { call_control_id, transfer_to_call_control_id }
 *     POST /v2/calls/{call_control_id}/actions/bridge { call_control_id }
 *     For when the rep first dialed the target themselves, talked, then
 *     committed. Used by the "Conference (Merge All)" path and by the
 *     legacy warm-transfer "Complete Transfer" button.
 *
 * Both paths end with Telnyx dropping the rep's WebRTC leg via a normal
 * `callUpdate → hangup` event; do NOT hang up client-side first.
 */
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

  // Blind transfer takes precedence when both are supplied — the client
  // shouldn't send both, but if it does we prefer the simpler primitive.
  const mode: "blind" | "attended" = to ? "blind" : "attended";

  try {
    if (mode === "blind") {
      const from = await resolveBlindTransferFrom(call_control_id);
      const bodySent: { to: string; from: string } = { to: to!, from };

      console.log("[transfer] request", {
        callControlId: call_control_id,
        to,
        from,
        bodySent,
      });

      const endpoint = `https://api.telnyx.com/v2/calls/${call_control_id}/actions/transfer`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodySent),
      });
      const data = await res.json().catch(() => ({}));

      console.log("[transfer] response", {
        status: res.status,
        responseBody: data,
      });

      if (!res.ok) {
        const detail = data?.errors?.[0]?.detail || "Blind transfer failed";
        console.error(
          `[transfer] blind ${res.status} ccid=${call_control_id} to=${to} from=${from}: ${detail}`
        );
        return NextResponse.json({ error: detail }, { status: res.status });
      }
      console.log(
        `[transfer] blind ok ccid=${call_control_id} to=${to} from=${from}`
      );
      return NextResponse.json(data);
    }

    // Attended / warm transfer — two call_control_ids already held by rep.
    const endpoint = `https://api.telnyx.com/v2/calls/${call_control_id}/actions/bridge`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: transfer_to_call_control_id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.errors?.[0]?.detail || "Bridge failed";
      console.error(
        `[transfer] bridge ${res.status} original=${call_control_id} target=${transfer_to_call_control_id}: ${detail}`
      );
      return NextResponse.json({ error: detail }, { status: res.status });
    }
    console.log(
      `[transfer] bridged original=${call_control_id} target=${transfer_to_call_control_id}`
    );
    return NextResponse.json(data);
  } catch (err) {
    console.error(`[transfer] ${mode} threw:`, (err as Error).message);
    return NextResponse.json(
      { error: "Failed to execute transfer" },
      { status: 500 }
    );
  }
}

// Picks a Telnyx-owned phone number to use as the origination (`from`)
// of the new outbound leg the blind transfer will create.
//
// Priority:
//   1. The original call's recorded from_number or phone_number, IF it
//      matches an active row in phone_number_pool (i.e. it's ours).
//      Preserves the caller-ID the rep had been using on this call.
//   2. TELNYX_PHONE_NUMBER env var — always guaranteed to be a
//      Telnyx-owned number on our account.
//
// The original caller's external number (for inbound calls, `from` is
// the external party) is explicitly NOT used — Telnyx rejects it with
// "Unverified origination number D51".
async function resolveBlindTransferFrom(
  callControlId: string
): Promise<string> {
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
    console.warn(
      `[transfer] from-lookup failed, using env fallback: ${(err as Error).message}`
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
