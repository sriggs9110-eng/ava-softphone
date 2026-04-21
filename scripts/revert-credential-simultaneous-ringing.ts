/**
 * Revert the `simultaneous_ringing` band-aid on the Credential Connection
 * identified by TELNYX_CONNECTION_ID.
 *
 * Context
 * -------
 * A previous incident flipped this flag to `enabled` on the shared
 * credential connection as a band-aid: it made Telnyx fork inbound
 * INVITEs to every registered endpoint, which partially masked the
 * single-shared-credential race condition.
 *
 * Now that every softphone_users row has its own telephony_credential,
 * Stephen wants the connection-level flag reset to its default so the
 * state is clean.
 *
 * ┌─ Caveat (read before running) ─────────────────────────────────────┐
 * │ Research during this migration found that multiple per-user        │
 * │ telephony_credentials still share ONE Credentials-type connection  │
 * │ (we pass the same TELNYX_CONNECTION_ID for each one). Telnyx's     │
 * │ documented default routes inbound INVITEs to ONE registered        │
 * │ endpoint — not all — unless simultaneous_ringing is enabled on the │
 * │ connection.                                                        │
 * │                                                                    │
 * │ In other words: disabling simultaneous_ringing may re-break ring-  │
 * │ group fan-out even with per-user credentials in place. Confirm by  │
 * │ making a test call to a ring-group number AFTER running this. If   │
 * │ only one agent rings, flip it back to `enabled` and leave it that  │
 * │ way — per-user credentials fix the registration race but not the   │
 * │ connection-level fan-out setting.                                  │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Run:
 *   npx tsx --env-file=.env.local \
 *     scripts/revert-credential-simultaneous-ringing.ts
 *
 * Required env:
 *   TELNYX_API_KEY
 *   TELNYX_CONNECTION_ID
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

async function main() {
  const apiKey = process.env.TELNYX_API_KEY;
  const connectionId = process.env.TELNYX_CONNECTION_ID;
  if (!apiKey || !connectionId) {
    console.error("Missing TELNYX_API_KEY or TELNYX_CONNECTION_ID");
    process.exit(1);
  }

  const endpoint = `https://api.telnyx.com/v2/credential_connections/${connectionId}`;

  // Current state first so the operator sees what we're overwriting.
  const getRes = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!getRes.ok) {
    const err = await getRes.text().catch(() => "");
    console.error(`GET connection failed (${getRes.status}): ${err.slice(0, 400)}`);
    process.exit(1);
  }
  const before = await getRes.json();
  const beforeFlag =
    before?.data?.inbound?.simultaneous_ringing ??
    before?.data?.simultaneous_ringing ??
    "(unknown field path)";
  console.log(`Before: simultaneous_ringing = ${beforeFlag}`);

  const patchRes = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      inbound: {
        simultaneous_ringing: "disabled",
      },
    }),
  });

  if (!patchRes.ok) {
    const err = await patchRes.text().catch(() => "");
    console.error(`PATCH failed (${patchRes.status}): ${err.slice(0, 400)}`);
    process.exit(1);
  }

  const after = await patchRes.json();
  const afterFlag =
    after?.data?.inbound?.simultaneous_ringing ??
    after?.data?.simultaneous_ringing ??
    "(unknown field path)";
  console.log(`After:  simultaneous_ringing = ${afterFlag}`);
  console.log(
    "\nDone. If ring-group fan-out breaks after this, re-enable the flag —" +
      " see the caveat in this script's header."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
