import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function refreshRecordingUrl(recordingId: string): Promise<string | null> {
  const key = process.env.TELNYX_API_KEY;
  if (!key) return null;
  const r = await fetch(
    `https://api.telnyx.com/v2/recordings/${encodeURIComponent(recordingId)}`,
    { headers: { Authorization: `Bearer ${key}` } }
  );
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    console.error(
      `[transcribe-voicemail] recording refresh ${r.status}: ${err.slice(0, 300)}`
    );
    return null;
  }
  const body = (await r.json()) as {
    data?: { recording_urls?: { mp3?: string; wav?: string } };
  };
  return body.data?.recording_urls?.mp3 || body.data?.recording_urls?.wav || null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const voicemailId = body?.voicemail_id as string | undefined;
  if (!voicemailId) {
    return NextResponse.json(
      { error: "voicemail_id required" },
      { status: 400 }
    );
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const admin = createAdminClient();

  const { data: vm, error } = await admin
    .from("voicemails")
    .select("id, recording_url, recording_telnyx_id, transcript, transcript_status")
    .eq("id", voicemailId)
    .single();
  if (error || !vm) {
    return NextResponse.json({ error: "voicemail not found" }, { status: 404 });
  }
  if (!vm.recording_url) {
    return NextResponse.json(
      { error: "voicemail has no recording_url" },
      { status: 400 }
    );
  }

  if (!openaiKey) {
    console.warn(
      "[transcribe-voicemail] OPENAI_API_KEY missing — marking none"
    );
    await admin
      .from("voicemails")
      .update({ transcript_status: "none" })
      .eq("id", voicemailId);
    return NextResponse.json({ ok: false, reason: "openai_not_configured" });
  }

  await admin
    .from("voicemails")
    .update({ transcript_status: "processing" })
    .eq("id", voicemailId);

  // Refresh URL if we have the recording id (S3 presigned URLs expire after
  // 10 min — same pattern as call recordings).
  let url = vm.recording_url;
  if (vm.recording_telnyx_id) {
    const fresh = await refreshRecordingUrl(vm.recording_telnyx_id);
    if (fresh) {
      url = fresh;
      console.log(
        `[transcribe-voicemail] refreshed URL for id=${vm.recording_telnyx_id}`
      );
    } else {
      console.warn(
        `[transcribe-voicemail] refresh failed for id=${vm.recording_telnyx_id}; using stored URL`
      );
    }
  }

  try {
    console.log(`[transcribe-voicemail] downloading ${url.slice(0, 100)}…`);
    const audioRes = await fetch(url);
    if (!audioRes.ok) {
      const err = await audioRes.text().catch(() => "");
      throw new Error(
        `recording download ${audioRes.status}: ${err.slice(0, 300)}`
      );
    }
    const audioBlob = await audioRes.blob();
    if (audioBlob.size === 0) {
      throw new Error("downloaded recording is 0 bytes");
    }

    const form = new FormData();
    form.append("file", audioBlob, "voicemail.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "text");

    const whisperRes = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: form,
      }
    );
    if (!whisperRes.ok) {
      const err = await whisperRes.text().catch(() => "");
      throw new Error(`whisper ${whisperRes.status}: ${err.slice(0, 300)}`);
    }
    const transcript = (await whisperRes.text()).trim();
    console.log(
      `[transcribe-voicemail] transcript length ${transcript.length}`
    );

    await admin
      .from("voicemails")
      .update({
        transcript,
        transcript_status: transcript.length > 0 ? "complete" : "none",
      })
      .eq("id", voicemailId);

    return NextResponse.json({ ok: true, length: transcript.length });
  } catch (err) {
    console.error("[transcribe-voicemail] failed:", err);
    await admin
      .from("voicemails")
      .update({ transcript_status: "failed" })
      .eq("id", voicemailId);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
