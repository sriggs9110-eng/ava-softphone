/**
 * One-time backfill: create a Telnyx telephony_credential for every
 * softphone_users row that doesn't already have one.
 *
 * Safe to re-run — skips users who already have sip_credential_id set.
 * Continues on individual failures so a single bad user doesn't abort
 * the whole batch.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/provision-sip-credentials.ts
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   TELNYX_API_KEY
 *   TELNYX_CONNECTION_ID
 *   SUPABASE_ENCRYPTION_KEY  (any length, hashed to 32 bytes at runtime)
 *
 * Do NOT run this automatically from CI. Stephen runs it manually once
 * he's reviewed the migration + deploy.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }
  for (const envName of [
    "TELNYX_API_KEY",
    "TELNYX_CONNECTION_ID",
    "SUPABASE_ENCRYPTION_KEY",
  ]) {
    if (!process.env[envName]) {
      console.error(`Missing ${envName}`);
      process.exit(1);
    }
  }

  const { createClient } = await import("@supabase/supabase-js");
  const { createSipCredentialForUser } = await import(
    "../lib/telnyx/provisioning"
  );

  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: users, error } = await admin
    .from("softphone_users")
    .select("id, email, full_name, sip_credential_id")
    .is("sip_credential_id", null);

  if (error) {
    console.error("Failed to list softphone_users:", error.message);
    process.exit(1);
  }

  const rows = (users || []) as Array<{
    id: string;
    email: string | null;
    full_name: string | null;
    sip_credential_id: string | null;
  }>;

  const total = rows.length;
  console.log(`Found ${total} users without SIP credentials.`);

  let provisioned = 0;
  const failures: Array<{ id: string; email: string | null; error: string }> =
    [];

  for (const [i, u] of rows.entries()) {
    const tag = `[${i + 1}/${total}] ${u.email || u.id}`;
    try {
      const result = await createSipCredentialForUser(u.id, u.email || "");
      provisioned += 1;
      console.log(
        `${tag} ✓ provisioned — username=${result.sipUsername} credentialId=${result.credentialId}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ id: u.id, email: u.email, error: msg });
      console.error(`${tag} ✗ failed — ${msg}`);
    }
  }

  console.log("");
  console.log(
    `Done. Provisioned ${provisioned} of ${total}; ${failures.length} failed.`
  );
  if (failures.length > 0) {
    console.log("");
    console.log("Failures:");
    for (const f of failures) {
      console.log(`  - ${f.email || f.id}: ${f.error}`);
    }
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
