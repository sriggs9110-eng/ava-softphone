-- External CRM reference, set when a call originates from a pop-up dialer.
-- Used by the webhook auto-analyze path to decide whether to POST a
-- delayed summary to the owner's Signal webhook.

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE INDEX IF NOT EXISTS call_logs_external_id_idx
  ON call_logs (external_id) WHERE external_id IS NOT NULL;
