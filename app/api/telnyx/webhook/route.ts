import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Ring every listed agent's browser by dialing sip:<sip_username>@sip.telnyx.com
// with link_to pointing at the inbound call and bridge_on_answer=true.
// First agent to pick up gets bridged to the caller; losers are dropped by
// Telnyx when the bridge wins the race.
//
// Why this is required: numbers moved to the Call Control App no longer
// get Telnyx's native SIP-trunk INVITE fan-out. Without this orchestration
// the inbound call reaches our webhook but never causes a browser SIP
// INVITE, so agents never ring.
async function fanOutToAgents({
  callControlId,
  from,
  to,
  members,
  context,
}: {
  callControlId: string | undefined;
  from: string;
  to: string;
  members: Array<{ user_id: string; sip_username: string | null }>;
  context: string; // e.g. "group=sales" or "fallback=all-available"
}): Promise<void> {
  if (!callControlId) {
    console.log(`[routing] ${context} — no call_control_id, skipping fan-out`);
    return;
  }
  const apiKey = process.env.TELNYX_API_KEY;
  const callControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;
  if (!apiKey || !callControlAppId) {
    console.log(
      `[routing] ${context} — missing TELNYX_API_KEY or TELNYX_CALL_CONTROL_APP_ID`
    );
    return;
  }

  const ringable = members.filter((m) => m.sip_username);
  if (ringable.length === 0) {
    console.log(
      `[routing] ${context} — no members with sip_username, skipping fan-out`
    );
    return;
  }

  // `from` on the outbound SIP leg is the inbound leg's `to` — the number
  // the caller dialed. That way the caller-ID shown to the agent is our
  // own number (Telnyx requires the `from` to be account-verified). The
  // original caller's number is carried in client_state so the UI can
  // surface it on the browser.
  const fromNumber = to.startsWith("+") ? to : `+${to}`;
  const clientState = Buffer.from(
    JSON.stringify({ inbound_ccid: callControlId, caller: from, called: to })
  ).toString("base64");

  const dials = ringable.map(async (m) => {
    const sipUri = `sip:${m.sip_username}@sip.telnyx.com`;
    const bodySent: Record<string, unknown> = {
      to: sipUri,
      from: fromNumber,
      connection_id: callControlAppId,
      link_to: callControlId,
      bridge_on_answer: true,
      bridge_intent: true,
      timeout_secs: 25,
      client_state: clientState,
    };
    try {
      const res = await fetch("https://api.telnyx.com/v2/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(bodySent),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail =
          data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "unknown";
        console.error(
          `[routing] ${context} fan-out to ${sipUri} FAILED ${res.status}: ${detail}`
        );
        return;
      }
      const newCcid = data?.data?.call_control_id as string | undefined;
      const newSessionId = data?.data?.call_session_id as string | undefined;
      console.log(
        `[routing] ${context} dialed agent user=${m.user_id} sip=${sipUri} newCcid=${newCcid ?? "(unknown)"}`
      );

      // Pairing-time stamp: at this moment we KNOW the relationship — the
      // new outbound leg's ccid pairs with callControlId (the inbound PSTN
      // leg). Record it immediately so transfers don't depend on the
      // call.bridged webhook firing & the session-correlation heuristic.
      // See commit history: external_ccid was NULL on every call because
      // the post-hoc stamp is fragile. This is the deterministic source.
      if (newCcid) {
        try {
          const admin = getAdmin();
          await admin.from("call_logs").insert({
            direction: "inbound",
            phone_number: from,
            from_number: to,
            status: "ringing",
            call_control_id: newCcid,
            external_ccid: callControlId,
            call_session_id: newSessionId || null,
            user_id: m.user_id,
          });
          console.log(
            `[bridge/pair] inbound stamped external_ccid=${callControlId} on newCcid=${newCcid} agent=${m.user_id} session=${newSessionId ?? "?"}`
          );
        } catch (err) {
          console.error(
            `[bridge/pair] inbound insert failed ccid=${newCcid}:`,
            (err as Error).message
          );
        }
      }
    } catch (err) {
      console.error(
        `[routing] ${context} fan-out to ${sipUri} threw:`,
        (err as Error).message
      );
    }
  });

  await Promise.all(dials);
}

// Phase 2 of the rep-first outbound architecture (see
// app/api/telnyx/dial-outbound/route.ts for context).
//
// PREVIOUS APPROACH (link_to + bridge_on_answer) — TURNED OUT BROKEN:
// originating the customer leg with `link_to=repCcid + bridge_on_answer`
// auto-bridges them on customer answer, BUT the originated child leg
// becomes non-addressable for /actions/transfer once the bridge
// completes. Stephen confirmed: "This call is no longer active and
// can't receive commands" on blind, and warm dropped the consult party
// because the same /actions/transfer-on-customer-leg call returned the
// same error after the consult hangup.
//
// Inbound transfer works because there `external_ccid` points at the
// PARENT (the inbound PSTN leg, used as link_to target). For the new
// outbound architecture `external_ccid` was pointing at the CHILD (the
// originated customer leg), and Telnyx doesn't accept commands on a
// child leg whose link_to + bridge_on_answer has already completed.
//
// CURRENT APPROACH: originate the customer leg as a STANDALONE leg (no
// link_to, no bridge_on_answer). Carry parent_rep_ccid in client_state
// so the customer's call.answered webhook can issue an explicit
// /actions/bridge to join the two. Both legs stay independently
// addressable, so /actions/transfer on the customer leg works the same
// way it does for inbound.
async function maybeDialOutboundCustomerLeg(args: {
  repCcid: string;
  clientStateB64: string | undefined;
}): Promise<boolean> {
  const { repCcid, clientStateB64 } = args;
  if (!clientStateB64) return false;

  let decoded: {
    type?: string;
    customer?: string;
    from?: string;
    user_id?: string;
  } | null = null;
  try {
    decoded = JSON.parse(Buffer.from(clientStateB64, "base64").toString("utf8"));
  } catch {
    return false;
  }
  if (!decoded || decoded.type !== "outbound_dial_pending") return false;
  if (!decoded.customer || !decoded.from) {
    console.warn(
      `[dial/outbound] customer-leg trigger missing fields on repCcid=${repCcid}`
    );
    return false;
  }

  // Idempotency guard: webhook may double-fire on retries / call.bridged
  // post-answered. external_ccid stamped means we already kicked off the
  // customer originate — bail.
  const adminGuard = getAdmin();
  const { data: existing } = await adminGuard
    .from("call_logs")
    .select("external_ccid")
    .eq("call_control_id", repCcid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.external_ccid) {
    console.log(
      `[dial/outbound] idempotent skip — external_ccid=${existing.external_ccid} already on repCcid=${repCcid}`
    );
    return false;
  }

  const apiKey = process.env.TELNYX_API_KEY;
  const callControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;
  if (!apiKey || !callControlAppId) {
    console.error(
      `[dial/outbound] missing TELNYX_API_KEY or TELNYX_CALL_CONTROL_APP_ID — cannot originate customer leg`
    );
    return false;
  }

  // Customer leg's client_state carries parent_rep_ccid so the customer-
  // side call.answered webhook can issue /actions/bridge.
  const customerClientState = Buffer.from(
    JSON.stringify({
      type: "outbound_dial_customer",
      parent_rep_ccid: repCcid,
      customer: decoded.customer,
      from: decoded.from,
      user_id: decoded.user_id,
    })
  ).toString("base64");

  console.log(
    `[dial/outbound] rep answered repCcid=${repCcid} — originating customer=${decoded.customer} from=${decoded.from}`
  );
  const res = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connection_id: callControlAppId,
      to: decoded.customer,
      from: decoded.from,
      timeout_secs: 30,
      client_state: customerClientState,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "unknown";
    console.error(
      `[dial/outbound] customer-leg originate FAILED ${res.status} repCcid=${repCcid}: ${detail}`
    );
    // Hangup the rep leg too — without a customer there's nothing to bridge.
    await fetch(
      `https://api.telnyx.com/v2/calls/${repCcid}/actions/hangup`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    ).catch(() => {});
    return false;
  }
  const customerCcid = data?.data?.call_control_id as string | undefined;
  const customerSession = data?.data?.call_session_id as string | undefined;
  console.log(
    `[dial/outbound] customer-leg ok customerCcid=${customerCcid} session=${customerSession ?? "?"}`
  );

  // Stamp external_ccid on the rep's pre-existing call_logs row so
  // transfer can target the customer leg deterministically. Stamp at
  // originate-time (not bridge-time) so the row is ready before the
  // rep can possibly click transfer.
  if (customerCcid) {
    try {
      const admin = getAdmin();
      await admin
        .from("call_logs")
        .update({ external_ccid: customerCcid })
        .eq("call_control_id", repCcid)
        .is("external_ccid", null);
      console.log(
        `[bridge/pair] outbound stamped external_ccid=${customerCcid} on repCcid=${repCcid}`
      );
    } catch (err) {
      console.error(
        `[dial/outbound] external_ccid stamp threw repCcid=${repCcid}:`,
        (err as Error).message
      );
    }
  }
  return true;
}

