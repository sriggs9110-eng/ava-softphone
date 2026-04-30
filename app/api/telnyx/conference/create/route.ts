import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Conference merge for warm transfer.
//
// Replaces the prior /api/telnyx/conference (which chained partial
// /actions/join calls without persistence, liveness checks, or
// rollback). Uses Telnyx's first-class Conference resource per
// developers.telnyx.com/api/call-control/create-conference and
// avoids /actions/bridge entirely (which silently fails between
// two single-leg calls — see PHASE_1A_REPORT.md).
//
// Body: { repCcid, consultCcid, customerCcid? }
//   repCcid       = rep's WebRTC ccid for the original (held) call
//   consultCcid   = consult call ccid (= transferCallRef.current's
//                   ccid from warmTransferStart)
//   customerCcid  = optional. If omitted, the route looks it up from
//                   call_logs.external_ccid WHERE call_control_id =
//                   repCcid — same field the dial-outbound two-leg
//                   path stamps at insert time. The client doesn't
//                   have to track it, which keeps the SDK hook
//                   ignorant of server-side schema details.
//
// Returns: { success, conferenceId, status } on 200.
//
// Errors:
//   500 on conference creation failure, join failure, or persistence
//   failure. On any join failure, attempts /actions/leave for any
//   side that succeeded plus the rep (initial participant) so we
//   don't leave Telnyx in a half-merged state.
//
// No pre-flight liveness checks. Production test 2026-04-30 12:03 UTC
// proved them counterproductive: three sequential GETs added ~900ms
// of latency while the customer's leg was orphan-bridged from the
// moment of conference create, and Telnyx reaped it before the join
// loop reached it. /actions/join itself surfaces dead-leg errors as
// 422; the existing cleanup path returns the right 4xx.
//
// Side effects on success:
//   INSERT into call_conferences (id, telnyx_conference_id, rep_ccid,
//   customer_ccid, consult_ccid, rep_user_id, status='active').
//   Webhooks (conference.participant_left etc.) correlate back via
//   this row. See app/api/telnyx/webhook/route.ts.
//
// Logged with [conf/create] prefix.

const TELNYX_API = "https://api.telnyx.com/v2";

async function joinLeg(
  conferenceId: string,
  ccid: string,
  apiKey: string
): Promise<{ ok: true } | { ok: false; status: number; detail: string }> {
  const res = await fetch(
    `${TELNYX_API}/conferences/${conferenceId}/actions/join`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ call_control_id: ccid }),
    }
  );
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  const detail =
    body?.errors?.[0]?.detail ||
    body?.errors?.[0]?.title ||
    `join failed HTTP ${res.status}`;
  return { ok: false, status: res.status, detail };
}

