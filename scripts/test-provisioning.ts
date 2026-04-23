/**
 * SIP credential provisioning diagnostic.
 *
 * Exercises every step of the provisioning pipeline in isolation so a
 * failure can be pinned to exactly one of:
 *   1. Env config              — required vars present and well-formed
 *   2. Telnyx create call      — POST /v2/telephony_credentials returns 2xx
 *   3. Password encryption     — AES-256-GCM round-trip
 *   4. Supabase admin read     — service role can SELECT softphone_users
 *
 * DOES NOT modify any softphone_users row. Cleans up its own Telnyx
 * credential on exit. Optional end-to-end mode (--e2e <userId>) calls
 * the real createSipCredentialForUser — only safe if the target row is
 * already provisioned (idempotent branch) or is a throwaway row.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/test-provisioning.ts
 *   npx tsx --env-file=.env.local scripts/test-provisioning.ts --e2e <userId>
 */

/* eslint-disable no-console */

export {};

async function main() {
  const e2eIdx = process.argv.indexOf("--e2e");
  const e2eUserId = e2eIdx >= 0 ? process.argv[e2eIdx + 1] : null;

  let ok = true;
  const step = (name: string, pass: boolean, detail = "") => {
    const mark = pass ? "✓" : "✗";
    console.log(`${mark} ${name}${detail ? " — " + detail : ""}`);
    if (!pass) ok = false;
  };

  // --- 1. Env config -----------------------------------------------------
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TELNYX_API_KEY",
    "TELNYX_CONNECTION_ID",
    "SUPABASE_ENCRYPTION_KEY",
  ];
  const missing = required.filter((k) => !process.env[k]);
  step(
    "env vars present",
    missing.length === 0,
    missing.length ? `missing ${missing.join(", ")}` : "all set"
  );
  if (missing.length) process.exit(1);

  const connectionId = process.env.TELNYX_CONNECTION_ID!;
  step(
    "TELNYX_CONNECTION_ID format",
    /^\d{10,}$/.test(connectionId),
    connectionId
  );

  // --- 2. Telnyx create --------------------------------------------------
  const diagName = `diagnostic-${Date.now().toString(36)}`;
  let credentialId: string | null = null;
  let sipUsername: string | null = null;
  let sipPassword: string | null = null;

  try {
    const res = await fetch(
      "https://api.telnyx.com/v2/telephony_credentials",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.TELNYX_API_KEY!}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ connection_id: connectionId, name: diagName }),
      }
    );
    const bodyText = await res.text();
    if (!res.ok) {
      step("telnyx create credential", false, `HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
    } else {
      const body = JSON.parse(bodyText) as {
        data: { id: string; sip_username: string; sip_password: string };
      };
      credentialId = body.data.id;
      sipUsername = body.data.sip_username;
      sipPassword = body.data.sip_password;
      step(
        "telnyx create credential",
        true,
        `id=${credentialId} username=${sipUsername}`
      );
    }
  } catch (err) {
    step(
      "telnyx create credential",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  // --- 3. Encryption round-trip -----------------------------------------
  try {
    const { encryptPassword, decryptPassword } = await import(
      "../lib/telnyx/provisioning"
    );
    const plain = sipPassword ?? "fake-plain-password-for-round-trip";
    const enc = encryptPassword(plain);
    const dec = decryptPassword(enc);
    step(
      "encrypt/decrypt round-trip",
      dec === plain,
      `format=${enc.split(":")[0]} len=${enc.length}`
    );
  } catch (err) {
    step(
      "encrypt/decrypt round-trip",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  // --- 4. Supabase admin read -------------------------------------------
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { count, error } = await admin
      .from("softphone_users")
      .select("id", { count: "exact", head: true });
    step(
      "supabase admin select softphone_users",
      !error,
      error ? error.message : `rows=${count}`
    );
  } catch (err) {
    step(
      "supabase admin select softphone_users",
      false,
      err instanceof Error ? err.message : String(err)
    );
  }

  // --- 5. Cleanup the diagnostic Telnyx credential ----------------------
  if (credentialId) {
    try {
      const res = await fetch(
        `https://api.telnyx.com/v2/telephony_credentials/${credentialId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY!}` },
        }
      );
      step(
        "telnyx delete diagnostic credential",
        res.ok || res.status === 404,
        `HTTP ${res.status}`
      );
    } catch (err) {
      step(
        "telnyx delete diagnostic credential",
        false,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // --- 6. Optional end-to-end against a real user id --------------------
  if (e2eUserId) {
    console.log("");
    console.log(`E2E mode: calling createSipCredentialForUser(${e2eUserId})`);
    console.log(
      "Safe only if row is already provisioned (idempotent path) or disposable."
    );
    try {
      const { createSipCredentialForUser } = await import(
        "../lib/telnyx/provisioning"
      );
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const { data: row } = await admin
        .from("softphone_users")
        .select("id, email, sip_credential_id, sip_username")
        .eq("id", e2eUserId)
        .maybeSingle();
      if (!row) {
        step("e2e: user exists", false, "row not found");
      } else {
        console.log(
          `  pre-state: sip_credential_id=${row.sip_credential_id} sip_username=${row.sip_username}`
        );
        const result = await createSipCredentialForUser(
          row.id,
          row.email || ""
        );
        step(
          "e2e: createSipCredentialForUser",
          true,
          `username=${result.sipUsername} credentialId=${result.credentialId}`
        );
      }
    } catch (err) {
      step(
        "e2e: createSipCredentialForUser",
        false,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  console.log("");
  console.log(ok ? "ALL CHECKS PASSED" : "ONE OR MORE CHECKS FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
