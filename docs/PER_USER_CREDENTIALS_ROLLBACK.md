# Per-user Telnyx SIP credentials — rollback plan

Emergency rollback procedure for the architectural migration that
replaced the shared `TELNYX_SIP_USERNAME` / `TELNYX_SIP_PASSWORD` login
with per-user Telnyx `telephony_credentials`.

The migration is intentionally additive. If production starts misbehaving
after deploy, you can restore the old shared-credential behavior without
touching the database or Telnyx-side state.

## Fast rollback (single commit revert)

1. The shared credential env vars are still set in Vercel:
   - `TELNYX_SIP_USERNAME`
   - `TELNYX_SIP_PASSWORD`

   **Do not remove them.** They are the rollback lever.

2. Revert `app/api/telnyx/token/route.ts` to the pre-migration version
   (single `GET` that returns the two env vars). The file is small; the
   easiest path is `git revert` of the feature commit for that file
   specifically, or paste in:

   ```ts
   import { NextResponse } from "next/server";

   export async function GET() {
     const username = process.env.TELNYX_SIP_USERNAME;
     const password = process.env.TELNYX_SIP_PASSWORD;
     if (!username || !password) {
       return NextResponse.json(
         { error: "SIP credentials not configured" },
         { status: 500 }
       );
     }
     return NextResponse.json({ username, password });
   }
   ```

3. Deploy. Every browser on next refresh goes back to registering as the
   shared credential. Race conditions return — but the app works.

4. Leave the `softphone_users.sip_*` columns alone. They are nullable
   and nothing else reads them after the revert.

5. If you reverted the admin user-create flow too, re-check that
   `/api/admin/users` POST does not call `createSipCredentialForUser` —
   rollback should also disable that call-site, otherwise new users
   will still get Telnyx credentials provisioned (harmless but
   inconsistent).

## Slower rollback (partial)

If the failure mode is specific to one user (decryption error, bad
credential), you can rotate that single user:

```bash
# Force re-provision via the admin UI: click "Retry" / "Provision now"
# on the Users table, which hits /api/admin/users/provision-sip.
#
# Or from a node shell with the server env loaded:
#
#   await rotateSipCredentialForUser(userId)
```

No full rollback required.

## What's safe to leave behind

After either rollback:

- Telnyx `telephony_credentials` that were created stay in Telnyx. They
  don't register if no browser uses them; they don't affect billing
  meaningfully. Delete later with the admin DELETE flow or by calling
  `DELETE /v2/telephony_credentials/{id}` manually.
- `softphone_users` columns (`sip_username`, `sip_credential_id`,
  `sip_password_encrypted`, `sip_provisioned_at`) stay. They're
  nullable, unused post-rollback, and safe to ignore.
- `SUPABASE_ENCRYPTION_KEY` env var can stay or be removed.

## Known interaction: connection-level `simultaneous_ringing`

Per-user credentials still share the one Credentials-type connection
identified by `TELNYX_CONNECTION_ID`. If the post-deploy symptom is
"only one agent rings for ring-group numbers," the fix is NOT to roll
back the credentials — it's to confirm `simultaneous_ringing` is
`enabled` on the credential connection (the Telnyx dashboard or
`scripts/revert-credential-simultaneous-ringing.ts` reversed).

## Post-rollback to-do

If rollback happened, open a ticket noting the failure mode before
retrying the migration. The most likely next-try issue is environment:

- `SUPABASE_ENCRYPTION_KEY` missing in Vercel
- `TELNYX_CONNECTION_ID` pointing at the wrong connection type
  (must be a Credentials connection, not FQDN)
- Telnyx API key lacking write scope for `telephony_credentials`
