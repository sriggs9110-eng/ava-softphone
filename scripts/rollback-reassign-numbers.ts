/**
 * ROLLBACK of scripts/reassign-numbers-to-call-control.ts.
 *
 * Moves every phone number currently on TELNYX_CALL_CONTROL_APP_ID back
 * to TELNYX_CONNECTION_ID (the credential SIP connection). Use if the
 * reassignment breaks something in prod and Stephen needs the previous
 * routing back in under 30 seconds.
 *
 * Safe to re-run: skips numbers already on the source connection,
 * skips numbers on any other connection (leaves them alone).
 *
 * Run manually:
 *   npx tsx --env-file=.env.local \
 *     scripts/rollback-reassign-numbers.ts
 *
 * Required env:
 *   TELNYX_API_KEY
 *   TELNYX_CONNECTION_ID          (target — credential connection)
 *   TELNYX_CALL_CONTROL_APP_ID    (source — Call Control App)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

const TELNYX_API = "https://api.telnyx.com/v2";

async function main() {
  const apiKey = process.env.TELNYX_API_KEY;
  const targetId = process.env.TELNYX_CONNECTION_ID;
  const sourceId = process.env.TELNYX_CALL_CONTROL_APP_ID;

  if (!apiKey) {
    console.error("Missing TELNYX_API_KEY");
    process.exit(1);
  }
  if (!targetId) {
    console.error("Missing TELNYX_CONNECTION_ID (rollback target)");
    process.exit(1);
  }
  if (!sourceId) {
    console.error("Missing TELNYX_CALL_CONTROL_APP_ID (rollback source)");
    process.exit(1);
  }

  console.log(
    `ROLLBACK: source=${sourceId} (call control app) → target=${targetId} (credential connection)`
  );

  const numbers = await fetchAllPhoneNumbers(apiKey);
  console.log(`Fetched ${numbers.length} numbers`);

  let moved = 0;
  let skippedAlreadyTarget = 0;
  let skippedOtherConnection = 0;
  let skippedUnassigned = 0;
  const failures: Array<{ phone: string; error: string }> = [];

  for (const n of numbers) {
    const phone = n.phone_number as string;
    const id = n.id as string;
    const currentConn = (n.connection_id as string | null) || null;

    if (!currentConn) {
      console.log(`- ${phone} (id=${id}) skipped — unassigned`);
      skippedUnassigned += 1;
      continue;
    }
    if (currentConn === targetId) {
      console.log(`- ${phone} (id=${id}) skipped — already on target`);
      skippedAlreadyTarget += 1;
      continue;
    }
    if (currentConn !== sourceId) {
      console.log(
        `- ${phone} (id=${id}) skipped — on another connection ${currentConn}, not source`
      );
      skippedOtherConnection += 1;
      continue;
    }

    console.log(
      `→ ${phone} (id=${id}) PATCH connection_id ${currentConn} → ${targetId}`
    );
    const patchRes = await fetch(`${TELNYX_API}/phone_numbers/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ connection_id: targetId }),
    });
    const patchText = await patchRes.text();
    let patchBody: any;
    try {
      patchBody = JSON.parse(patchText);
    } catch {
      patchBody = patchText;
    }

    if (!patchRes.ok) {
      const detail =
        patchBody?.errors?.[0]?.detail ||
        patchBody?.errors?.[0]?.title ||
        JSON.stringify(patchBody);
      console.error(`   ✗ HTTP ${patchRes.status} — ${detail}`);
      failures.push({ phone, error: `HTTP ${patchRes.status}: ${detail}` });
      continue;
    }

    const newConn =
      (patchBody?.data?.connection_id as string | undefined) || "(unknown)";
    console.log(`   ✓ now on connection ${newConn}`);
    moved += 1;
  }

  console.log("\n" + "=".repeat(72));
  console.log("Rollback summary");
  console.log("=".repeat(72));
  console.log(`Moved back:                      ${moved}`);
  console.log(`Skipped (already on target):     ${skippedAlreadyTarget}`);
  console.log(`Skipped (on another connection): ${skippedOtherConnection}`);
  console.log(`Skipped (unassigned):            ${skippedUnassigned}`);
  console.log(`Failed:                          ${failures.length}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  - ${f.phone}: ${f.error}`);
    }
    process.exit(2);
  }
}

async function fetchAllPhoneNumbers(apiKey: string): Promise<any[]> {
  const results: any[] = [];
  let page = 1;
  const pageSize = 250;
  while (true) {
    const res = await fetch(
      `${TELNYX_API}/phone_numbers?page[number]=${page}&page[size]=${pageSize}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      }
    );
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        `phone_numbers page=${page} HTTP ${res.status}: ${JSON.stringify(body)}`
      );
    }
    const data = (body.data || []) as any[];
    results.push(...data);
    const meta = body.meta || {};
    const totalPages = meta.total_pages || 1;
    if (page >= totalPages) break;
    page += 1;
  }
  return results;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
