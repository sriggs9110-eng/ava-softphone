/**
 * Creates the voicemail-greetings Supabase Storage bucket (public read).
 * Idempotent — safe to run multiple times.
 *
 * Run: npx tsx --env-file=.env.local scripts/setup-voicemail-bucket.ts
 */

export {};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await admin.storage.getBucket("voicemail-greetings");
  if (existing) {
    console.log("Bucket 'voicemail-greetings' already exists — nothing to do.");
    return;
  }

  const { data, error } = await admin.storage.createBucket(
    "voicemail-greetings",
    {
      public: true,
      fileSizeLimit: 2 * 1024 * 1024, // 2 MB — matches UI cap
      allowedMimeTypes: [
        "audio/mpeg",
        "audio/mp3",
        "audio/wav",
        "audio/x-wav",
        "audio/mp4",
        "audio/m4a",
        "audio/x-m4a",
        "audio/webm",
      ],
    }
  );

  if (error) {
    console.error("createBucket failed:", error.message);
    process.exit(1);
  }
  console.log("Created bucket:", data?.name);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
