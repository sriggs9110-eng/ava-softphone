import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLocalNumber } from "@/app/lib/local-presence";

// Outbound dial — server-originated to give us TWO addressable Call
// Control legs (customer + rep) instead of the single leg the SDK gives
// us when it INVITEs Telnyx directly.
//
// Why: Telnyx's /actions/transfer always keeps the call_control_id's
// owner connected to the new destination. For SDK-originated outbound
// calls the rep is the owner, so transfer drops the customer instead
// of the rep — exactly the wrong direction. By originating server-side
// we get a separate ccid for the customer's PSTN leg, and transfer on
// THAT leg correctly drops the rep. Mirrors the inbound fan-out
// pattern (fanOutToAgents in webhook/route.ts) which is field-tested.
//
// Flow:
//   1. POST /v2/calls to=customer_number, from=business_number
//      → Leg A (customerCcid) = the customer's PSTN leg
//   2. POST /v2/calls to=sip:rep_sip_username, link_to=customerCcid,
//      bridge_on_answer=true, custom_headers=[{X-Pepper-Auto-Answer: 1}]
//      → Leg B (repCcid) = the rep's WebRTC leg
//   3. Rep's SDK auto-answers Leg B by reading the custom header
//      (call.options.customHeaders, set by Telnyx from custom_headers
//      on the originate). Verified via @telnyx/webrtc SDK source —
//      `d.dialogParams.custom_headers → l.customHeaders`. The prior
//      attempt (commit 638e517) used `client_state` instead and
//      Stephen's diagnostic showed `clientStateRaw: '(none)'` — the
//      verto invite for credential-targeted calls didn't propagate
//      client_state. custom_headers is the working channel.
//   4. Telnyx auto-bridges Leg A + Leg B on answer.
//
// Body: { to: string, from?: string }
// Returns: { success, customerCcid, repCcid }
//
// Logged with [dial-outbound/*] prefixes per task spec.

const TELNYX_API = "https://api.telnyx.com/v2";

