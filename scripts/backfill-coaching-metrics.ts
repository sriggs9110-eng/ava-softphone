/**
 * One-off backfill for the Reports v1 metrics columns.
 *
 * Finds call_logs rows that have a transcript but are missing the new
 * coaching metrics (talk ratios, question_count, etc.) and re-runs
 * /api/ai/analyze-call against each. Uses the Vercel deployment by default;
 * pass --local to hit http://localhost:3000.
 *
 * Run:
 *   npx tsx scripts/backfill-coaching-metrics.ts                  # hits prod
 *   npx tsx scripts/backfill-coaching-metrics.ts --local          # hits localhost
 *   npx tsx scripts/backfill-coaching-metrics.ts --limit=50
 *   npx tsx scripts/backfill-coaching-metrics.ts --dry-run
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * If hitting a deployed host, set NEXT_PUBLIC_APP_URL too (or pass --base=https://...).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

type CallRow = {
  id: string;
  phone_number: string;
  from_number: string | null;
  direction: string;
  duration_seconds: number;
  status: string;
  created_at: string;
  recording_url: string | null;
  transcript: string | null;
  talk_ratio_rep: number | null;
  question_count: number | null;
};

async function main() {
  const args = process.argv.slice(2);
  const local = args.includes("--local");
  const dry = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const baseArg = args.find((a) => a.startsWith("--base="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const base = baseArg
    ? baseArg.split("=")[1]
    : local
    ? "http://localhost:3000"
    : process.env.NEXT_PUBLIC_APP_URL || "https://ava-softphone.vercel.app";

  console.log(`Backfill target: ${base}${dry ? "  (dry-run)" : ""}`);

  // Find candidates: rows with a transcript but no coaching metrics.
  const selectQS =
    "select=id,phone_number,from_number,direction,duration_seconds,status,created_at,recording_url,transcript,talk_ratio_rep,question_count" +
    "&not.transcript=is.null" +
    "&or=(talk_ratio_rep.is.null,question_count.is.null)" +
    "&order=created_at.desc";

  const qs = limit > 0 ? `${selectQS}&limit=${limit}` : selectQS;
  const listRes = await fetch(`${supabaseUrl}/rest/v1/call_logs?${qs}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });

  if (!listRes.ok) {
    console.error("Supabase list failed:", listRes.status, await listRes.text());
    process.exit(1);
  }

  const rows = (await listRes.json()) as CallRow[];
  console.log(`${rows.length} candidate rows`);

  if (dry) {
    for (const r of rows.slice(0, 10)) {
      console.log(
        ` - ${r.id}  ${r.phone_number}  ${r.direction}  ${r.duration_seconds}s  ${r.created_at}`
      );
    }
    if (rows.length > 10) console.log(`  ... +${rows.length - 10} more`);
    return;
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    process.stdout.write(`[${i + 1}/${rows.length}] ${r.id} ... `);
    try {
      const res = await fetch(`${base}/api/ai/analyze-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recording_url: r.recording_url,
          call_log_id: r.id,
          call_metadata: {
            number: r.phone_number,
            from_number: r.from_number,
            direction: r.direction,
            duration: r.duration_seconds,
            status: r.status,
            timestamp: new Date(r.created_at).getTime(),
            transcript: r.transcript,
          },
        }),
      });
      if (res.ok) {
        console.log("ok");
        ok++;
      } else {
        console.log(`FAIL (${res.status})`);
        fail++;
      }
    } catch (err) {
      console.log(`ERR (${(err as Error).message})`);
      fail++;
    }
    // Be nice to the Anthropic rate limit.
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nDone. ok=${ok} fail=${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
