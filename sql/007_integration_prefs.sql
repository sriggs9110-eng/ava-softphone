-- Mirror of supabase/migrations/20260422_integration_prefs.sql
ALTER TABLE softphone_users
  ADD COLUMN IF NOT EXISTS signal_webhook_url text,
  ADD COLUMN IF NOT EXISTS auto_dial_popup boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_analyze_calls boolean NOT NULL DEFAULT true;
