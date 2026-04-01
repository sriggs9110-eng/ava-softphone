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

  try {
    // Step 1: For now, use a simulated transcript if no recording URL
    // In production: download recording -> transcribe with Whisper/Telnyx STT
    let transcript = "";

    if (recording_url) {
      // Placeholder: In production, download and transcribe the recording
      transcript = `[Recording from ${call_metadata?.number || "unknown"} - ${call_metadata?.duration || 0}s call. Transcription would be generated from the recording URL.]`;
    } else {
      transcript =
        call_metadata?.transcript ||
        "No transcript available for this call.";
    }

    // Step 2: Send to Claude for analysis
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
        system: `You are a sales call analyst for a B2B inside sales team at an ISP reseller called Ava Residential. Analyze this call transcript and return a JSON object with:
- summary: 3-4 sentence summary of the call
- score: 1-10 rating based on qualifying questions, objection handling, next steps set, professionalism
- score_reasoning: why you gave this score
- talk_ratio: { agent: percentage as number, prospect: percentage as number } (must sum to 100)
- key_topics: array of 3-5 topic strings discussed
- sentiment: "positive" | "negative" | "neutral"
- coaching: array of 2-3 specific actionable suggestions for the agent
- highlights: array of notable quotes from the call (good or bad)
Return ONLY valid JSON, no other text.`,
        messages: [
          {
            role: "user",
            content: `Analyze this sales call:\n\nCall metadata:\n- Number: ${call_metadata?.number || "Unknown"}\n- Direction: ${call_metadata?.direction || "Unknown"}\n- Duration: ${call_metadata?.duration || 0} seconds\n\nTranscript:\n${transcript}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errData = await claudeRes.json();
      return NextResponse.json(
        {
          error:
            errData.error?.message || "Claude API request failed",
        },
        { status: claudeRes.status }
      );
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text || "";

    // Parse the JSON response
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
