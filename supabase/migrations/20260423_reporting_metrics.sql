-- Coaching metrics extracted by Claude from each call transcript, plus two
-- derived flags for local-presence effectiveness reporting.

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS talk_ratio_rep numeric,
  ADD COLUMN IF NOT EXISTS talk_ratio_prospect numeric,
  ADD COLUMN IF NOT EXISTS question_count int,
  ADD COLUMN IF NOT EXISTS longest_monologue_sec int,
  ADD COLUMN IF NOT EXISTS interruption_count int,
  ADD COLUMN IF NOT EXISTS objection_tags text[],
  ADD COLUMN IF NOT EXISTS topic_tags text[],
  ADD COLUMN IF NOT EXISTS used_local_presence boolean,
  ADD COLUMN IF NOT EXISTS matched_area_code boolean;

-- Indexes to keep the reports endpoint fast on larger datasets.
CREATE INDEX IF NOT EXISTS call_logs_user_created_idx
  ON call_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_logs_created_idx
  ON call_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS call_logs_objection_tags_gin
  ON call_logs USING gin (objection_tags);
CREATE INDEX IF NOT EXISTS call_logs_topic_tags_gin
  ON call_logs USING gin (topic_tags);
