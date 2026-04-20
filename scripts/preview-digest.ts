/**
 * Renders the weekly digest to /tmp/pepper-digest.html using live data from
 * the softphone Supabase. No email is actually sent.
 *
 * Run: npx tsx scripts/preview-digest.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

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

  const { buildDigestData } = await import("../lib/reports/digest-data");
  const { renderDigestHtml, digestSubject } = await import(
    "../lib/reports/digest-email"
  );

  const data = await buildDigestData(admin as any);
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://ava-softphone.vercel.app";
  const html = renderDigestHtml(data, appUrl);

  const { writeFileSync } = await import("fs");
  const out = "/tmp/pepper-digest.html";
  writeFileSync(out, html, "utf8");
  console.log(`Subject: ${digestSubject(data)}`);
  console.log(`Saved to: ${out}`);
  console.log(`Picks: ${data.picks.length}`);
  console.log(`Headline: ${JSON.stringify(data.headline)}`);
  console.log(`Top performer:`, data.top_performer);
  console.log(`Coaching opp:`, data.coaching_opportunity);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
