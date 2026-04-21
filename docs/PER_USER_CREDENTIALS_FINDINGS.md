# Per-user Telnyx SIP credentials — migration findings

Captures what was learned during the architectural migration from a
single shared `TELNYX_SIP_USERNAME` / `TELNYX_SIP_PASSWORD` login to
per-user `telephony_credentials`.

## 1. API endpoint: `/v2/telephony_credentials`

We use `POST /v2/telephony_credentials`, not the older
`/v2/sip_credentials`. Telnyx consolidated per-user WebRTC auth under
`telephony_credentials`, and the response body returns usable
`sip_username` and `sip_password` strings directly — no separate
token-mint step is required.

Request shape:

```json
{
  "connection_id": "<Credentials connection id>",
  "name": "pepper-<email-local>-<uuid-prefix>",
  "tag": "<softphone_users.id>"
}
```

Response includes `id`, `sip_username`, `sip_password`, `resource_id`
(the connection), plus metadata.

The `@telnyx/webrtc` SDK's `TelnyxRTC({ login, password })` accepts the
returned `sip_username` / `sip_password` as-is — we do not need the JWT
`login_token` flow.

Reference: Telnyx "Voice SDK Auth via Telephony Credentials" and
`@telnyx/webrtc` v2.26 README.

## 2. Password encryption

Supabase Vault (`pgsodium` / `supabase_vault`) is installed in this
project, but we chose Node.js AES-256-GCM with a runtime key for
simplicity and direct decryption from the token route handler. Vault
adds a round-trip through Postgres on every token request.

Details:

- Key material: `SUPABASE_ENCRYPTION_KEY` env var, any length, hashed
  with SHA-256 at call time to derive a 32-byte AES key.
- Algorithm: `aes-256-gcm`, 12-byte random IV per password, auth tag
  stored alongside ciphertext.
- Storage format: `v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>` so we
  can rotate algorithms in the future without a data migration.
- Password is decrypted in-memory inside `/api/telnyx/token` and
  returned only to the authenticated owner of that `softphone_users`
  row. Plaintext never hits the client except as the SIP registration
  response.

To move to Vault later: keep the same `v1:` format and introduce `v2:`
that reads a `vault.secrets` row by id; add a rotation script that
rewrites all `sip_password_encrypted` values.

## 3. Phase 8 — inbound ring routing (investigation only)

Question posed: with per-user credentials, when an inbound call hits
one of our Telnyx numbers, does Telnyx fan out the INVITE to every
registered credential, or just one?

**Findings**

All per-user `telephony_credentials` in this project share one
Credentials-type connection (we pass the same `TELNYX_CONNECTION_ID`
when minting each one). Telnyx documentation and release notes confirm:

- Default routing: Telnyx delivers the INVITE to **one** registered
  endpoint. Docs imply "first available" / "most recent register" but
  don't specify tie-breakers rigorously.
- **`simultaneous_ringing` on the connection** is the lever that
  toggles fan-out to every active registration against that
  connection. With it enabled, Telnyx forks the INVITE to all
  registered endpoints simultaneously.

Source: Telnyx "Simultaneous Ring" release notes and "SIP Connection
Inbound & Outbound Settings" support article.

**Implications for our architecture**

Option (a) from the migration spec — "Telnyx auto-fans-out to all
registered users" — only holds when `simultaneous_ringing` is
enabled on the credential connection.

Option (b) — "we need server-side Call Control orchestration to
answer the inbound and dial individual SIP URIs per member" — is
not required as long as `simultaneous_ringing` stays enabled.

**Important**: this partially contradicts the Phase 6 band-aid-revert
premise in the migration spec. The spec said "with per-user credentials
each agent has their OWN connection and simultaneous_ringing is
irrelevant." In practice, per-user *credentials* share one *connection*,
so the connection's `simultaneous_ringing` setting is still the fan-out
toggle.

**Recommendation**: keep `simultaneous_ringing = enabled` on the
credential connection. Do not run
`scripts/revert-credential-simultaneous-ringing.ts` without first
confirming ring-group fan-out continues to work when it's disabled.
The script is written with a prominent warning header reflecting this.

**What `dispatchRingGroup` still does (and should continue to do)**

Even with Telnyx fanning out at the SIP layer, `dispatchRingGroup` is
still valuable:

- It filters to members of *this specific ring group*, not every user
  on the platform. Telnyx's fan-out is per-connection, so without the
  Supabase Realtime side-channel every agent who's logged in would
  hear every ring-group number.
- It carries `group_id`, `group_name`, and `strategy` into the
  client-side UI.
- It enforces ring-timeout fallback (voicemail vs hangup).

No rewrite needed for Phase 8 right now — the architecture is:
- Telnyx SIP layer: delivers INVITEs to all registered endpoints (via
  `simultaneous_ringing`).
- Supabase Realtime: tells the browser which *logical* ring group the
  call belongs to and who else is ringing, so UIs stay consistent.
- Client-side auto-reject: final safety net for DND / on-call / ACW.

## 4. Test cases to run post-deploy

See the migration spec's "Testing plan" section. Nothing unexpected
turned up during the build — all tests should be re-run by Stephen
against the production Telnyx account before declaring the migration
complete.

Failures encountered during implementation: none yet; the provisioning
script was NOT run in this session per instructions.
