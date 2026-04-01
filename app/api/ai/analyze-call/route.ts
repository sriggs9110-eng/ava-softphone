import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { recording_url, call_metadata } = body;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    return NextResponse.json(
      { error: "Anthropic API key not configured" },
      { status: 500 }
    );
  }

  const hasRecording = !!recording_url;
  const hasTranscript = !!call_metadata?.transcript;
  const duration = call_metadata?.duration || 0;
  const direction = call_metadata?.direction || "unknown";
  const number = call_metadata?.number || "Unknown";

  // Build context for Claude based on what data we have
  let analysisContext: string;

  if (hasTranscript) {
    analysisContext = `Full transcript:\n${call_metadata.transcript}`;
  } else if (hasRecording) {
    analysisContext = `Recording available at: ${recording_url}\n(Transcription not yet available — analyze based on metadata below)`;
  } else {
    analysisContext = `No transcript or recording available. Analyze based on the call metadata only.`;
  }

  // Adjust system prompt based on available data
  const systemPrompt = hasTranscript
    ? `You are a sales call analyst for Ava Residential, a B2B inside sales team at an ISP reseller. Analyze this call transcript and return a JSON object with:
- summary: 3-4 sentence summary of the call
- score: 1-10 rating based on qualifying questions, objection handling, next steps set, professionalism
- score_reasoning: why you gave this score
- talk_ratio: { agent: percentage as number, prospect: percentage as number } (must sum to 100)
- key_topics: array of 3-5 topic strings discussed
- sentiment: "positive" | "negative" | "neutral"
- coaching: array of 2-3 specific actionable suggestions for the agent
- highlights: array of notable quotes from the call (good or bad)
Return ONLY valid JSON, no other text.`
    : `You are a sales call analyst for Ava Residential, a B2B inside sales team at an ISP reseller. You're analyzing a call based on metadata only (no transcript available yet). Based on the call duration, direction, and patterns, generate a realistic preliminary analysis. Return a JSON object with:
- summary: 2-3 sentence summary based on what we know (duration, direction, outcome). Be specific about what the call duration suggests.
- score: 1-10 preliminary rating. Short calls (<30s) suggest no-answer or quick rejection (1-3). Medium calls (30s-2min) suggest brief conversation (4-6). Longer calls (2min+) suggest engagement (6-8). Very long calls (5min+) suggest deep engagement (7-9).
- score_reasoning: explain your scoring logic based on duration and direction
- talk_ratio: { agent: percentage as number, prospect: percentage as number } (must sum to 100). Estimate based on duration — shorter calls are usually more agent-heavy.
- key_topics: array of 2-3 likely topics based on an ISP sales call (e.g. "internet service", "pricing", "availability", "installation")
- sentiment: "positive" | "negative" | "neutral" — estimate based on duration (longer = more likely positive)
- coaching: array of 2-3 general coaching tips relevant to ISP sales calls
- highlights: empty array (no transcript to quote from)
Return ONLY valid JSON, no other text.`;

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
      return NextResponse.json(
        { error: errData.error?.message || "Claude API request failed" },
        { status: claudeRes.status }
      );
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text || "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    const analysis = JSON.parse(jsonMatch[0]);
    return NextResponse.json(analysis);
  } catch (err) {
    console.error("AI analysis error:", err);
    return NextResponse.json(
      { error: "Failed to analyze call" },
      { status: 500 }
    );
  }
}
