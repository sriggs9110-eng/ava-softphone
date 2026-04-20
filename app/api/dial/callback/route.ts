import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pushes a call summary to the owner's configured Signal webhook.
 *
 * Invoked in scenarios where the Pepper pop-up may already have closed by the
 * time AI analysis lands (post-recording). Safe to call multiple times — the
 * remote webhook is responsible for idempotency on its side.
 *
 * Body: { call_log_id: string, external_id?: string, webhook_url?: string }
 * - webhook_url overrides the owner's stored URL if provided (useful for
 *   testing). For production callbacks this should be omitted and the
 *   caller should rely on the stored softphone_users.signal_webhook_url.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const callLogId = body?.call_log_id as string | undefined;
  const externalId = (body?.external_id as string) || null;
  const overrideUrl = (body?.webhook_url as string) || null;

  if (!callLogId) {
    return NextResponse.json({ error: "call_log_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: log, error } = await admin
    .from("call_logs")
    .select(
      "id, user_id, phone_number, direction, duration_seconds, status, recording_url, transcript, ai_summary, ai_score, ai_status, transcript_status, created_at"
    )
    .eq("id", callLogId)
    .single();

  if (error || !log) {
    return NextResponse.json({ error: "call_log not found" }, { status: 404 });
  }

  let webhookUrl = overrideUrl;
  if (!webhookUrl && log.user_id) {
    const { data: owner } = await admin
      .from("softphone_users")
      .select("signal_webhook_url")
      .eq("id", log.user_id)
      .single();
    webhookUrl = owner?.signal_webhook_url || null;
  }

  if (!webhookUrl) {
    return NextResponse.json(
      { error: "No webhook URL configured for this call's owner" },
      { status: 400 }
    );
  }

  const payload = {
    type: "pepper.call_updated",
    external_id: externalId,
    call_log_id: log.id,
    phone_number: log.phone_number,
    direction: log.direction,
    duration_seconds: log.duration_seconds,
    disposition: log.status,
    recording_url: log.recording_url,
    ai_summary: log.ai_summary,
    ai_score: log.ai_score,
    transcript_status: log.transcript_status,
    ai_status: log.ai_status,
    created_at: log.created_at,
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return NextResponse.json({ success: true, status: res.status });
  } catch (err) {
    console.error("[dial/callback] webhook POST failed:", err);
    return NextResponse.json(
      { error: "Failed to deliver webhook" },
      { status: 502 }
    );
  }
}
