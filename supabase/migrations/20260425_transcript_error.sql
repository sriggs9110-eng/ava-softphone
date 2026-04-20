-- Diagnostics for transcription failures + Telnyx recording refresh support.
-- transcript_error captures the exact Whisper/download failure reason so we
-- can surface "Retry transcription" with context in the UI.
-- recording_id is the Telnyx recording ID (UUID) so we can re-fetch a fresh
-- presigned URL when the stored one expires (Telnyx S3 URLs have a 10-min TTL).

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS transcript_error text,
  ADD COLUMN IF NOT EXISTS recording_id text;

-- Broaden ai_status check to include skipped_no_transcript. Postgres requires
-- drop+recreate — the previous constraint name follows the default
-- "{table}_{column}_check" convention.
ALTER TABLE call_logs DROP CONSTRAINT IF EXISTS call_logs_ai_status_check;
ALTER TABLE call_logs
  ADD CONSTRAINT call_logs_ai_status_check
  CHECK (ai_status IN ('pending', 'processing', 'complete', 'failed', 'none', 'skipped_no_transcript'));
