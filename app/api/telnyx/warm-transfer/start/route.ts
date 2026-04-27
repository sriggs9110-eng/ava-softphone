import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Warm transfer — Start (server-originated consult).
//
// Why a new endpoint instead of SDK.newCall: the SDK's outbound dial
// goes through the rep's CREDENTIAL connection, while the original
// call's customer leg lives in the CALL CONTROL APP world. Bridging or
// transferring across those two worlds has been failing in every
// pattern we've tried (silent media failures, "no longer active"
// errors, dropping the third party). The fix is to put ALL FOUR legs
// in the same Call Control App world so /actions/bridge between them
// is well-defined.
//
// This mirrors the dial-outbound architecture (commit 0e79c81):
//   1. POST here → originate rep_consult leg (sip:<rep>@sip.telnyx.com)
//      with client_state.type = "outbound_consult_pending".
//   2. SDK auto-answers via outboundDialExpectRef (kind="consult"),
//      routing the call to transferCallRef instead of callRef.
//   3. webhook on rep_consult.call.answered → originate
//      target_consult leg with client_state.type =
//      "outbound_consult_target", carrying parent_rep_consult_ccid.
//   4. webhook on target_consult.call.answered → /actions/bridge
//      rep_consult ↔ target_consult.
//
// At the end the rep is in two simultaneous bridges:
//   - repCcid       ↔ customerCcid       (original, customer on hold)
//   - repConsultCcid ↔ targetConsultCcid (consult)
//
// All four ccids are stamped in call_logs:
//   row(repCcid).external_ccid        = customerCcid
//   row(repConsultCcid).external_ccid = targetConsultCcid
//
// Complete then becomes a single /actions/bridge customerCcid ↔
// targetConsultCcid; both rep legs go away naturally.
//
// Body: { target: string, repCcid: string }
// Returns: { success, repConsultCcid, fromNumber }

const TELNYX_API = "https://api.telnyx.com/v2";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { target, repCcid } = body as {
    target?: string;
    repCcid?: string;
  };

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
  if (!target) {
    return NextResponse.json({ error: "target is required" }, { status: 400 });
  }
  if (!repCcid) {
    return NextResponse.json({ error: "repCcid is required" }, { status: 400 });
  }

  const normalizedTarget = target.startsWith("+") ? target : `+${target}`;

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

  // Reuse the original call's from_number so the consult target sees the
  // same caller-ID as if the rep had called from the original number.
  const { data: originalRow } = await admin
    .from("call_logs")
    .select("from_number")
    .eq("call_control_id", repCcid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const envFrom = process.env.TELNYX_PHONE_NUMBER || "";
  const stored = (originalRow?.from_number as string | null) || null;
  const fromNumber =
    stored && /^\+?\d{7,15}$/.test(stored)
      ? stored.startsWith("+")
        ? stored
        : `+${stored}`
      : envFrom.startsWith("+")
        ? envFrom
        : `+${envFrom}`;

  if (!/^\+?\d{7,15}$/.test(fromNumber)) {
    return NextResponse.json(
      { error: "no valid caller-ID number available" },
      { status: 500 }
    );
  }

  const sipUri = `sip:${sipUsername}@sip.telnyx.com`;
  const clientState = Buffer.from(
    JSON.stringify({
      type: "outbound_consult_pending",
      target: normalizedTarget,
      from: fromNumber,
      user_id: user.id,
      parent_rep_ccid: repCcid,
    })
  ).toString("base64");

  console.log(
    `[warm/start] originate rep_consult sip=${sipUri} target=${normalizedTarget} from=${fromNumber} parent=${repCcid}`
  );
  const res = await fetch(`${TELNYX_API}/calls`, {
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.title ||
      "rep_consult originate failed";
    console.error(
      `[warm/start] rep_consult originate FAILED ${res.status}: ${detail}`
    );
    return NextResponse.json({ error: detail }, { status: res.status });
  }
  const repConsultCcid = data?.data?.call_control_id as string | undefined;
  const repConsultSession = data?.data?.call_session_id as string | undefined;
  if (!repConsultCcid) {
    return NextResponse.json(
      { error: "Telnyx returned no ccid for rep_consult leg" },
      { status: 500 }
    );
  }
  console.log(
    `[warm/start] rep_consult originate ok repConsultCcid=${repConsultCcid} session=${repConsultSession}`
  );

  // Pre-stamp call_logs row for the consult so transfer/complete can
  // look up external_ccid (the target_consult ccid the webhook will
  // stamp once that leg is originated).
  const { data: logRow, error: logErr } = await admin
    .from("call_logs")
    .insert({
      user_id: user.id,
      direction: "outbound",
      phone_number: normalizedTarget,
      from_number: fromNumber,
      status: "ringing",
      call_control_id: repConsultCcid,
      call_session_id: repConsultSession || null,
    })
    .select("id")
    .single();
  if (logErr) {
    console.error(`[warm/start] call_logs insert failed:`, logErr.message);
  } else {
    console.log(
      `[warm/start] call_logs row=${logRow?.id} repConsultCcid=${repConsultCcid}`
    );
  }

  return NextResponse.json({
    success: true,
    repConsultCcid,
    fromNumber,
  });
}