// Marker header read by the SDK auto-answer handler in
// useTelnyxClient.ts to distinguish the rep-side leg of a
// server-originated outbound from a real inbound INVITE.
const AUTO_ANSWER_HEADER_NAME = "X-Pepper-Auto-Answer";
const AUTO_ANSWER_HEADER_VALUE = "1";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { to, from } = body as { to?: string; from?: string };

  const apiKey = process.env.TELNYX_API_KEY;
  const callControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;
  if (!apiKey || !callControlAppId) {
    return NextResponse.json(
      {
        error:
          "Telnyx API not configured (TELNYX_API_KEY or TELNYX_CALL_CONTROL_APP_ID missing)",
      },
      { status: 500 }
    );
  }
  if (!to) {
    return NextResponse.json({ error: "to is required" }, { status: 400 });
  }

  const normalizedTo = to.startsWith("+") ? to : `+${to}`;

  // Look up the calling rep's sip_username from their auth session.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: agentRow } = await admin
    .from("softphone_users")
    .select("id, sip_username")
    .eq("id", user.id)
    .maybeSingle();

  const sipUsername = agentRow?.sip_username as string | null;
  if (!sipUsername) {
    return NextResponse.json(
      {
        error:
          "rep has no sip_username provisioned — run scripts/provision-sip-credentials.ts",
      },
      { status: 500 }
    );
  }

  // Caller-ID: explicit `from` from client (local-presence override) or
  // pick a number from the pool by destination area code.
  const fromNumber = from || (await getLocalNumber(normalizedTo));
  if (!fromNumber) {
    return NextResponse.json(
      { error: "no caller-ID number available" },
      { status: 500 }
    );
  }

  const startedAt = Date.now();

  // Step 1: originate Leg A to the customer.
  console.log(
    `[dial-outbound/legA-create] customer_to=${normalizedTo} from=${fromNumber} user_id=${user.id}`
  );
  const legAResp = await fetch(`${TELNYX_API}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connection_id: callControlAppId,
      to: normalizedTo,
      from: fromNumber,
      record: "record-from-answer",
    }),
  });
  const legA = await legAResp.json().catch(() => ({}));
  if (!legAResp.ok) {
    const detail =
      legA?.errors?.[0]?.detail ||
      legA?.errors?.[0]?.title ||
      "Customer dial failed";
    console.error(
      `[dial-outbound/error] leg=A status=${legAResp.status} detail=${detail} body=${JSON.stringify(legA).slice(0, 600)}`
    );
    return NextResponse.json({ error: detail }, { status: legAResp.status });
  }
  const customerCcid = legA?.data?.call_control_id as string | undefined;
  const customerSession = legA?.data?.call_session_id as string | undefined;
  if (!customerCcid) {
    console.error(
      `[dial-outbound/error] leg=A no_ccid_in_response body=${JSON.stringify(legA).slice(0, 600)}`
    );
    return NextResponse.json(
      { error: "Telnyx returned no ccid for customer leg" },
      { status: 500 }
    );
  }
  console.log(
    `[dial-outbound/legA-create] ok customer_ccid=${customerCcid} customer_session=${customerSession}`
  );

  // Step 2: originate Leg B to the rep's SIP credential, linked to
  // Leg A. Telnyx auto-bridges when Leg B answers.
  //
  // Auto-answer marker: custom_headers=[{X-Pepper-Auto-Answer: 1}].
  // Verified via @telnyx/webrtc SDK source (bundle.js):
  //   d.dialogParams.custom_headers → l.customHeaders
  // The Call object's options.customHeaders surfaces these on the
  // SDK side. Replaces the prior client_state mechanism (commit
  // 638e517), which Stephen's diagnostic showed wasn't propagated
  // through the credential-INVITE hop (`clientStateRaw: '(none)'`).
  const sipUri = `sip:${sipUsername}@sip.telnyx.com`;
  console.log(
    `[dial-outbound/legB-create] rep_to_sip=${sipUri} link_to=${customerCcid} from=${fromNumber}`
  );
  const legBResp = await fetch(`${TELNYX_API}/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connection_id: callControlAppId,
      to: sipUri,
      from: fromNumber,
      link_to: customerCcid,
      bridge_on_answer: true,
      bridge_intent: true,
      timeout_secs: 30,
      custom_headers: [
        { name: AUTO_ANSWER_HEADER_NAME, value: AUTO_ANSWER_HEADER_VALUE },
      ],
    }),
  });
  const legB = await legBResp.json().catch(() => ({}));
  if (!legBResp.ok) {
    const detail =
      legB?.errors?.[0]?.detail ||
      legB?.errors?.[0]?.title ||
      "Rep dial failed";
    console.error(
      `[dial-outbound/error] leg=B status=${legBResp.status} detail=${detail} body=${JSON.stringify(legB).slice(0, 600)}`
    );
    // Hangup the customer leg we just originated so we don't leave a
    // ringing zombie.
    fetch(`${TELNYX_API}/calls/${customerCcid}/actions/hangup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => {});
    return NextResponse.json({ error: detail }, { status: legBResp.status });
  }
  const repCcid = legB?.data?.call_control_id as string | undefined;
  const repSession = legB?.data?.call_session_id as string | undefined;
  console.log(
    `[dial-outbound/legB-create] ok rep_ccid=${repCcid} rep_session=${repSession}`
  );

  // Stamp the call_logs row at pairing time. external_ccid points at
  // the customer's leg — exactly what /actions/transfer needs to drop
  // the rep and redirect the customer to a new destination.
  let rowId: string | null = null;
  if (repCcid) {
    const { data: logRow, error: logErr } = await admin
      .from("call_logs")
      .insert({
        user_id: user.id,
        direction: "outbound",
        phone_number: normalizedTo,
        from_number: fromNumber,
        status: "ringing",
        call_control_id: repCcid,
        external_ccid: customerCcid,
        call_session_id: repSession || customerSession || null,
      })
      .select("id")
      .single();
    if (logErr) {
      console.error(
        `[dial-outbound/error] row-insert failed: ${logErr.message}`
      );
    } else {
      rowId = logRow?.id ?? null;
      console.log(
        `[dial-outbound/row-insert] ok row=${rowId} rep_ccid=${repCcid} external_ccid=${customerCcid} session=${repSession ?? customerSession ?? "?"}`
      );
    }
  }

  console.log(
    `[dial-outbound/summary] customer_ccid=${customerCcid} rep_ccid=${repCcid ?? "?"} legA_status=${legAResp.status} legB_status=${legBResp.status} duration_ms=${Date.now() - startedAt} row_id=${rowId ?? "(none)"}`
  );

  return NextResponse.json({
    success: true,
    customerCcid,
    repCcid,
  });
}
