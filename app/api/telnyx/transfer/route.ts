import { NextRequest, NextResponse } from "next/server";

/**
 * Attended transfer: bridge the caller's existing leg with the transfer
 * target's existing leg. The rep's WebRTC legs on both calls drop out
 * naturally as Telnyx replaces them with the bridge.
 *
 * Previously this route POSTed to `/actions/transfer` with a bogus
 * `transfer_to` body field, while the client separately hung up both legs
 * before Telnyx could act. The combination dropped every transfer.
 *
 * For unattended (blind) transfer — "send this caller to +1555..." without
 * first dialing the target — use `/actions/transfer` with a `to` phone
 * string. That path isn't wired up today; the UI only does attended.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { call_control_id, transfer_to_call_control_id } = body;

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Telnyx API not configured" },
      { status: 500 }
    );
  }
  if (!call_control_id || !transfer_to_call_control_id) {
    return NextResponse.json(
      { error: "call_control_id and transfer_to_call_control_id required" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${call_control_id}/actions/bridge`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          call_control_id: transfer_to_call_control_id,
        }),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.errors?.[0]?.detail || "Bridge failed";
      console.error(
        `[transfer] bridge ${response.status} original=${call_control_id} target=${transfer_to_call_control_id}: ${detail}`
      );
      return NextResponse.json(
        { error: detail },
        { status: response.status }
      );
    }
    console.log(
      `[transfer] bridged original=${call_control_id} target=${transfer_to_call_control_id}`
    );
    return NextResponse.json(data);
  } catch (err) {
    console.error("[transfer] bridge threw:", (err as Error).message);
    return NextResponse.json(
      { error: "Failed to execute transfer" },
      { status: 500 }
    );
  }
}
