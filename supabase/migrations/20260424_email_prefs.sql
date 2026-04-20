-- Per-user email preferences. Spec referenced `profiles`; targeting
-- `softphone_users` (this project's profile table).

ALTER TABLE softphone_users
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_summary_enabled boolean NOT NULL DEFAULT false;
