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

async function transcribeWithWhisper(
  recordingUrl: string
): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.log("[AI] No OPENAI_API_KEY — skipping transcription");
    return null;
  }

  try {
    console.log("[AI] Downloading recording:", recordingUrl);
    const audioRes = await fetch(recordingUrl);
    if (!audioRes.ok) {
      console.error("[AI] Failed to download recording:", audioRes.status);
      return null;
    }

    const audioBlob = await audioRes.blob();
    console.log("[AI] Downloaded audio:", audioBlob.size, "bytes", audioBlob.type);

    const formData = new FormData();
    formData.append("file", audioBlob, "recording.mp3");
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");

    const whisperRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: formData,
      }
    );

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error("[AI] Whisper error:", whisperRes.status, errText);
      return null;
    }

    const transcript = await whisperRes.text();
    console.log("[AI] Whisper transcript length:", transcript.length);
    return transcript.trim();
  } catch (err) {
    console.error("[AI] Transcription error:", err);
    return null;
  }
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
  const { recording_url, call_metadata, call_log_id } = body;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    await stampStatus(call_log_id, { ai_status: "failed" });
    return NextResponse.json(
      { error: "Anthropic API key not configured" },
      { status: 500 }
    );
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
    await stampStatus(call_log_id, { transcript_status: "processing" });
    transcript = await transcribeWithWhisper(recording_url);

    if (transcript && call_log_id) {
      await stampStatus(call_log_id, {
        transcript,
        transcript_status: "complete",
      });
      console.log("[AI] Saved transcript to call_logs");
    } else if (!transcript && call_log_id) {
      await stampStatus(call_log_id, { transcript_status: "failed" });
    }
  } else if (!hasRecording && call_log_id && !transcript) {
    await stampStatus(call_log_id, { transcript_status: "none" });
  } else if (transcript && call_log_id) {
    await stampStatus(call_log_id, { transcript_status: "complete" });
  }

  const hasTranscript = !!transcript;

  let analysisContext: string;
  if (hasTranscript) {
    analysisContext = `Full transcript of the conversation:\n${transcript}`;
  } else if (hasRecording) {
    analysisContext = `A recording exists but transcription was not available. The call lasted ${duration} seconds. Analyze based on call metadata — duration and direction confirm a real conversation. Do NOT label this as "estimated."`;
  } else {
    analysisContext = `No transcript or recording available. Analyze based on the call metadata only. Begin the summary with "⚡ Estimated — " to indicate this is metadata-only.`;
  }

  const hasRealContent = hasTranscript;

  const taxonomy = OBJECTION_TAXONOMY.join('", "');

  const systemPrompt = hasRealContent
    ? `You are a sales call analyst for Ava Residential, a B2B inside sales team at an ISP reseller. Analyze this transcript and return ONLY a valid JSON object with:
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
Return ONLY JSON, no prose before or after.`
    : `You are a sales call analyst for Ava Residential. You have only call metadata — no transcript. Return ONLY JSON:
${hasRecording ? "" : '- summary: starts with "⚡ Estimated from call metadata — " then describes what the duration suggests'}
${hasRecording ? '- summary: 2-3 sentences based on duration and direction. The call data is real — do NOT treat as speculative.' : ""}
- score: int 1-10 using length-based bands (short<30s: 1-3, 30s-2m: 4-6, 2-5m: 6-8, 5m+: 7-9)
- score_reasoning: explain with duration and direction
- talk_ratio: { agent: int, prospect: int } summing to 100
- key_topics: array of 2-3 likely topics for an ISP sales call
- sentiment: "positive" | "negative" | "neutral"
- coaching: array of 2-3 tips
- highlights: []
- talk_ratio_rep: same as talk_ratio.agent
- talk_ratio_prospect: same as talk_ratio.prospect
- question_count: best guess or 0
- longest_monologue_sec: best guess or 0
- interruption_count: 0
- objection_tags: []
- topic_tags: 2-3 lowercase likely-topic strings
Return ONLY JSON.`;

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
