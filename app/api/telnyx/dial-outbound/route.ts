import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLocalNumber } from "@/app/lib/local-presence";

// Outbound dial — rep-first, webhook-driven customer originate.
//
// History (read this before changing anything):
//
// V1 (commit 638e517) originated Leg A (customer) THEN Leg B (rep) with
// `link_to=customerCcid` + `bridge_on_answer`. Two failures stacked on
// top of each other:
//
//   1. The Telnyx WebRTC SDK does NOT extract client_state from incoming
//      INVITE messages — only from Bye (verified in @telnyx/webrtc source,
//      BaseCall.ts handleMessage, VertoMethod.Bye case). The SDK has a
//      literal `// TODO: manage caller_id_name, caller_id_number,
//      callee_id_name, callee_id_number` next to incoming-invite handling.
//      So the rep's auto-answer keyed off `call.options.clientState`
//      could never match — that field is empty on inbound INVITEs.
//   2. `link_to` propagates the linked leg's failure cause to the new
//      leg. When Leg A's PSTN hop returned USER_BUSY (real telco busy or
//      any other failure), Leg B got hung up with the SAME cause, even
//      though the rep's SDK had received and was processing the INVITE.
//      The "ringing → USER_BUSY" sequence in Stephen's diagnostic matches
//      this exactly.
//
// V2 (this file): originate ONLY the rep leg here. Auto-answer is keyed
// off a client-side `outboundDialExpectRef` that the page sets before
// calling this endpoint — no SIP metadata propagation required. Once
// Telnyx fires `call.answered` for the rep's leg, our webhook decodes
// `client_state` (which DOES propagate to webhook payloads) and
// originates the customer leg with link_to=repCcid + bridge_on_answer.
// By that point the linked leg is ACTIVE, mirroring the inbound fan-out
// pattern that's been field-tested.
//
// Body: { to: string, from?: string }
// Returns: { success, repCcid }
//
// Logged with [dial/outbound] prefix.

const TELNYX_API = "https://api.telnyx.com/v2";

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

  const fromNumber = from || (await getLocalNumber(normalizedTo));
  if (!fromNumber) {
    return NextResponse.json(
      { error: "no caller-ID number available" },
      { status: 500 }
    );
  }

  // Originate Leg B (rep) ONLY. Customer leg follows on call.answered
  // webhook — see app/api/telnyx/webhook/route.ts.
  //
  // client_state carries everything the webhook needs to dial the
  // customer: target number, caller-ID, and the user_id we'll use to
  // stamp call_logs. Telnyx propagates this base64 blob on every
  // subsequent webhook event for this ccid.
  const sipUri = `sip:${sipUsername}@sip.telnyx.com`;
  const clientState = Buffer.from(
    JSON.stringify({
      type: "outbound_dial_pending",
      customer: normalizedTo,
      from: fromNumber,
      user_id: user.id,
    })
  ).toString("base64");
  console.log(
    `[dial/outbound] originate rep sip=${sipUri} customer=${normalizedTo} from=${fromNumber}`
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
      timeout_secs: 30,
      client_state: clientState,
    }),
  });
  const legB = await legBResp.json().catch(() => ({}));
  if (!legBResp.ok) {
    const detail =
      legB?.errors?.[0]?.detail ||
      legB?.errors?.[0]?.title ||
      "Rep dial failed";
    console.error(
      `[dial/outbound] rep originate FAILED ${legBResp.status}: ${detail}`
    );
    return NextResponse.json({ error: detail }, { status: legBResp.status });
  }
  const repCcid = legB?.data?.call_control_id as string | undefined;
  const repSession = legB?.data?.call_session_id as string | undefined;
  if (!repCcid) {
    console.error(
      `[dial/outbound] rep originate response missing ccid: ${JSON.stringify(legB).slice(0, 400)}`
    );
    return NextResponse.json(
      { error: "Telnyx returned no ccid for rep leg" },
      { status: 500 }
    );
  }
  console.log(
    `[dial/outbound] rep originate ok repCcid=${repCcid} session=${repSession}`
  );

  // Pre-stamp call_logs with the rep ccid. external_ccid is filled in
  // when the webhook originates the customer leg and stamps it back.
  const { data: logRow, error: logErr } = await admin
    .from("call_logs")
    .insert({
      user_id: user.id,
      direction: "outbound",
      phone_number: normalizedTo,
      from_number: fromNumber,
      status: "ringing",
      call_control_id: repCcid,
      call_session_id: repSession || null,
    })
    .select("id")
    .single();
  if (logErr) {
    console.error(`[dial/outbound] call_logs insert failed:`, logErr.message);
  } else {
    console.log(
      `[dial/outbound] call_logs row=${logRow?.id} repCcid=${repCcid} session=${repSession ?? "?"}`
    );
  }

  return NextResponse.json({
    success: true,
    repCcid,
    fromNumber,
  });
}
