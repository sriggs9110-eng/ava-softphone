/**
 * One-time Telnyx-side config: enable SIP URI calling on the credential
 * connection so `POST /v2/calls { to: "sip:<username>@sip.telnyx.com" }`
 * actually routes to the registered WebRTC endpoint instead of getting
 * instant-404'd.
 *
 * Symptom this fixes: inbound webhook dispatches fan-out via
 * POST /v2/calls targeting sip:<agent>@sip.telnyx.com. Telnyx emits
 * call.initiated immediately followed by call.hangup — no bridge, no
 * browser ring. Cause is the default `sip_uri_calling_preference: null`
 * on the credential connection; Telnyx rejects SIP URI dials to
 * registered endpoints until the preference is flipped to `internal`
 * or `unrestricted`.
 *
 * We pick `unrestricted` because the outbound `POST /v2/calls` is
 * already scoped by our Call Control App, which only our server
 * authenticates against.
 *
 * Run:
 *   npx tsx --env-file=.env.local \
 *     scripts/enable-sip-uri-calling.ts
 *
 * Required env:
 *   TELNYX_API_KEY
 *   TELNYX_CONNECTION_ID   (credential connection that owns the per-user credentials)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export {};

async function main() {
  const apiKey = process.env.TELNYX_API_KEY;
  const connId = process.env.TELNYX_CONNECTION_ID;
  if (!apiKey) {
    console.error("Missing TELNYX_API_KEY");
    process.exit(1);
  }
  if (!connId) {
    console.error("Missing TELNYX_CONNECTION_ID");
    process.exit(1);
  }

  const url = `https://api.telnyx.com/v2/credential_connections/${connId}`;

  const getRes = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  if (!getRes.ok) {
    console.error(`GET failed HTTP ${getRes.status}`);
    console.error(await getRes.text());
    process.exit(1);
  }
  const before = await getRes.json();
  console.log(
    `Before: sip_uri_calling_preference = ${JSON.stringify(
      before?.data?.sip_uri_calling_preference
    )}`
  );

  const patchRes = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sip_uri_calling_preference: "unrestricted" }),
  });

  if (!patchRes.ok) {
    console.error(`PATCH failed HTTP ${patchRes.status}`);
    console.error(await patchRes.text());
    process.exit(1);
  }

  const after = await patchRes.json();
  console.log(
    `After:  sip_uri_calling_preference = ${JSON.stringify(
      after?.data?.sip_uri_calling_preference
    )}`
  );
  console.log("\n✓ Credential connection now accepts SIP URI dials.");
  console.log("  Test an inbound call to confirm browser rings.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
