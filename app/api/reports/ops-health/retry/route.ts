import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
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

  const body = await req.json().catch(() => ({}));
  const kind = body?.kind as "transcript" | "ai" | undefined;
  const start = body?.start as string | undefined;
  const end = body?.end as string | undefined;
  if (!kind || !start || !end) {
    return NextResponse.json(
      { error: "kind/start/end required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const filterCol = kind === "transcript" ? "transcript_status" : "ai_status";

  const { data: rows } = await admin
    .from("call_logs")
    .select(
      "id, phone_number, from_number, direction, duration_seconds, status, recording_url, transcript, created_at"
    )
    .eq(filterCol, "failed")
    .gte("created_at", start)
    .lte("created_at", end)
    .limit(100);

  const candidates = rows || [];
  const origin = process.env.NEXT_PUBLIC_APP_URL || "";

  // Kick off retries after returning.
  after(async () => {
    for (const r of candidates) {
      try {
        await fetch(`${origin}/api/ai/analyze-call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recording_url: r.recording_url,
            call_log_id: r.id,
            call_metadata: {
              number: r.phone_number,
              from_number: r.from_number,
              direction: r.direction,
              duration: r.duration_seconds,
              status: r.status,
              timestamp: new Date(r.created_at).getTime(),
              transcript: r.transcript,
            },
          }),
        });
        await new Promise((res) => setTimeout(res, 400));
      } catch (err) {
        console.error("[ops-health/retry] error for", r.id, err);
      }
    }
  });

  return NextResponse.json({ queued: candidates.length });
}