// Phase 3 of the rep-first outbound architecture: customer leg has
// answered. Issue /actions/bridge to join customer leg to rep leg. We
// can't use link_to + bridge_on_answer because it leaves the child leg
// non-addressable for /actions/transfer (see above).
async function maybeBridgeOutboundLegs(args: {
  customerCcid: string;
  clientStateB64: string | undefined;
}): Promise<boolean> {
  const { customerCcid, clientStateB64 } = args;
  if (!clientStateB64) return false;

  let decoded: {
    type?: string;
    parent_rep_ccid?: string;
  } | null = null;
  try {
    decoded = JSON.parse(Buffer.from(clientStateB64, "base64").toString("utf8"));
  } catch {
    return false;
  }
  if (!decoded || decoded.type !== "outbound_dial_customer") return false;
  if (!decoded.parent_rep_ccid) {
    console.warn(
      `[dial/outbound] bridge trigger missing parent_rep_ccid on customerCcid=${customerCcid}`
    );
    return false;
  }

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    console.error(
      `[dial/outbound] missing TELNYX_API_KEY — cannot bridge legs`
    );
    return false;
  }

  console.log(
    `[dial/outbound] customer answered customerCcid=${customerCcid} — bridging to repCcid=${decoded.parent_rep_ccid}`
  );
  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${decoded.parent_rep_ccid}/actions/bridge`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: customerCcid }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "unknown";
    console.error(
      `[dial/outbound] bridge FAILED ${res.status} repCcid=${decoded.parent_rep_ccid} customerCcid=${customerCcid}: ${detail}`
    );
    // Bridge failed but both legs are alive — hang up both rather than
    // leaving an awkward "rep talking to a real customer with no audio
    // path" state.
    await fetch(
      `https://api.telnyx.com/v2/calls/${decoded.parent_rep_ccid}/actions/hangup`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } }
    ).catch(() => {});
    await fetch(
      `https://api.telnyx.com/v2/calls/${customerCcid}/actions/hangup`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } }
    ).catch(() => {});
    return false;
  }
  console.log(
    `[dial/outbound] bridge ok repCcid=${decoded.parent_rep_ccid} customerCcid=${customerCcid}`
  );
  return true;
}

// Warm transfer phase 2: rep_consult leg has answered (rep auto-
// answered the server-originated consult INVITE). Originate the
// consult target's PSTN leg, with client_state carrying the parent
// repConsultCcid so phase 3 can find its way home.
//
// Mirrors maybeDialOutboundCustomerLeg but in the consult world.
async function maybeDialConsultTargetLeg(args: {
  repConsultCcid: string;
  clientStateB64: string | undefined;
}): Promise<boolean> {
  const { repConsultCcid, clientStateB64 } = args;
  if (!clientStateB64) return false;

  let decoded: {
    type?: string;
    target?: string;
    from?: string;
    user_id?: string;
    parent_rep_ccid?: string;
  } | null = null;
  try {
    decoded = JSON.parse(Buffer.from(clientStateB64, "base64").toString("utf8"));
  } catch {
    return false;
  }
  if (!decoded || decoded.type !== "outbound_consult_pending") return false;
  if (!decoded.target || !decoded.from) {
    console.warn(
      `[warm/consult] target-leg trigger missing fields on repConsultCcid=${repConsultCcid}`
    );
    return false;
  }

  // Idempotency: external_ccid stamped means we already dispatched.
  const adminGuard = getAdmin();
  const { data: existing } = await adminGuard
    .from("call_logs")
    .select("external_ccid")
    .eq("call_control_id", repConsultCcid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.external_ccid) {
    console.log(
      `[warm/consult] idempotent skip — external_ccid=${existing.external_ccid} already on repConsultCcid=${repConsultCcid}`
    );
    return false;
  }

  const apiKey = process.env.TELNYX_API_KEY;
  const callControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;
  if (!apiKey || !callControlAppId) {
    console.error(
      `[warm/consult] missing TELNYX_API_KEY or TELNYX_CALL_CONTROL_APP_ID — cannot originate target leg`
    );
    return false;
  }

  const targetClientState = Buffer.from(
    JSON.stringify({
      type: "outbound_consult_target",
      parent_rep_consult_ccid: repConsultCcid,
      target: decoded.target,
      from: decoded.from,
      user_id: decoded.user_id,
    })
  ).toString("base64");

  console.log(
    `[warm/consult] rep_consult answered repConsultCcid=${repConsultCcid} — originating target=${decoded.target} from=${decoded.from}`
  );
  const res = await fetch("https://api.telnyx.com/v2/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      connection_id: callControlAppId,
      to: decoded.target,
      from: decoded.from,
      timeout_secs: 30,
      client_state: targetClientState,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "unknown";
    console.error(
      `[warm/consult] target-leg originate FAILED ${res.status} repConsultCcid=${repConsultCcid}: ${detail}`
    );
    // Don't hang up the rep_consult leg here — let the rep see the
    // failure and decide whether to retry or cancel via the UI.
    return false;
  }
  const targetConsultCcid = data?.data?.call_control_id as string | undefined;
  console.log(
    `[warm/consult] target-leg ok targetConsultCcid=${targetConsultCcid}`
  );

  if (targetConsultCcid) {
    try {
      const admin = getAdmin();
      await admin
        .from("call_logs")
        .update({ external_ccid: targetConsultCcid })
        .eq("call_control_id", repConsultCcid)
        .is("external_ccid", null);
      console.log(
        `[warm/consult] stamped external_ccid=${targetConsultCcid} on repConsultCcid=${repConsultCcid}`
      );
    } catch (err) {
      console.error(
        `[warm/consult] external_ccid stamp threw repConsultCcid=${repConsultCcid}:`,
        (err as Error).message
      );
    }
  }
  return true;
}

