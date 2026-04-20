-- Mirror of supabase/migrations/20260425_transcript_error.sql
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS transcript_error text,
  ADD COLUMN IF NOT EXISTS recording_id text;

ALTER TABLE call_logs DROP CONSTRAINT IF EXISTS call_logs_ai_status_check;
ALTER TABLE call_logs
  ADD CONSTRAINT call_logs_ai_status_check
  CHECK (ai_status IN ('pending', 'processing', 'complete', 'failed', 'none', 'skipped_no_transcript'));
