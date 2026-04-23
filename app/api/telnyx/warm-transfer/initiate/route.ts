import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Warm (attended) transfer — step 1.
//
// Puts the original caller on hold at the Telnyx level by issuing
// actions/hold on the external leg (not the rep's WebRTC leg). The
// client then SDK-dials the transfer target so the rep can talk to
// them privately. Complete/Cancel bridge or resume as needed.
//
// Body: { repCcid: string }                 (destinationNumber is optional, not used here)
// Returns: { success, externalCcid }
//
// Logged with [warm/initiate] prefix.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { repCcid } = body as { repCcid?: string; destinationNumber?: string };

  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "TELNYX_API_KEY not configured" },
      { status: 500 }
    );
  }
  if (!repCcid) {
    return NextResponse.json({ error: "repCcid required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("call_logs")
    .select("external_ccid, direction")
    .eq("call_control_id", repCcid)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fallback: when no external_ccid is stamped we use repCcid directly.
  // For outbound SDK→PSTN calls, the SDK's call_control_id IS the PSTN
  // leg's ccid (there's no separate external leg visible in our
  // webhook stream), so holding repCcid holds the callee — exactly what
  // warm transfer needs. For inbound fan-out we rely on pairing-time
  // stamping (see fanOutToAgents) to populate external_ccid; if that
  // somehow didn't run, this fallback will fail at the Telnyx call and
  // surface the underlying error to the UI rather than our 409 lie.
  const externalCcid = (row?.external_ccid as string | null) || null;
  const targetCcid = externalCcid || repCcid;
  if (!externalCcid) {
    console.log(
      `[warm/initiate/fallback] no external_ccid for repCcid=${repCcid} — using repCcid as hold target (expected for outbound SDK calls)`
    );
  }

  console.log(
    `[warm/initiate] request repCcid=${repCcid} targetCcid=${targetCcid} externalCcid=${externalCcid ?? "(none)"} — hold`
  );

  // Pre-flight: confirm the leg is still alive before /actions/hold.
  // Without this, Telnyx returns a generic 404 that looks like a URL
  // problem — this lets us give the UI a specific "call not connected
  // yet" message instead of a misleading error.
  try {
    const probe = await fetch(
      `https://api.telnyx.com/v2/calls/${targetCcid}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (probe.ok) {
      const pbody = (await probe.json().catch(() => ({}))) as {
        data?: { is_alive?: boolean };
      };
      const alive = pbody?.data?.is_alive;
      if (alive === false) {
        console.log(
          `[warm/initiate] call not alive, refusing hold targetCcid=${targetCcid}`
        );
        return NextResponse.json(
          {
            error:
              "Call isn't connected yet. Wait until the other side picks up before transferring.",
          },
          { status: 409 }
        );
      }
    }
  } catch (err) {
    console.warn(
      `[warm/initiate] pre-flight probe threw — continuing to hold anyway:`,
      (err as Error).message
    );
  }

  const res = await fetch(
    `https://api.telnyx.com/v2/calls/${targetCcid}/actions/hold`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );
  const data = await res.json().catch(() => ({}));
  console.log(
    `[warm/initiate] response status=${res.status} responseBody=${JSON.stringify(data)}`
  );

  if (!res.ok) {
    const detail =
      data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "Hold failed";
    return NextResponse.json({ error: detail }, { status: res.status });
  }

  return NextResponse.json({
    success: true,
    externalCcid: targetCcid,
    usedExternalLeg: Boolean(externalCcid),
  });
}