// Warm transfer phase 3: target_consult leg has answered. Bridge it to
// rep_consult so the rep is talking to the consult target. Mirrors
// maybeBridgeOutboundLegs but in the consult world.
async function maybeBridgeConsultLegs(args: {
  targetConsultCcid: string;
  clientStateB64: string | undefined;
}): Promise<boolean> {
  const { targetConsultCcid, clientStateB64 } = args;
  if (!clientStateB64) return false;

  let decoded: {
    type?: string;
    parent_rep_consult_ccid?: string;
  } | null = null;
  try {
    decoded = JSON.parse(Buffer.from(clientStateB64, "base64").toString("utf8"));
  } catch {
    return false;
  }
  if (!decoded || decoded.type !== "outbound_consult_target") return false;
  if (!decoded.parent_rep_consult_ccid) {
    console.warn(
      `[warm/consult] bridge trigger missing parent on targetConsultCcid=${targetConsultCcid}`
    );
    return false;
  }

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    console.error(`[warm/consult] missing TELNYX_API_KEY — cannot bridge`);
    return false;
  }

  console.log(
    `[warm/consult] target answered targetConsultCcid=${targetConsultCcid} — bridging to repConsultCcid=${decoded.parent_rep_consult_ccid}`
  );
  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${decoded.parent_rep_consult_ccid}/actions/bridge`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: targetConsultCcid }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "unknown";
    console.error(
      `[warm/consult] bridge FAILED ${res.status} repConsultCcid=${decoded.parent_rep_consult_ccid} targetConsultCcid=${targetConsultCcid}: ${detail}`
    );
    // Hangup both legs to avoid orphan state.
    await fetch(
      `https://api.telnyx.com/v2/calls/${decoded.parent_rep_consult_ccid}/actions/hangup`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } }
    ).catch(() => {});
    await fetch(
      `https://api.telnyx.com/v2/calls/${targetConsultCcid}/actions/hangup`,
      { method: "POST", headers: { Authorization: `Bearer ${apiKey}` } }
    ).catch(() => {});
    return false;
  }
  console.log(
    `[warm/consult] bridge ok repConsultCcid=${decoded.parent_rep_consult_ccid} targetConsultCcid=${targetConsultCcid}`
  );
  return true;
}

// Dispatch ring-group fan-out: look up the group for the dialed number,
// find available members, broadcast via Supabase Realtime, ring their
// browsers via Call Control, and schedule a timeout hangup if nobody
// answers. Returns true if a group matched (so caller can skip fallback).
async function dispatchRingGroup({
  callControlId,
  from,
  to,
}: {
  callControlId: string | undefined;
  from: string;
  to: string;
}): Promise<boolean> {
  if (!to) return false;

  const admin = getAdmin();

  // Try both forms of the number — DB may store with or without + prefix.
  const candidates = new Set<string>();
  candidates.add(to);
  if (to.startsWith("+")) candidates.add(to.slice(1));
  else candidates.add(`+${to}`);

  const { data: group } = await admin
    .from("ring_groups")
    .select(
      "id, name, inbound_number, strategy, ring_timeout_seconds, fallback_action, voicemail_greeting_url"
    )
    .in("inbound_number", Array.from(candidates))
    .limit(1)
    .maybeSingle();

  if (!group) return false;

  const { data: members } = await admin
    .from("ring_group_members")
    .select(
      "user_id, priority, softphone_users!inner(id, status, full_name, sip_username)"
    )
    .eq("group_id", group.id);

  type MemberRow = {
    user_id: string;
    priority: number;
    softphone_users: {
      id: string;
      status: string;
      full_name: string;
      sip_username: string | null;
    };
  };

  const rows = (members || []) as unknown as MemberRow[];
  const available = rows
    .filter((m) => m.softphone_users?.status === "available")
    .sort((a, b) => a.priority - b.priority);

  if (available.length === 0) {
    console.log(`[routing] group=${group.name} — no available members`);
    // A configured group with no one available is still a "match" — we
    // want to skip the all-users fallback in that case, caller expects
    // the group's own fallback_action (voicemail / hangup) to run.
    return true;
  }

  // For simultaneous, notify everyone at once. For round_robin, still notify
  // all but the client sorts by priority. Proper round-robin rotation is
  // a future iteration — flag in ops doc.
  const recipients = available.map((m) => ({
    user_id: m.user_id,
    name: m.softphone_users.full_name,
    sip_username: m.softphone_users.sip_username,
  }));
  const memberIds = recipients.map((r) => r.user_id);

  const payload = {
    call_control_id: callControlId,
    from,
    to,
    group_id: group.id,
    group_name: group.name,
    strategy: group.strategy,
    member_user_ids: memberIds,
    fallback_action: group.fallback_action,
    ring_timeout_seconds: group.ring_timeout_seconds,
    sent_at: new Date().toISOString(),
  };

  for (const r of recipients) {
    try {
      const ch = admin.channel(`user:${r.user_id}`, {
        config: { broadcast: { ack: false, self: false } },
      });
      await ch.subscribe();
      await ch.send({
        type: "broadcast",
        event: "incoming_group_call",
        payload,
      });
      await admin.removeChannel(ch);
    } catch (err) {
      console.error(`[routing] group=${group.name} broadcast to ${r.user_id} failed:`, err);
    }
  }
  console.log(
    `[routing] group=${group.name} notified ${recipients.length} members`
  );

  // Actually ring the agents' browsers via Call Control fan-out.
  await fanOutToAgents({
    callControlId,
    from,
    to,
    members: recipients,
    context: `group=${group.name}`,
  });

  // Timeout enforcement. Best-effort in a serverless function — fires only
  // while the function instance is alive (Vercel limit applies). For robust
  // enforcement at scale, wire a cron to sweep ring_attempts.
  const apiKey = process.env.TELNYX_API_KEY;
  if (!callControlId || !apiKey) return true;

  after(async () => {
    await new Promise((res) =>
      setTimeout(res, (group.ring_timeout_seconds ?? 20) * 1000)
    );

    try {
      // Check if the call was answered — if so, don't hang up.
      const { data: row } = await admin
        .from("call_logs")
        .select("status")
        .eq("call_control_id", callControlId)
        .limit(1)
        .maybeSingle();

      if (row?.status === "connected" || row?.status === "completed") {
        console.log(`[Webhook/ring] ccid=${callControlId} answered — no hangup`);
        return;
      }

      console.log(
        `[Webhook/ring] ccid=${callControlId} timed out — fallback=${group.fallback_action}`
      );

      const hangupCall = async () => {
        const res = await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/hangup`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );
        console.log(`[Webhook/ring] hangup status=${res.status}`);
      };

      // Voicemail path: answer server-side, record state, then the
      // call.answered event handler (later in this file) plays the greeting.
      if (
        group.fallback_action === "voicemail" &&
        group.voicemail_greeting_url
      ) {
        await admin.from("ring_group_call_state").upsert({
          call_control_id: callControlId,
          ring_group_id: group.id,
          caller_number: from,
          called_number: to,
          state: "voicemail_answering",
          updated_at: new Date().toISOString(),
        });

        const res = await fetch(
          `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
          }
        );
        if (!res.ok) {
          const err = await res.text().catch(() => "");
          console.error(
            `[Webhook/ring] voicemail answer failed ${res.status}: ${err.slice(0, 300)}`
          );
          // Clean up state and hang up to avoid orphaned call leg.
          await admin
            .from("ring_group_call_state")
            .update({ state: "done", updated_at: new Date().toISOString() })
            .eq("call_control_id", callControlId);
          await hangupCall();
          return;
        }
        console.log(`[Webhook/ring] voicemail answer ok — awaiting call.answered`);
        return;
      }

      // Voicemail requested but no greeting recorded: safer to hang up than
      // record silence the caller isn't prompted for.
      if (
        group.fallback_action === "voicemail" &&
        !group.voicemail_greeting_url
      ) {
        console.warn(
          `[Webhook/ring] group=${group.name} has voicemail fallback but no greeting — hanging up`
        );
        await hangupCall();
        return;
      }

      // Plain hangup fallback.
      await hangupCall();
    } catch (err) {
      console.error(`[Webhook/ring] timeout handler error:`, err);
    }
  });

  return true;
}

