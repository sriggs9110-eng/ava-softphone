import { NextRequest, NextResponse } from "next/server";

/**
 * Two transfer modes, chosen by request body shape.
 *
 *   Blind transfer (default UI path): { call_control_id, to }
 *     POST /v2/calls/{call_control_id}/actions/transfer { to }
 *     Telnyx creates a new outbound leg to `to`, bridges it to the
 *     far side of `call_control_id`, and releases the rep's WebRTC
 *     leg. No second WebRTC call needed client-side.
 *
 *   Attended/bridge transfer (warm): { call_control_id, transfer_to_call_control_id }
 *     POST /v2/calls/{call_control_id}/actions/bridge { call_control_id }
 *     For when the rep first dialed the target themselves, talked, then
 *     committed. Used by the "Conference (Merge All)" path and by the
 *     legacy warm-transfer "Complete Transfer" button.
 *
 * Both paths end with Telnyx dropping the rep's WebRTC leg via a normal
 * `callUpdate → hangup` event; do NOT hang up client-side first.
 *
 * Previously this route always used `/actions/bridge` with the rep's two
 * WebRTC-leg IDs. That was the right shape for warm transfer when the
 * rep genuinely wants to attend, but in practice Stephen's users treat
 * the UI as blind (dial target → answer → immediately hit Complete).
 * Blind transfer through `/actions/transfer` is the less racy primitive
 * for that pattern because Telnyx handles the new leg and bridge
 * internally instead of juggling four IDs over the network.
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
      const endpoint = `https://api.telnyx.com/v2/calls/${call_control_id}/actions/transfer`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = data?.errors?.[0]?.detail || "Blind transfer failed";
        console.error(
          `[transfer] blind ${res.status} ccid=${call_control_id} to=${to}: ${detail}`
        );
        return NextResponse.json({ error: detail }, { status: res.status });
      }
      console.log(`[transfer] blind ccid=${call_control_id} to=${to}`);
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
