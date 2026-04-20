/**
 * Manual test for getLocalNumber's area-code matching.
 *
 * Run:
 *   npx tsx scripts/test-local-presence.ts
 *
 * Stubs the client-path fetch so we don't need a live Supabase connection.
 * Exercises the same code path used by the WebRTC client during a dial.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

// Force the "client" branch of fetchPool() so we can intercept /api/phone-pool.
(globalThis as any).window = {};

// Mirrors the user's reported pool.
const MOCK_POOL = [
  { id: "1", phone_number: "+14694590748", area_code: "469", is_active: true },
  { id: "2", phone_number: "+17044714246", area_code: "704", is_active: true },
  { id: "3", phone_number: "+16783902181", area_code: "678", is_active: true },
  { id: "4", phone_number: "+12514189329", area_code: "251", is_active: true },
];

const originalFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
  if (typeof url === "string" && url.includes("/api/phone-pool")) {
    return new Response(JSON.stringify(MOCK_POOL), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return originalFetch(url, init);
};

// Default fallback env — matches the user's deployed value.
process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER ||= "+14694590748";

type Case = { input: string; expected: string; note: string };

const FALLBACK = process.env.NEXT_PUBLIC_TELNYX_PHONE_NUMBER!;

const cases: Case[] = [
  { input: "+12519675309", expected: "+12514189329", note: "E.164 251 — should pick Mobile, AL" },
  { input: "12519675309",  expected: "+12514189329", note: "11-digit no-plus — still 251" },
  { input: "2519675309",   expected: "+12514189329", note: "10-digit — still 251" },
  { input: "+14695551212", expected: "+14694590748", note: "E.164 469 — Dallas" },
  { input: "+19165551212", expected: FALLBACK,       note: "916 not in pool — default fallback" },
];

async function main() {
  const { getLocalNumber, invalidatePoolCache } = await import(
    "../app/lib/local-presence"
  );

  let failed = 0;
  for (const c of cases) {
    invalidatePoolCache(); // each case starts cold so misses aren't masked
    const got = await getLocalNumber(c.input);
    const pass = got === c.expected;
    if (!pass) failed++;
    const mark = pass ? "\u001b[32m✓\u001b[0m" : "\u001b[31m✗\u001b[0m";
    console.log(
      `${mark} getLocalNumber(${JSON.stringify(c.input).padEnd(16)}) → ${got.padEnd(15)}  expected ${c.expected}  — ${c.note}`
    );
  }
  console.log(
    `\n${failed === 0 ? "\u001b[32mAll passed\u001b[0m" : `\u001b[31m${failed} failed\u001b[0m`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
