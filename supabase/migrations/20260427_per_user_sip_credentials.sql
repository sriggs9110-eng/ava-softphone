-- Per-user Telnyx SIP credentials.
--
-- Every softphone_users row owns its own Telnyx telephony_credential so
-- each agent's browser gets a distinct SIP registration. Replaces the
-- single shared TELNYX_SIP_USERNAME / TELNYX_SIP_PASSWORD setup.
--
-- Columns are nullable: during migration, existing users have no
-- credentials yet and must still be able to sign in. The /api/telnyx/token
-- endpoint self-provisions on first request for any user without one.

ALTER TABLE softphone_users
  ADD COLUMN IF NOT EXISTS sip_username text,
  ADD COLUMN IF NOT EXISTS sip_credential_id text,
  ADD COLUMN IF NOT EXISTS sip_password_encrypted text,
  ADD COLUMN IF NOT EXISTS sip_provisioned_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'softphone_users_sip_username_key'
  ) THEN
    ALTER TABLE softphone_users
      ADD CONSTRAINT softphone_users_sip_username_key UNIQUE (sip_username);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS softphone_users_sip_username_idx
  ON softphone_users (sip_username)
  WHERE sip_username IS NOT NULL;
