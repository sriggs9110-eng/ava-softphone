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
      "id, status, duration_seconds, recording_url, transcript, ai_analysis, transcript_status, ai_status, created_at"
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

  // Pipeline timings are not directly tracked as timestamps today. We
  // approximate using the single timestamps we do store (created_at only).
  // Until we add per-stage timestamps, these fields are null — surfaced
  // transparently in the UI.
  return NextResponse.json({
    total,
    with_recording: withRecording,
    with_transcript: withTranscript,
    with_ai: withAi,
    transcript_failed: transcriptFailed,
    ai_failed: aiFailed,
    avg_end_to_recording_sec: null,
    avg_recording_to_transcript_sec: null,
    avg_transcript_to_ai_sec: null,
  });
}