// Fallback dispatcher for inbound calls whose `to` doesn't match any
// configured ring group. Broadcasts + rings every softphone_user who is
// currently `available` and has a per-user SIP credential, so the call
// doesn't silently die at the carrier. Stephen can still configure a
// ring group for that number later to get specific routing; this just
// keeps the base case working.
async function dispatchFallback({
  callControlId,
  from,
  to,
}: {
  callControlId: string | undefined;
  from: string;
  to: string;
}) {
  const admin = getAdmin();

  const { data: users } = await admin
    .from("softphone_users")
    .select("id, full_name, status, sip_username")
    .eq("status", "available")
    .not("sip_username", "is", null);

  const available = (users || []) as Array<{
    id: string;
    full_name: string | null;
    status: string;
    sip_username: string | null;
  }>;

  if (available.length === 0) {
    console.log(
      `[routing] fallback to=${to} from=${from} — no available users with sip_username; call will carrier-timeout`
    );
    return;
  }

  console.log(
    `[routing] fallback to=${to} from=${from} — notifying ${available.length} available user(s)`
  );

  const memberIds = available.map((u) => u.id);
  const payload = {
    call_control_id: callControlId,
    from,
    to,
    member_user_ids: memberIds,
    sent_at: new Date().toISOString(),
  };

  for (const u of available) {
    try {
      const ch = admin.channel(`user:${u.id}`, {
        config: { broadcast: { ack: false, self: false } },
      });
      await ch.subscribe();
      await ch.send({
        type: "broadcast",
        event: "incoming_call",
        payload,
      });
      await admin.removeChannel(ch);
    } catch (err) {
      console.error(
        `[routing] fallback broadcast to ${u.id} failed:`,
        err
      );
    }
  }

  await fanOutToAgents({
    callControlId,
    from,
    to,
    members: available.map((u) => ({
      user_id: u.id,
      sip_username: u.sip_username,
    })),
    context: "fallback=all-available",
  });
}

// Advance the voicemail flow: play the greeting when Telnyx confirms the
// answer, then start recording when the greeting finishes, then harvest the
// recording when it's saved.
async function handleVoicemailEvent({
  eventType,
  callControlId,
}: {
  eventType: string;
  callControlId: string | undefined;
}): Promise<boolean> {
  if (!callControlId) return false;
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) return false;

  const admin = getAdmin();
  const { data: state } = await admin
    .from("ring_group_call_state")
    .select(
      "call_control_id, ring_group_id, caller_number, called_number, state"
    )
    .eq("call_control_id", callControlId)
    .maybeSingle();
  if (!state) return false;

  if (
    eventType === "call.answered" &&
    state.state === "voicemail_answering"
  ) {
    const { data: group } = await admin
      .from("ring_groups")
      .select("voicemail_greeting_url")
      .eq("id", state.ring_group_id)
      .single();
    if (!group?.voicemail_greeting_url) {
      console.warn(
        `[Webhook/voicemail] answered but no greeting on group=${state.ring_group_id}`
      );
      return true;
    }
    const res = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/playback_start`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ audio_url: group.voicemail_greeting_url }),
      }
    );
    console.log(`[Webhook/voicemail] playback_start status=${res.status}`);
    await admin
      .from("ring_group_call_state")
      .update({
        state: "voicemail_playing_greeting",
        updated_at: new Date().toISOString(),
      })
      .eq("call_control_id", callControlId);
    return true;
  }

  if (
    (eventType === "call.playback.ended" || eventType === "call.playback_ended") &&
    state.state === "voicemail_playing_greeting"
  ) {
    const res = await fetch(
      `https://api.telnyx.com/v2/calls/${callControlId}/actions/record_start`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          format: "mp3",
          channels: "single",
          max_length: 120,
        }),
      }
    );
    console.log(`[Webhook/voicemail] record_start status=${res.status}`);
    await admin
      .from("ring_group_call_state")
      .update({
        state: "voicemail_recording",
        updated_at: new Date().toISOString(),
      })
      .eq("call_control_id", callControlId);
    return true;
  }

  return false;
}