async function leaveQuiet(
  conferenceId: string,
  ccid: string,
  apiKey: string
): Promise<void> {
  // Best-effort cleanup. Don't surface errors — caller is already in
  // an error path; we just want to limit damage.
  try {
    await fetch(
      `${TELNYX_API}/conferences/${conferenceId}/actions/leave`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ call_control_id: ccid }),
      }
    );
  } catch {
    /* swallow */
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repCcid, consultCcid } = body as {
    repCcid?: string;
    consultCcid?: string;
    customerCcid?: string;
  };
  let customerCcid = (body as { customerCcid?: string }).customerCcid;

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!repCcid || !consultCcid) {
    return NextResponse.json(
      { error: "repCcid and consultCcid required" },
      { status: 400 }
    );
  }

  // Auth: only an authenticated rep can create a conference for their own call.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Look up customerCcid if not provided. external_ccid is stamped at
  // dial-outbound insert time (?new_dial=1 path); for inbound calls
  // it's stamped at fan-out pairing time. If still not found here the
  // call wasn't placed via the two-leg path and conference merge
  // can't address the customer's PSTN leg directly.
  if (!customerCcid) {
    const adminLookup = createAdminClient();
    const { data: repRow } = await adminLookup
      .from("call_logs")
      .select("external_ccid")
      .eq("call_control_id", repCcid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    customerCcid = (repRow?.external_ccid as string | null) || undefined;
    if (!customerCcid) {
      console.log(
        `[conf/create] no external_ccid for repCcid=${repCcid} — conference requires the two-leg dial path`
      );
      return NextResponse.json(
        {
          error:
            "Conference merge requires a separately addressable customer leg. Place the call with ?new_dial=1 (two-leg) to enable merge.",
        },
        { status: 409 }
      );
    }
  }

  console.log(
    `[conf/create] request rep=${user.id} repCcid=${repCcid} customerCcid=${customerCcid} consultCcid=${consultCcid}`
  );

  // Step 1: create the conference. Telnyx requires an initial
  // call_control_id (the API rejects without one). REP enters first
  // as the initial participant — see commit ae821cb's reasoning:
  // rep transitions directly from the rep↔customer bridge into the
  // conference.
  //
  // ── Why no liveness pre-check ──────────────────────────────────
  // The previous version did three sequential `GET /v2/calls/{ccid}`
  // probes BEFORE this create. Those added ~900ms of latency.
  // Production test 2026-04-30 12:03:25 UTC measured the full route
  // at 4.32s wall-clock and the customer-leg join 422'd at the end
  // because Telnyx's bridge reaper had already reaped the customer's
  // leg (orphaned the moment rep entered the conference).
  //
  // The liveness checks were paying a 900ms cost to surface an error
  // we ALREADY get from the join itself — `joinLeg` returns
  // {ok:false, status, detail} on a 422 "call no longer active". The
  // existing cleanup-on-fail path returns the right 4xx to the
  // client. So: drop the probes, claw back the latency, let
  // /actions/join be the source of truth.
  //
  // ── Why parallel joins ─────────────────────────────────────────
  // Sequential consult-then-customer added another ~1s. With both
  // joins running concurrently via Promise.allSettled, total
  // post-create wall-clock drops to roughly the slower of the two
  // (~700ms). Combined with no liveness, the route's total elapsed
  // time goes from ~4.3s to ~1.4s — well inside Telnyx's
  // orphan-bridge tolerance for the customer leg.
  const conferenceName = `merge-${repCcid.slice(-8)}-${Date.now()}`;
  const createStartedAt = Date.now();
  const createRes = await fetch(`${TELNYX_API}/conferences`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      call_control_id: repCcid,
      name: conferenceName,
      beep_enabled: "never",
    }),
  });
  const createBody = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    const detail =
      createBody?.errors?.[0]?.detail ||
      createBody?.errors?.[0]?.title ||
      "Conference create failed";
    console.error(
      `[conf/create] create FAILED status=${createRes.status} detail=${detail}`
    );
    return NextResponse.json({ error: detail }, { status: createRes.status });
  }
  const conferenceId = createBody?.data?.id as string | undefined;
  if (!conferenceId) {
    console.error(
      `[conf/create] create response missing id body=${JSON.stringify(createBody).slice(0, 400)}`
    );
    return NextResponse.json(
      { error: "Telnyx returned no conference id" },
      { status: 500 }
    );
  }
  const createElapsed = Date.now() - createStartedAt;
  console.log(
    `[conf/create] created conferenceId=${conferenceId} initial=repCcid elapsed=${createElapsed}ms name=${conferenceName}`
  );
  // repCcid is implicitly joined by the create call.

  // Step 2: join consult and customer IN PARALLEL. Customer's leg
  // is orphan-bridged from the moment of conference create; the
  // longer we wait, the higher the chance Telnyx reaps it.
  const joinStartedAt = Date.now();
  const [consultResult, customerResult] = await Promise.allSettled([
    joinLeg(conferenceId, consultCcid, apiKey),
    joinLeg(conferenceId, customerCcid, apiKey),
  ]);
  const joinElapsed = Date.now() - joinStartedAt;

  // Promise.allSettled gives us {status:"fulfilled", value} or
  // {status:"rejected", reason}. We further unwrap fulfilled results
  // because joinLeg returns its own ok/error discriminated union.
  type JoinOutcome =
    | { ok: true }
    | { ok: false; status?: number; detail: string };
  function settledToOutcome(
    s: PromiseSettledResult<
      { ok: true } | { ok: false; status: number; detail: string }
    >
  ): JoinOutcome {
    if (s.status === "fulfilled") return s.value;
    return {
      ok: false,
      detail:
        s.reason instanceof Error ? s.reason.message : String(s.reason),
    };
  }
  const consultOutcome = settledToOutcome(consultResult);
  const customerOutcome = settledToOutcome(customerResult);

  console.log(
    `[conf/create] join consult ccid=${consultCcid} ${
      consultOutcome.ok ? "ok" : `FAILED ${("status" in consultOutcome && consultOutcome.status) || "?"} ${consultOutcome.detail}`
    } | join customer ccid=${customerCcid} ${
      customerOutcome.ok ? "ok" : `FAILED ${("status" in customerOutcome && customerOutcome.status) || "?"} ${customerOutcome.detail}`
    } | parallel_elapsed=${joinElapsed}ms`
  );

  // If EITHER join failed, we've left some subset of legs in the
  // conference. Best-effort /actions/leave for whichever side did
  // succeed, plus repCcid (the create-call participant). Don't
  // surface "partial: true" to the client unless one of the two
  // actually succeeded — when both failed, customer is just dead
  // and the merge never had a chance.
  if (!consultOutcome.ok || !customerOutcome.ok) {
    const leaveTargets: string[] = [repCcid];
    if (consultOutcome.ok) leaveTargets.push(consultCcid);
    if (customerOutcome.ok) leaveTargets.push(customerCcid);
    await Promise.allSettled(
      leaveTargets.map((c) => leaveQuiet(conferenceId, c, apiKey))
    );

    // Pick the more useful error to report. If customer failed it's
    // the structural failure mode we just spent two days fixing —
    // surface that. Otherwise consult.
    const primaryFail = !customerOutcome.ok ? "customer" : "consult";
    const primaryDetail = !customerOutcome.ok
      ? customerOutcome.detail
      : (consultOutcome as Exclude<JoinOutcome, { ok: true }>).detail;
    return NextResponse.json(
      {
        error: `Failed to add ${primaryFail} to conference: ${primaryDetail}`,
        partial: consultOutcome.ok || customerOutcome.ok,
      },
      { status: 500 }
    );
  }

  // Step 4: persist for webhook correlation.
  const admin = createAdminClient();
  const { error: insertErr } = await admin.from("call_conferences").insert({
    telnyx_conference_id: conferenceId,
    rep_ccid: repCcid,
    customer_ccid: customerCcid,
    consult_ccid: consultCcid,
    rep_user_id: user.id,
    status: "active",
  });
  if (insertErr) {
    console.error(
      `[conf/create] persistence failed conferenceId=${conferenceId}: ${insertErr.message}`
    );
    // Don't roll back the Telnyx state — the conference is live and
    // working, the rep is talking. Webhooks won't be able to correlate
    // participant-left events back to a conference, but the merge
    // itself is fine. Surface a soft warning.
    return NextResponse.json({
      success: true,
      conferenceId,
      status: "active",
      warning:
        "conference active but DB persistence failed — leave/end may not auto-cleanup recording",
    });
  }

  console.log(
    `[conf/create] success conferenceId=${conferenceId} all 3 legs joined + persisted`
  );

  return NextResponse.json({
    success: true,
    conferenceId,
    status: "active",
  });
}
