-- Per-call status tracking for transcription and AI analysis.
-- Lets us distinguish a pending call from a permanently-failed one and
-- drive a Retry button in the UI.

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS transcript_status text NOT NULL DEFAULT 'pending'
    CHECK (transcript_status IN ('pending', 'processing', 'complete', 'failed', 'none')),
  ADD COLUMN IF NOT EXISTS ai_status text NOT NULL DEFAULT 'pending'
    CHECK (ai_status IN ('pending', 'processing', 'complete', 'failed', 'none'));

CREATE INDEX IF NOT EXISTS call_logs_transcript_status_idx
  ON call_logs (transcript_status);
CREATE INDEX IF NOT EXISTS call_logs_ai_status_idx
  ON call_logs (ai_status);
