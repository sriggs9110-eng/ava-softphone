import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    console.log("[AI] Sending to Whisper...");
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
    // No recording at all — nothing to transcribe.
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

  const systemPrompt = hasRealContent
    ? `You are a sales call analyst for Ava Residential, a B2B inside sales team at an ISP reseller. Analyze this call transcript and return a JSON object with:
- summary: 3-4 sentence summary of the call based on the actual conversation
- score: 1-10 rating based on qualifying questions, objection handling, next steps set, professionalism
- score_reasoning: why you gave this score, referencing specific parts of the conversation
- talk_ratio: { agent: percentage as number, prospect: percentage as number } (must sum to 100)
- key_topics: array of 3-5 topic strings actually discussed
- sentiment: "positive" | "negative" | "neutral"
- coaching: array of 2-3 specific actionable suggestions referencing what was said
- highlights: array of notable quotes from the call (good or bad)
Return ONLY valid JSON, no other text.`
    : `You are a sales call analyst for Ava Residential, a B2B inside sales team at an ISP reseller. You're analyzing a call based on metadata only — no transcript is available.

${hasRecording ? "A recording exists but could not be transcribed. The call data (duration, status) is real — do NOT treat this as speculative." : "Begin the summary with \"⚡ Estimated from call metadata — \" to clearly indicate this is not based on actual conversation content."}

Return a JSON object with:
- summary: ${hasRecording ? "2-3 sentences about the call based on its duration and direction." : "Start with \"⚡ Estimated from call metadata — \" then describe what the duration suggests."}
- score: 1-10 rating. Short calls (<30s): 1-3. Medium (30s-2min): 4-6. Longer (2min+): 6-8. Very long (5min+): 7-9.
- score_reasoning: scoring logic based on duration and direction
- talk_ratio: { agent: percentage as number, prospect: percentage as number } (sum to 100)
- key_topics: array of 2-3 likely topics for an ISP sales call
- sentiment: "positive" | "negative" | "neutral"
- coaching: array of 2-3 coaching tips
- highlights: empty array
Return ONLY valid JSON, no other text.`;

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
        max_tokens: 1024,
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
      const errData = await claudeRes.json();
      console.error("[AI] Claude error:", errData);
      await stampStatus(call_log_id, { ai_status: "failed" });
      return NextResponse.json(
        { error: errData.error?.message || "Claude API request failed" },
        { status: claudeRes.status }
      );
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text || "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[AI] Failed to parse:", content);
      await stampStatus(call_log_id, { ai_status: "failed" });
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    const analysis = JSON.parse(jsonMatch[0]);

    // Persist AI fields server-side. Previously only the client saved these
    // via CallHistoryPage.handleAnalyze — now the webhook auto-trigger needs
    // the endpoint itself to be authoritative.
    if (call_log_id) {
      await stampStatus(call_log_id, {
        ai_analysis: analysis,
        ai_summary: analysis.summary,
        ai_score: analysis.score,
        ai_status: "complete",
      });
    }

    return NextResponse.json(analysis);
  } catch (err) {
    console.error("[AI] Error:", err);
    await stampStatus(call_log_id, { ai_status: "failed" });
    return NextResponse.json(
      { error: "Failed to analyze call" },
      { status: 500 }
    );
  }
}
