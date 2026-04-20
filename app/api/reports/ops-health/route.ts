import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: caller } = await supabase
    .from("softphone_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!caller || caller.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start/end required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("call_logs")
    .select(
      "id, status, direction, duration_seconds, recording_url, transcript, ai_analysis, transcript_status, ai_status, transcript_error, created_at"
    )
    .gte("created_at", start)
    .lte("created_at", end);

  const list = rows || [];
  const total = list.length;
  const withRecording = list.filter((r) => !!r.recording_url).length;
  const withTranscript = list.filter((r) => !!r.transcript).length;
  const withAi = list.filter((r) => !!r.ai_analysis).length;
  const transcriptFailed = list.filter(
    (r) => r.transcript_status === "failed"
  ).length;
  const aiFailed = list.filter((r) => r.ai_status === "failed").length;
  const aiSkipped = list.filter(
    (r) => r.ai_status === "skipped_no_transcript"
  ).length;

  // Calls that should have a recording but don't: connected-status AND
  // duration > 3s AND older than 5 minutes AND recording_url still null.
  // Ring-group ringing rows have duration=0 so they're excluded.
  const fiveMinAgo = Date.now() - 5 * 60_000;
  const connectedStatuses = new Set(["completed", "connected"]);
  const missingRecordings = list.filter(
    (r) =>
      connectedStatuses.has(r.status || "") &&
      (r.duration_seconds ?? 0) > 3 &&
      !r.recording_url &&
      new Date(r.created_at).getTime() < fiveMinAgo
  );

  // Log each missing row — surfaces in Vercel logs so an admin can trace the
  // specific call to its record_start outcome.
  for (const r of missingRecordings.slice(0, 20)) {
    console.warn(
      `[ops-health] missing recording: id=${r.id} direction=${r.direction} dur=${r.duration_seconds}s status=${r.status} created=${r.created_at}`
    );
  }

  // Collect up to 5 recent transcript_error samples for quick UI surfacing.
  const transcriptErrorSamples = list
    .filter((r) => r.transcript_status === "failed" && r.transcript_error)
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      created_at: r.created_at,
      error: (r.transcript_error as string).slice(0, 200),
    }));

  // Pipeline timings: not directly tracked as per-stage timestamps today.
  // Until we add those, these fields are null — surfaced transparently.
  return NextResponse.json({
    total,
    with_recording: withRecording,
    with_transcript: withTranscript,
    with_ai: withAi,
    transcript_failed: transcriptFailed,
    ai_failed: aiFailed,
    ai_skipped_no_transcript: aiSkipped,
    missing_recordings: missingRecordings.length,
    transcript_error_samples: transcriptErrorSamples,
    avg_end_to_recording_sec: null,
    avg_recording_to_transcript_sec: null,
    avg_transcript_to_ai_sec: null,
  });
}