async function harvestVoicemailRecording({
  callControlId,
  recordingUrl,
  recordingId,
  durationSeconds,
}: {
  callControlId: string | undefined;
  recordingUrl: string | null;
  recordingId: string | null;
  durationSeconds: number | null;
}): Promise<boolean> {
  if (!callControlId || !recordingUrl) return false;
  const admin = getAdmin();

  const { data: state } = await admin
    .from("ring_group_call_state")
    .select("ring_group_id, caller_number, called_number, state")
    .eq("call_control_id", callControlId)
    .maybeSingle();
  if (!state || state.state !== "voicemail_recording") return false;

  const { data: inserted, error } = await admin
    .from("voicemails")
    .insert({
      ring_group_id: state.ring_group_id,
      caller_number: state.caller_number || "",
      called_number: state.called_number || "",
      recording_url: recordingUrl,
      recording_telnyx_id: recordingId,
      duration_seconds: durationSeconds,
      transcript_status: "pending",
      status: "new",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[Webhook/voicemail] insert failed:", error.message);
    return true;
  }
  console.log(`[Webhook/voicemail] inserted voicemail ${inserted.id}`);

  await admin
    .from("ring_group_call_state")
    .update({ state: "done", updated_at: new Date().toISOString() })
    .eq("call_control_id", callControlId);

  // Kick off transcription in the background.
  after(async () => {
    try {
      const origin = process.env.NEXT_PUBLIC_APP_URL || "";
      if (!origin) {
        console.warn(
          "[Webhook/voicemail] NEXT_PUBLIC_APP_URL unset — skipping auto-transcribe"
        );
        return;
      }
      const r = await fetch(`${origin}/api/ai/transcribe-voicemail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voicemail_id: inserted.id }),
      });
      console.log(`[Webhook/voicemail] auto-transcribe status=${r.status}`);
    } catch (err) {
      console.error("[Webhook/voicemail] auto-transcribe threw:", err);
    }
  });

  return true;
}

function cleanNumber(raw: string): string {
  return raw.replace(/^sip:/, "").replace(/@.*$/, "");
}

// Match by call_control_id (stamped on the row by earlier events)
async function findByCallControlId(ccid: string) {
  const admin = getAdmin();
  const { data } = await admin
    .from("call_logs")
    .select("id")
    .eq("call_control_id", ccid)
    .limit(1);

  if (data && data.length > 0) {
    console.log(`[Webhook] Found row ${data[0].id} by ccid`);
    return data[0];
  }
  return null;
}

// Match by phone_number + time window.
//
// Skips rows whose external_ccid is already populated — those are locked
// pairing rows (set by fanOutToAgents at inbound-dial time or by the
// outbound phone+time stamp in call.answered). Overwriting their
// call_control_id on a stray phone match would break transfer lookups,
// and their status/duration are already driven by their own ccid events
// via the ccid-first paths in call.answered / call.hangup.
async function findRecentCall(
  payload: Record<string, unknown>,
  windowMinutes = 1
) {
  const admin = getAdmin();
  const cutoff = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const from = cleanNumber((payload?.from as string) || "");
  const to = cleanNumber((payload?.to as string) || "");

  const candidates = new Set<string>();
  for (const num of [from, to]) {
    if (!num) continue;
    candidates.add(num);
    if (num.startsWith("+")) candidates.add(num.slice(1));
    else candidates.add(`+${num}`);
  }

  for (const phone of candidates) {
    const { data } = await admin
      .from("call_logs")
      .select("id")
      .eq("phone_number", phone)
      .is("external_ccid", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      console.log(`[Webhook] Found row ${data[0].id} by phone=${phone}`);
      return data[0];
    }
  }

  console.log(`[Webhook] No row found for from=${from} to=${to} (window=${windowMinutes}m)`);
  return null;
}

async function updateRow(id: string, updates: Record<string, unknown>) {
  const admin = getAdmin();
  const { error } = await admin
    .from("call_logs")
    .update(updates)
    .eq("id", id);
  if (error) {
    console.error(`[Webhook] Update failed row ${id}:`, error.message);
  }
}

// Deterministically stamp external_ccid across session peers. For any row
// sharing `sessionId` whose `call_control_id` differs from `ccid` and whose
// `external_ccid` is NULL, set external_ccid = ccid.
//
// This is the replacement for the older [bridge] stamping heuristic, which
// was fragile (relied on call.bridged firing, on row count, on ordering).
// Pairing-time inserts in fanOutToAgents cover inbound fan-out; this covers
// outbound SDK calls and any other path whose legs only become visible
// post-hoc via webhook events.
async function crossStampSessionPeers(
  sessionId: string,
  ccid: string,
  eventTag: string
) {
  const admin = getAdmin();
  const { data: peers } = await admin
    .from("call_logs")
    .select("id, call_control_id, external_ccid")
    .eq("call_session_id", sessionId);
  const rows = (peers || []) as Array<{
    id: string;
    call_control_id: string | null;
    external_ccid: string | null;
  }>;
  for (const r of rows) {
    if (
      r.call_control_id &&
      r.call_control_id !== ccid &&
      !r.external_ccid
    ) {
      await admin
        .from("call_logs")
        .update({ external_ccid: ccid })
        .eq("id", r.id);
      console.log(
        `[session-stamp/${eventTag}] external_ccid=${ccid} on row=${r.id} primary=${r.call_control_id} session=${sessionId}`
      );
    }
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const eventType = body?.data?.event_type;
  const payload = body?.data?.payload || {};
  const ccid = payload?.call_control_id as string | undefined;
  const sessionId = payload?.call_session_id as string | undefined;
  const from = cleanNumber((payload?.from as string) || "");
  const to = cleanNumber((payload?.to as string) || "");

  console.log(`[Webhook] ${eventType} from=${from} to=${to} ccid=${ccid}`);

  const apiKey = process.env.TELNYX_API_KEY;

  switch (eventType) {
    case "call.initiated": {
      const direction = payload?.direction as string | undefined;

      // Skip routing for outbound legs we ourselves created. These fire
      // with direction="outgoing" on the Call Control App side. Safe
      // short-circuit — no ring-group dispatch makes sense here.
      if (direction === "outgoing" || direction === "outbound") {
        console.log(
          `[Webhook] call.initiated (our outbound leg) ccid=${ccid} to=${to} — skipping routing`
        );
      } else if (!/^\+?\d{7,15}$/.test(to)) {
        // The credential connection ALSO POSTs to this same webhook URL,
        // and when we dial sip:<sip_username>@sip.telnyx.com for a fan-
        // out, Telnyx fires an "incoming" call.initiated on the
        // registered endpoint with `to` = the SIP username (letters, not
        // phone-shaped). Running dispatch on that creates another
        // fan-out, which creates more registered-endpoint events — an
        // infinite recursion that flooded the webhook before this
        // filter. Skip anything whose `to` isn't a real phone number.
        console.log(
          `[Webhook] call.initiated (non-phone to=${to}, likely a SIP URI leg we dialed) ccid=${ccid} — skipping routing`
        );
      } else if (direction === "incoming" || direction === "inbound") {
        // Real inbound to one of our Pepper numbers. Route it:
        //   1. Try the configured ring group for the called number.
        //   2. If no group matches, fall back to ringing every available
        //      softphone_user so the caller gets SOMEONE on the line.
        // Both paths (a) broadcast a Realtime event so the UI decorates
        // with caller info, and (b) dial each agent's SIP endpoint via
        // the Call Control App so their WebRTC browser actually rings.
        const groupMatched = await dispatchRingGroup({
          callControlId: ccid,
          from,
          to,
        });
        if (!groupMatched) {
          await dispatchFallback({ callControlId: ccid, from, to });
        }
      }

      // If a row already exists for THIS exact ccid (e.g., fanOutToAgents
      // pre-inserted a pairing-time row, or a prior event already claimed
      // this ccid), just top up the session/from_number — never overwrite.
      const admin0 = getAdmin();
      const { data: alreadyStamped } = await admin0
        .from("call_logs")
        .select("id")
        .eq("call_control_id", ccid || "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (alreadyStamped) {
        const telnyxDir = payload?.direction as string | undefined;
        const telnyxIsOutgoing =
          telnyxDir === "outgoing" || telnyxDir === "outbound";
        const telnyxFrom = telnyxIsOutgoing ? from : to;
        await updateRow(alreadyStamped.id, {
          call_session_id: sessionId,
          from_number: telnyxFrom || null,
        });
        console.log(
          `[Webhook] initiated — row ${alreadyStamped.id} already stamped for ccid=${ccid}, topped up session/from`
        );
      } else {
        let row = await findRecentCall(payload);

        // Guard against overwriting the ccid on a row that's already been
        // claimed by a DIFFERENT leg. This happens for outbound SDK calls
        // where PSTN and credential legs both match by phone_number within
        // the 1-minute window — without this guard, the later event
        // overwrites the earlier leg's ccid, breaking transfer lookups.
        if (row) {
          const { data: rowFull } = await admin0
            .from("call_logs")
            .select("call_control_id")
            .eq("id", row.id)
            .maybeSingle();
          const claimedCcid = rowFull?.call_control_id as string | null | undefined;
          if (claimedCcid && ccid && claimedCcid !== ccid) {
            console.log(
              `[Webhook] initiated — row ${row.id} already claims ccid=${claimedCcid}, not overwriting with ${ccid}; will insert a peer row`
            );
            row = null;
          }
        }

        if (row) {
          const telnyxDir = payload?.direction as string | undefined;
          const telnyxIsOutgoing =
            telnyxDir === "outgoing" || telnyxDir === "outbound";
          const telnyxFrom = telnyxIsOutgoing ? from : to;
          console.log(
            `[Webhook] initiated — row ${row.id} telnyx-from=${telnyxFrom} direction=${telnyxDir}`
          );
          await updateRow(row.id, {
            call_control_id: ccid,
            call_session_id: sessionId,
            from_number: telnyxFrom || null,
          });
        } else {
          const dir = payload?.direction as string;
          const prospectNumber = dir === "outbound" ? to : from;
          const fromNumber = dir === "outbound" ? from : to;

          const { data, error } = await admin0
            .from("call_logs")
            .insert({
              direction: dir === "outbound" ? "outbound" : "inbound",
              phone_number: prospectNumber || to || from,
              from_number: fromNumber,
              status: "initiated",
              call_control_id: ccid,
              call_session_id: sessionId,
            })
            .select("id")
            .single();

          if (error) {
            console.log(`[Webhook] initiated — insert failed:`, error.message);
          } else {
            console.log(`[Webhook] initiated — created row ${data.id}`);
          }
        }
      }

      // Cross-stamp external_ccid across session peers. Deterministic
      // pairing: if two legs share a call_session_id but have distinct
      // call_control_ids, each leg's external_ccid is the other's ccid.
      // Fires on every call.initiated so the second leg's arrival
      // immediately stamps the first leg (and vice versa). Pairing-time
      // inserts in fanOutToAgents already set external_ccid on inbound
      // fan-out rows; this covers outbound SDK calls and any other path
      // that lands in the call.initiated handler.
      if (sessionId && ccid) {
        await crossStampSessionPeers(sessionId, ccid, "initiated");
      }
      break;
    }

    case "call.playback.ended":
    case "call.playback_ended": {
      // Voicemail flow: greeting finished → start recording.
      await handleVoicemailEvent({ eventType, callControlId: ccid });
      break;
    }

    case "call.answered":
    case "call.bridged": {
      // Voicemail flow hijacks call.answered: when the call we just answered
      // belongs to a ring_group_call_state row, play the greeting instead of
      // starting dual-channel call recording.
      const vmHandled = await handleVoicemailEvent({
        eventType,
        callControlId: ccid,
      });
      if (vmHandled) break;

      // Outbound-dial phase 2 (rep answered): originate customer leg.
      // Outbound-dial phase 3 (customer answered): bridge to rep leg.
      // Warm-consult phase 2 (rep_consult answered): originate target leg.
      // Warm-consult phase 3 (target_consult answered): bridge to rep_consult.
      // All four run on different ccids — gated by client_state.type so
      // only the matching one acts.
      if (eventType === "call.answered" && ccid) {
        const cs = payload?.client_state as string | undefined;
        await maybeDialOutboundCustomerLeg({ repCcid: ccid, clientStateB64: cs });
        await maybeBridgeOutboundLegs({ customerCcid: ccid, clientStateB64: cs });
        await maybeDialConsultTargetLeg({
          repConsultCcid: ccid,
          clientStateB64: cs,
        });
        await maybeBridgeConsultLegs({
          targetConsultCcid: ccid,
          clientStateB64: cs,
        });
      }

      if (apiKey && ccid) {
        try {
          const res = await fetch(
            `https://api.telnyx.com/v2/calls/${ccid}/actions/record_start`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ format: "mp3", channels: "dual" }),
            }
          );
          if (!res.ok) {
            const errText = await res.text().catch(() => "");
            console.error(
              `[Webhook] record_start FAILED ${res.status} ccid=${ccid} direction=${payload?.direction} body=${errText.slice(0, 400)}`
            );
          } else {
            console.log(
              `[Webhook] record_start ok ccid=${ccid} direction=${payload?.direction}`
            );
          }
        } catch (err) {
          console.error(
            `[Webhook] record_start threw ccid=${ccid}:`,
            (err as Error).message
          );
        }
      } else if (!apiKey) {
        console.warn("[Webhook] TELNYX_API_KEY missing — recording disabled");
      } else {
        console.warn("[Webhook] call.answered without ccid — cannot start recording");
      }

      // Prefer matching by ccid (stable, unique) before falling back to
      // phone-number heuristic — this avoids clobbering an already-claimed
      // peer row's call_control_id on call.answered/bridged.
      const adminAns = getAdmin();
      const { data: ccidRow } = await adminAns
        .from("call_logs")
        .select("id")
        .eq("call_control_id", ccid || "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ccidRow) {
        await updateRow(ccidRow.id, {
          status: "connected",
          call_session_id: sessionId,
        });
        console.log(`[Webhook] ${eventType} → connected, row ${ccidRow.id} (by ccid)`);
      } else {
        const row = await findRecentCall(payload);
        if (row) {
          const { data: rowFull } = await adminAns
            .from("call_logs")
            .select("call_control_id")
            .eq("id", row.id)
            .maybeSingle();
          const claimedCcid = rowFull?.call_control_id as string | null | undefined;
          if (claimedCcid && ccid && claimedCcid !== ccid) {
            // Peer row — don't overwrite ccid. Just bump status.
            await updateRow(row.id, {
              status: "connected",
              call_session_id: sessionId,
            });
            console.log(
              `[Webhook] ${eventType} → connected, row ${row.id} (peer, kept ccid=${claimedCcid})`
            );
          } else {
            await updateRow(row.id, {
              status: "connected",
              call_control_id: ccid,
              call_session_id: sessionId,
            });
            console.log(`[Webhook] ${eventType} → connected, row ${row.id}`);
          }
        } else {
          console.warn(`[Webhook] ${eventType} — no row found`);
        }
      }

      // Deterministic peer-stamp: cross-stamp external_ccid on every
      // session peer. Fires on both call.answered and call.bridged so
      // outbound SDK calls (where only call.answered may fire, not
      // call.bridged) still get stamped.
      if (ccid && sessionId) {
        await crossStampSessionPeers(sessionId, ccid, eventType);
      }

      // Outbound SDK → PSTN correlation by phone+time (no session join).
      //
      // For outbound WebRTC→PSTN calls, the SDK-preinserted row (phone
      // + call_control_id=SDK_ccid from app/page.tsx) and the PSTN leg
      // (this webhook event) don't reliably share call_session_id, so
      // crossStampSessionPeers is a no-op. When THIS event is an
      // outgoing PSTN leg (direction=outgoing, to is phone-shaped), we
      // KNOW this ccid is the external leg for the rep's SDK row. Find
      // the most recent outbound row whose phone_number matches `to`
      // and that isn't already paired, and stamp external_ccid=ccid.
      //
      // Scoped tightly: last 5 min, direction=outbound, not already
      // stamped, and whose existing call_control_id (if any) differs
      // from this PSTN ccid (so we don't stamp the PSTN leg's own row).
      const direction = (payload?.direction as string | undefined) || "";
      const isOutgoingLeg =
        direction === "outgoing" || direction === "outbound";
      const toIsPhone = /^\+?\d{7,15}$/.test(to);
      if (isOutgoingLeg && toIsPhone && ccid && to) {
        const adminOut = getAdmin();
        const fiveMinAgo = new Date(Date.now() - 300_000).toISOString();
        const { data: candidates } = await adminOut
          .from("call_logs")
          .select("id, call_control_id, phone_number")
          .eq("direction", "outbound")
          .is("external_ccid", null)
          .gte("created_at", fiveMinAgo)
          .order("created_at", { ascending: false })
          .limit(10);
        const toPlus = to.startsWith("+") ? to : `+${to}`;
        const toBare = to.startsWith("+") ? to.slice(1) : to;
        for (const c of (candidates || []) as Array<{
          id: string;
          call_control_id: string | null;
          phone_number: string | null;
        }>) {
          const rawPhone = c.phone_number || "";
          const p = cleanNumber(rawPhone);
          const pPlus = p.startsWith("+") ? p : `+${p}`;
          const pBare = p.startsWith("+") ? p.slice(1) : p;
          const matched =
            p === to ||
            p === toPlus ||
            p === toBare ||
            pPlus === toPlus ||
            pBare === toBare;
          if (!matched) continue;
          if (c.call_control_id === ccid) continue;
          await adminOut
            .from("call_logs")
            .update({ external_ccid: ccid })
            .eq("id", c.id);
          console.log(
            `[bridge/pair] outbound stamped external_ccid=${ccid} on row=${c.id} sdk_ccid=${c.call_control_id ?? "(none)"} to=${to}`
          );
          break;
        }
      }

      // Capture the OTHER leg's ccid for blind transfer via SIP REFER.
      //
      // Telnyx doesn't include a peer/other-leg ccid in the
      // call.bridged payload — only call_control_id (this leg) and
      // call_session_id (shared). We correlate by joining on session:
      // find the call_logs row for this session, and if this event's
      // ccid differs from the row's primary ccid, stamp it as
      // external_ccid.
      if (eventType === "call.bridged" && ccid && sessionId) {
        const admin = getAdmin();
        const { data: sessionRows } = await admin
          .from("call_logs")
          .select("id, call_control_id, external_ccid")
          .eq("call_session_id", sessionId)
          .order("created_at", { ascending: false })
          .limit(2);
        const rows = (sessionRows || []) as Array<{
          id: string;
          call_control_id: string | null;
          external_ccid: string | null;
        }>;
        for (const r of rows) {
          if (
            r.call_control_id &&
            r.call_control_id !== ccid &&
            r.external_ccid !== ccid
          ) {
            await admin
              .from("call_logs")
              .update({ external_ccid: ccid })
              .eq("id", r.id);
            console.log(
              `[bridge] stamped external_ccid=${ccid} on row=${r.id} primary=${r.call_control_id} session=${sessionId}`
            );
          }
        }
      }
      break;
    }

    case "call.hangup": {
      let duration = 0;
      const start = payload?.start_time as string | undefined;
      const end = payload?.end_time as string | undefined;
      if (start && end) {
        duration = Math.floor(
          (new Date(end).getTime() - new Date(start).getTime()) / 1000
        );
      }
      if (!duration && payload?.duration_seconds) {
        duration = Math.floor(payload.duration_seconds as number);
      }

      // Surface Telnyx's hangup_cause + hangup_source so we can tell who
      // dropped the call when "the call just dropped" reports come in.
      // Common causes: normal_clearing (graceful end), call_rejected,
      // user_busy, no_user_responding, originator_cancel,
      // recovery_on_timer_expire, media_timeout, normal_temporary_failure.
      // Common sources: caller (originator), callee (terminator), unknown.
      const hangupCause = (payload?.hangup_cause as string | undefined) || "?";
      const hangupSource = (payload?.hangup_source as string | undefined) || "?";
      const sipCause = (payload?.sip_hangup_cause as string | undefined) || "";
      console.log(
        `[Webhook] hangup duration=${duration}s ccid=${ccid} cause=${hangupCause} source=${hangupSource}${sipCause ? ` sip=${sipCause}` : ""}`
      );

      // ccid-first lookup. findRecentCall's 1-minute phone_number window
      // silently misses any call longer than 60s — every multi-minute call
      // gets stuck at status='connected' duration=0. ccid is the stable
      // unique key for a leg, so match on that before falling back.
      // (See David Madison's 32-min and 15-min calls on 2026-04-22.)
      const finalStatus: "completed" | "missed" =
        duration > 0 ? "completed" : "missed";
      const hangupUpdates: Record<string, unknown> = {
        status: finalStatus,
        duration_seconds: duration,
        hangup_cause: hangupCause === "?" ? null : hangupCause,
        hangup_source: hangupSource === "?" ? null : hangupSource,
      };

      const adminHu = getAdmin();
      let resolvedRowId = "";
      if (ccid) {
        const { data: byCcid } = await adminHu
          .from("call_logs")
          .select("id")
          .eq("call_control_id", ccid)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const byCcidId = (byCcid?.id as string | undefined) || "";
        if (byCcidId) {
          resolvedRowId = byCcidId;
          await updateRow(resolvedRowId, hangupUpdates);
          console.log(
            `[Webhook] hangup → ${finalStatus}, row=${resolvedRowId} by ccid`
          );
        }
      }

      if (!resolvedRowId) {
        const row = await findRecentCall(payload);
        const rowId = (row?.id as string | undefined) || "";
        if (rowId) {
          resolvedRowId = rowId;
          await updateRow(resolvedRowId, {
            ...hangupUpdates,
            call_control_id: ccid,
          });
          console.log(
            `[Webhook] hangup → ${finalStatus}, row=${resolvedRowId} by phone fallback`
          );
        } else {
          console.warn(`[Webhook] hangup — no row found`);
        }
      }
      break;
    }

    case "call.recording.saved": {
      const urls = payload?.recording_urls as Record<string, string> | undefined;
      const url = urls?.mp3 || urls?.wav;
      const recSessionId = payload?.call_session_id as string | undefined;
      const recordingId = (payload?.recording_id ||
        payload?.id ||
        (payload as Record<string, unknown>)?.public_recording_id) as string | undefined;
      const recDuration = (payload?.duration_millis as number | undefined)
        ? Math.round((payload?.duration_millis as number) / 1000)
        : (payload?.duration as number | undefined) ?? null;
      console.log(
        `[Webhook] Recording url=${url} recording_id=${recordingId} ccid=${ccid} session=${recSessionId} from=${from} to=${to}`
      );

      // Voicemail path: when this recording belongs to a voicemail flow, we
      // harvest it into the voicemails table and skip the call_logs match.
      const harvested = await harvestVoicemailRecording({
        callControlId: ccid,
        recordingUrl: url || null,
        recordingId: recordingId || null,
        durationSeconds: recDuration,
      });
      if (harvested) break;

      if (url) {
        const admin = getAdmin();
        let rowId: string | null = null;

        // Strategy 1: call_control_id match
        if (!rowId && ccid) {
          const r = await findByCallControlId(ccid);
          if (r) rowId = r.id;
        }

        // Strategy 2: call_session_id match
        if (!rowId && recSessionId) {
          const { data } = await admin
            .from("call_logs")
            .select("id")
            .eq("call_session_id", recSessionId)
            .limit(1);
          if (data && data.length > 0) {
            rowId = data[0].id;
            console.log(`[Webhook] Recording matched by session_id, row ${rowId}`);
          }
        }

        // Strategy 3: phone match with 5 min window
        if (!rowId) {
          const r = await findRecentCall(payload, 5);
          if (r) rowId = r.id;
        }

        // Strategy 4: most recent completed call in 5 min (last resort)
        if (!rowId) {
          const fiveMinAgo = new Date(Date.now() - 300_000).toISOString();
          const { data } = await admin
            .from("call_logs")
            .select("id")
            .in("status", ["completed", "connected"])
            .is("recording_url", null)
            .gte("created_at", fiveMinAgo)
            .order("created_at", { ascending: false })
            .limit(1);
          if (data && data.length > 0) {
            rowId = data[0].id;
            console.log(`[Webhook] Recording matched by recent completed call, row ${rowId}`);
          }
        }

        if (rowId) {
          const update: Record<string, unknown> = { recording_url: url };
          if (recordingId) update.recording_id = recordingId;
          await updateRow(rowId, update);
          console.log(
            `[Webhook] recording saved to row ${rowId} recording_id=${recordingId}`
          );

          // Auto-trigger transcription + analysis when the owner has it on
          // (default ON). Runs after the response returns so Telnyx doesn't
          // wait on Whisper/Claude.
          const rowIdForAfter = rowId;
          after(async () => {
            try {
              const admin = getAdmin();
              const { data: row } = await admin
                .from("call_logs")
                .select(
                  "id, user_id, phone_number, direction, duration_seconds, status, created_at, recording_url"
                )
                .eq("id", rowIdForAfter)
                .single();
              if (!row || !row.recording_url) return;

              let autoAnalyze = true;
              if (row.user_id) {
                const { data: owner } = await admin
                  .from("softphone_users")
                  .select("auto_analyze_calls")
                  .eq("id", row.user_id)
                  .single();
                if (owner && owner.auto_analyze_calls === false) {
                  autoAnalyze = false;
                }
              }
              if (!autoAnalyze) {
                console.log(
                  `[Webhook] auto-analyze off for row ${rowIdForAfter}`
                );
                return;
              }

              const origin = process.env.NEXT_PUBLIC_APP_URL || "";
              if (!origin) {
                console.warn(
                  "[Webhook] NEXT_PUBLIC_APP_URL not set — skipping auto-analyze"
                );
                return;
              }

              const r = await fetch(`${origin}/api/ai/analyze-call`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  recording_url: row.recording_url,
                  call_log_id: row.id,
                  call_metadata: {
                    number: row.phone_number,
                    direction: row.direction,
                    duration: row.duration_seconds,
                    status: row.status,
                    timestamp: new Date(row.created_at).getTime(),
                  },
                }),
              });
              console.log(`[Webhook] auto-analyze status=${r.status}`);

              // If the call originated from a CRM pop-up (external_id set),
              // push a summary to the owner's configured Signal webhook. This
              // covers the case where the pop-up has already closed by the
              // time analysis finishes.
              const { data: enriched } = await admin
                .from("call_logs")
                .select("external_id")
                .eq("id", rowIdForAfter)
                .single();
              if (enriched?.external_id) {
                try {
                  const cb = await fetch(`${origin}/api/dial/callback`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      call_log_id: rowIdForAfter,
                      external_id: enriched.external_id,
                    }),
                  });
                  console.log(`[Webhook] crm callback status=${cb.status}`);
                } catch (cbErr) {
                  console.error("[Webhook] crm callback failed:", cbErr);
                }
              }
            } catch (err) {
              console.error("[Webhook] auto-analyze failed:", err);
            }
          });
        } else {
          console.warn(`[Webhook] recording.saved — NO ROW FOUND for url=${url}`);
        }
      }
      break;
    }

    default:
      console.log(`[Webhook] Unhandled: ${eventType}`);
  }

  return NextResponse.json({ status: "ok" });
}
