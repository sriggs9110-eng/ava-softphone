/**
 * One-off: refresh the signed mp3 URLs on David's 3 recovered call_logs
 * rows. Telnyx signs recording URLs with ~10-minute expiry, so the ones
 * stored on 2026-04-22 are long expired. Re-fetch the recording via
 * GET /v2/recordings/{id} and UPDATE the row.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/refresh-david-recording-urls.ts
 *
 * Safe to re-run — only touches the three hardcoded row ids.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

const TARGETS = [
  {
    row_id: "4c99305c-0f7c-4c50-a72c-7c37566d5da0",
    recording_id: "c681c8af-a695-4777-90a8-1843b92a7de8",
    label: "Atlanta 32.1min",
  },
  {
    row_id: "cd34ffcd-c63e-4b79-bf81-0767eea576cb",
    recording_id: "b03d2ec6-c4e8-4471-aa19-dcd508bc1679",
    label: "Orlando 15.4min",
  },
  {
    row_id: "06938173-7623-4a7b-b02b-e940079462e5",
    recording_id: "c7643bbd-a09b-4503-86ef-4dedf947cabb",
    label: "St. Louis 36s",
  },
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const apiKey = requireEnv("TELNYX_API_KEY");
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const srk = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, srk, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const t of TARGETS) {
    console.log(`\n--- ${t.label} row=${t.row_id} rec=${t.recording_id}`);
    const res = await fetch(
      `https://api.telnyx.com/v2/recordings/${t.recording_id}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      }
    );
    if (!res.ok) {
      console.error(`  Telnyx GET failed HTTP ${res.status}`);
      continue;
    }
    const body: any = await res.json();
    const dl = body?.data?.download_urls || {};
    const freshUrl: string | undefined = dl.mp3 || dl.wav;
    if (!freshUrl) {
      console.error(`  no download_urls.mp3/wav in response`);
      continue;
    }
    console.log(`  fresh signed URL (first 100 chars): ${freshUrl.slice(0, 100)}…`);

    const { error } = await admin
      .from("call_logs")
      .update({ recording_url: freshUrl })
      .eq("id", t.row_id);
    if (error) {
      console.error(`  Supabase UPDATE failed: ${error.message}`);
    } else {
      console.log(`  UPDATE ok`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
