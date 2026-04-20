import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const OBJECTION_TAXONOMY = [
  "price",
  "timing",
  "competitor",
  "authority",
  "need",
  "trust",
  "unclear",
] as const;

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function stampStatus(
  callLogId: string | undefined,
  updates: Record<string, unknown>
) {
  if (!callLogId) return;
  try {
    const admin = getAdmin();
    await admin.from("call_logs").update(updates).eq("id", callLogId);
  } catch (err) {
    console.error("[AI] stampStatus failed:", err);
  }
}

type TranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; error: string };

/**
 * Fetch a fresh S3-presigned URL for a Telnyx recording. Stored URLs expire
 * after 10 minutes (X-Amz-Expires=600) — this endpoint returns a new one
 * every time, so we always call it right before streaming the file.
 */
async function refreshRecordingUrl(recordingId: string): Promise<string | null> {
  const telnyxKey = process.env.TELNYX_API_KEY;
  if (!telnyxKey) {
    console.warn("[AI] TELNYX_API_KEY missing — cannot refresh recording URL");
    return null;
  }
  try {
    const res = await fetch(
      `https://api.telnyx.com/v2/recordings/${encodeURIComponent(recordingId)}`,
      { headers: { Authorization: `Bearer ${telnyxKey}` } }
    );
    console.log(`[AI] Telnyx recordings/${recordingId} status=${res.status}`);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[AI] Telnyx recording refresh failed: ${errText.slice(0, 500)}`);
      return null;
    }
    const body = (await res.json()) as {
      data?: { recording_urls?: { mp3?: string; wav?: string } };
    };
    const fresh = body?.data?.recording_urls?.mp3 || body?.data?.recording_urls?.wav;
    return fresh || null;
  } catch (err) {
    console.error("[AI] Telnyx recording refresh error:", err);
    return null;
  }
}

async function transcribeWithWhisper(args: {
  recordingUrl: string;
  recordingId: string | null;
}): Promise<TranscribeResult> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    const msg = "OPENAI_API_KEY missing on server";
    console.warn(`[AI] ${msg}`);
    return { ok: false, error: msg };
  }

  // Always prefer a freshly signed URL when we have the recording_id — stored
  // URLs expire 10 minutes after the webhook fires.
  let url = args.recordingUrl;
  if (args.recordingId) {
    const fresh = await refreshRecordingUrl(args.recordingId);
    if (fresh) {
      console.log(
        `[AI] Refreshed recording URL via Telnyx for id=${args.recordingId}`
      );
      url = fresh;
    } else {
      console.warn(
        `[AI] Fallback: using stored URL for id=${args.recordingId} (refresh failed)`
      );
    }
  } else {
    console.warn(
      "[AI] No recording_id persisted — using stored URL (may be expired)"
    );
  }

  console.log("[AI] Downloading recording:", url.slice(0, 120) + "…");
  let audioRes: Response;
  try {
    audioRes = await fetch(url);
  } catch (err) {
    const msg = `recording fetch threw: ${(err as Error).message}`;
    console.error("[AI]", msg);
    return { ok: false, error: msg };
  }

  if (!audioRes.ok) {
    const errText = await audioRes.text().catch(() => "");
    const msg = `recording download ${audioRes.status}${
      errText ? `: ${errText.slice(0, 400)}` : ""
    }`;
    console.error("[AI]", msg);
    return { ok: false, error: msg };
  }

  const audioBlob = await audioRes.blob();
  console.log(
    `[AI] Downloaded audio: ${audioBlob.size} bytes ${audioBlob.type}`
  );
  if (audioBlob.size === 0) {
    return { ok: false, error: "downloaded recording is 0 bytes" };
  }

  const formData = new FormData();
  formData.append("file", audioBlob, "recording.mp3");
  formData.append("model", "whisper-1");
  formData.append("response_format", "text");

  let whisperRes: Response;
  try {
    whisperRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: formData,
      }
    );
  } catch (err) {
    const msg = `whisper request threw: ${(err as Error).message}`;
    console.error("[AI]", msg);
    return { ok: false, error: msg };
  }

  if (!whisperRes.ok) {
    const errText = await whisperRes.text().catch(() => "");
    const msg = `whisper ${whisperRes.status}${
      errText ? `: ${errText.slice(0, 400)}` : ""
    }`;
    console.error("[AI]", msg);
    return { ok: false, error: msg };
  }

  const transcript = (await whisperRes.text()).trim();
  console.log(`[AI] Whisper transcript length: ${transcript.length}`);
  if (transcript.length === 0) {
    return { ok: false, error: "whisper returned empty transcript" };
  }
  return { ok: true, transcript };
}

/**
 * Parse Claude's output into a structured analysis. Expected a single JSON
 * object. If anything is malformed, return a partial with whatever we could
 * extract — never throw — so analysis persists even when Claude gets creative.
 */
function parseAnalysis(content: string): {
  ok: boolean;
  partial: Record<string, unknown>;
  reason?: string;
} {
  let raw = content;
  const match = content.match(/\{[\s\S]*\}/);
  if (match) raw = match[0];

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { ok: true, partial: parsed };
  } catch (err) {
    console.error("[AI] JSON parse failed:", (err as Error).message);
    // Best-effort partial extraction — look for a summary string so the UI
    // isn't completely empty.
    const partial: Record<string, unknown> = {};
    const sumMatch = content.match(/"summary"\s*:\s*"([^"]+)"/);
    if (sumMatch) partial.summary = sumMatch[1];
    const scoreMatch = content.match(/"score"\s*:\s*(\d+(?:\.\d+)?)/);
    if (scoreMatch) partial.score = Number(scoreMatch[1]);
    return {
      ok: false,
      partial,
      reason: `JSON parse failed: ${(err as Error).message}`,
    };
  }
}

function normalizeObjectionTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (typeof t === "string" ? t.toLowerCase().trim() : ""))
    .filter((t): t is string => OBJECTION_TAXONOMY.includes(t as (typeof OBJECTION_TAXONOMY)[number]));
}

function normalizeTopicTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => (typeof t === "string" ? t.toLowerCase().trim().slice(0, 50) : ""))
    .filter((t) => t.length > 0)
    .slice(0, 7);
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}

/** extract a 3-digit area code from an E.164 / 10-digit / 11-digit phone string. */
function areaCodeOf(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.substring(1, 4);
  if (digits.length === 10) return digits.substring(0, 3);
  if (digits.length > 11 && digits.startsWith("1")) return digits.substring(1, 4);
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    recording_url,
    call_metadata,
    call_log_id,
    recording_id: bodyRecordingId,
  } = body;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Allow refreshing by pulling recording_id from the row when the caller
  // didn't pass it (the webhook auto-trigger doesn't include it today).
  let recordingId: string | null = bodyRecordingId ?? null;
  if (!recordingId && call_log_id) {
    try {
      const admin = getAdmin();
      const { data } = await admin
        .from("call_logs")
        .select("recording_id")
        .eq("id", call_log_id)
        .single();
      recordingId = (data?.recording_id as string | null) ?? null;
    } catch {
      // noop — we'll fall back to the stored URL
    }
  }

  const hasRecording = !!recording_url;
  let transcript = call_metadata?.transcript || null;
  const duration = call_metadata?.duration || 0;
  const direction = call_metadata?.direction || "unknown";
  const number = call_metadata?.number || "Unknown";
  const fromNumber = call_metadata?.from_number || null;

  // Derived local-presence flags — persisted per call so the reports
  // endpoint can aggregate cheaply.
  const localPresenceFlags: Record<string, boolean | null> = (() => {
    const envFallback =
      process.env.TELNYX_PHONE_NUMBER ||
      process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER ||
      null;
    if (!fromNumber) return { used_local_presence: null, matched_area_code: null };
    const isFallback = envFallback ? fromNumber === envFallback : false;
    return {
      used_local_presence: !isFallback,
      matched_area_code: areaCodeOf(fromNumber) === areaCodeOf(number),
    };
  })();
  if (call_log_id) await stampStatus(call_log_id, localPresenceFlags);

  // Transcription phase
  if (hasRecording && !transcript) {
    await stampStatus(call_log_id, {
      transcript_status: "processing",
      transcript_error: null,
    });
    const result = await transcribeWithWhisper({
      recordingUrl: recording_url,
      recordingId,
    });
    if (result.ok) {
      transcript = result.transcript;
      if (call_log_id) {
        await stampStatus(call_log_id, {
          transcript,
          transcript_status: "complete",
          transcript_error: null,
        });
        console.log("[AI] Saved transcript to call_logs");
      }
    } else if (call_log_id) {
      await stampStatus(call_log_id, {
        transcript_status: "failed",
        transcript_error: result.error.slice(0, 1000),
      });
    }
  } else if (!hasRecording && call_log_id && !transcript) {
    await stampStatus(call_log_id, { transcript_status: "none" });
  } else if (transcript && call_log_id) {
    await stampStatus(call_log_id, { transcript_status: "complete" });
  }

  const hasTranscript = !!transcript;

  // Gate AI on transcript success. Coaching without the actual conversation
  // produces confident generic advice — worse than nothing. Spec option A.
  if (!hasTranscript) {
    if (call_log_id) {
      await stampStatus(call_log_id, { ai_status: "skipped_no_transcript" });
    }
    return NextResponse.json(
      {
        skipped: "no_transcript",
        reason:
          "Transcription didn't land — coaching requires the actual conversation, not metadata.",
      },
      { status: 200 }
    );
  }

  if (!anthropicKey) {
    await stampStatus(call_log_id, { ai_status: "failed" });
    return NextResponse.json(
      { error: "Anthropic API key not configured" },
      { status: 500 }
    );
  }

  const analysisContext = `Full transcript of the conversation:\n${transcript}`;

  const taxonomy = OBJECTION_TAXONOMY.join('", "');

  const systemPrompt = `You are a sales call analyst for Ava Residential, a B2B inside sales team at an ISP reseller. Analyze this transcript and return ONLY a valid JSON object with:
- summary: 3-4 sentences based on the actual conversation
- score: number 1-10 (qualifying, objection handling, next steps, professionalism)
- score_reasoning: why this score, referencing specifics from the call
- talk_ratio: { agent: int 0-100, prospect: int 0-100 }  (sum to 100)
- key_topics: array of 3-5 strings discussed
- sentiment: "positive" | "negative" | "neutral"
- coaching: array of 2-3 actionable suggestions referencing what was said
- highlights: array of notable quotes (good or bad)
- talk_ratio_rep: int 0-100 — same as talk_ratio.agent
- talk_ratio_prospect: int 0-100 — same as talk_ratio.prospect
- question_count: int — number of distinct questions the rep asked
- longest_monologue_sec: int — longest uninterrupted stretch by either side, in seconds (best estimate from transcript pacing)
- interruption_count: int — times the rep cut off the prospect mid-sentence
- objection_tags: array of strings drawn ONLY from this taxonomy: ["${taxonomy}"]. Use [] if no objections raised.
- topic_tags: array of 3-7 free-form lowercase strings capturing what the call was about (e.g. "fiber install", "billing dispute")
Return ONLY JSON, no prose before or after.`;

  await stampStatus(call_log_id, { ai_status: "processing" });

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analyze this sales call:\n\nCall metadata:\n- Phone number: ${number}\n- Direction: ${direction}\n- Duration: ${duration} seconds (${Math.floor(duration / 60)}m ${duration % 60}s)\n- Status: ${call_metadata?.status || "completed"}\n- Timestamp: ${call_metadata?.timestamp ? new Date(call_metadata.timestamp).toLocaleString() : "Unknown"}\n\n${analysisContext}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errData = await claudeRes.json().catch(() => ({}));
      console.error("[AI] Claude error:", errData);
      await stampStatus(call_log_id, { ai_status: "failed" });
      return NextResponse.json(
        { error: errData.error?.message || "Claude API request failed" },
        { status: claudeRes.status }
      );
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text || "";
    const { ok, partial, reason } = parseAnalysis(content);

    if (!ok) {
      console.warn("[AI] partial-save due to parse issue:", reason);
    }

    // Build the row update. Save what we can, even if some fields are missing.
    const update: Record<string, unknown> = {};

    if (typeof partial.summary === "string") update.ai_summary = partial.summary;
    const score = numOrNull(partial.score);
    if (score !== null) update.ai_score = score;
    if (Object.keys(partial).length > 0) update.ai_analysis = partial;

    const talkRatio = partial.talk_ratio as { agent?: unknown; prospect?: unknown } | undefined;
    const repRatio =
      intOrNull(partial.talk_ratio_rep) ??
      (talkRatio ? intOrNull(talkRatio.agent) : null);
    const prospectRatio =
      intOrNull(partial.talk_ratio_prospect) ??
      (talkRatio ? intOrNull(talkRatio.prospect) : null);
    if (repRatio !== null) update.talk_ratio_rep = repRatio;
    if (prospectRatio !== null) update.talk_ratio_prospect = prospectRatio;

    const qc = intOrNull(partial.question_count);
    if (qc !== null) update.question_count = qc;
    const lm = intOrNull(partial.longest_monologue_sec);
    if (lm !== null) update.longest_monologue_sec = lm;
    const ic = intOrNull(partial.interruption_count);
    if (ic !== null) update.interruption_count = ic;

    const objectionTags = normalizeObjectionTags(partial.objection_tags);
    update.objection_tags = objectionTags;

    const topicTags = normalizeTopicTags(partial.topic_tags);
    if (topicTags.length > 0) update.topic_tags = topicTags;

    update.ai_status = ok ? "complete" : "failed";

    if (call_log_id) {
      await stampStatus(call_log_id, update);
    }

    return NextResponse.json({
      ...partial,
      _parse_ok: ok,
      _parse_reason: reason,
    });
  } catch (err) {
    console.error("[AI] Error:", err);
    await stampStatus(call_log_id, { ai_status: "failed" });
    return NextResponse.json(
      { error: "Failed to analyze call" },
      { status: 500 }
    );
  }
}
