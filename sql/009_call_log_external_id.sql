-- Mirror of supabase/migrations/20260422_call_log_external_id.sql
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS external_id text;
CREATE INDEX IF NOT EXISTS call_logs_external_id_idx ON call_logs (external_id) WHERE external_id IS NOT NULL;
