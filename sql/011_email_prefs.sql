-- Mirror of supabase/migrations/20260424_email_prefs.sql
ALTER TABLE softphone_users
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_summary_enabled boolean NOT NULL DEFAULT false;
