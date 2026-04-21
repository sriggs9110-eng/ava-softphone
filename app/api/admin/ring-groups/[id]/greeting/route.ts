import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "voicemail-greetings";
const MAX_BYTES = 2 * 1024 * 1024;
const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
};

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const { data } = await supabase
    .from("softphone_users")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!data || data.role !== "admin") {
    return { error: "Forbidden", status: 403 as const };
  }
  return { user };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${file.size} bytes, max ${MAX_BYTES})` },
      { status: 413 }
    );
  }
  const ext = EXT_BY_MIME[file.type] || "webm";
  if (!EXT_BY_MIME[file.type]) {
    console.warn(
      `[greeting] unknown mime ${file.type} — defaulting extension to webm`
    );
  }

  const admin = createAdminClient();
  const path = `${id}/greeting.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadErr } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type || "audio/webm",
      upsert: true,
      cacheControl: "0",
    });
  if (uploadErr) {
    console.error("[greeting] upload failed:", uploadErr);
    return NextResponse.json(
      { error: uploadErr.message },
      { status: 500 }
    );
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  // Add a cache-buster so replaced greetings play the fresh file in browsers
  // that aggressively cache the previous version.
  const urlWithBust = `${pub.publicUrl}?v=${Date.now()}`;
  const filename = (file as File & { name?: string }).name || `greeting.${ext}`;

  const { error: updateErr } = await admin
    .from("ring_groups")
    .update({
      voicemail_greeting_url: urlWithBust,
      voicemail_greeting_filename: filename,
    })
    .eq("id", id);
  if (updateErr) {
    return NextResponse.json(
      { error: updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    url: urlWithBust,
    filename,
  });
}

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if ("error" in gate)
    return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { id } = await context.params;
  const admin = createAdminClient();

  // We don't know the exact extension on record — try each.
  for (const ext of ["mp3", "wav", "m4a", "webm"]) {
    await admin.storage.from(BUCKET).remove([`${id}/greeting.${ext}`]);
  }
  await admin
    .from("ring_groups")
    .update({
      voicemail_greeting_url: null,
      voicemail_greeting_filename: null,
    })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
