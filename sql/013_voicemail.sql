-- Mirror of supabase/migrations/20260426_voicemail.sql
ALTER TABLE ring_groups
  ADD COLUMN IF NOT EXISTS voicemail_greeting_url text,
  ADD COLUMN IF NOT EXISTS voicemail_greeting_filename text;

ALTER TABLE ring_groups ALTER COLUMN fallback_action SET DEFAULT 'voicemail';

CREATE TABLE IF NOT EXISTS voicemails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ring_group_id uuid REFERENCES ring_groups(id) ON DELETE SET NULL,
  caller_number text NOT NULL,
  called_number text NOT NULL,
  recording_url text,
  recording_telnyx_id text,
  duration_seconds int,
  transcript text,
  transcript_status text DEFAULT 'pending'
    CHECK (transcript_status IN ('pending', 'processing', 'complete', 'failed', 'none')),
  status text DEFAULT 'new'
    CHECK (status IN ('new', 'handled', 'ignored')),
  handled_by uuid REFERENCES softphone_users(id),
  handled_at timestamptz,
  handled_note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE voicemails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated reads voicemails" ON voicemails;
CREATE POLICY "authenticated reads voicemails" ON voicemails
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated updates voicemails" ON voicemails;
CREATE POLICY "authenticated updates voicemails" ON voicemails
  FOR UPDATE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS voicemails_status_created_idx
  ON voicemails (status, created_at DESC);
CREATE INDEX IF NOT EXISTS voicemails_group_idx
  ON voicemails (ring_group_id);

CREATE TABLE IF NOT EXISTS ring_group_call_state (
  call_control_id text PRIMARY KEY,
  ring_group_id uuid REFERENCES ring_groups(id) ON DELETE SET NULL,
  caller_number text,
  called_number text,
  state text NOT NULL CHECK (
    state IN ('voicemail_answering', 'voicemail_playing_greeting', 'voicemail_recording', 'done')
  ),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ring_group_call_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct access" ON ring_group_call_state;
CREATE POLICY "no direct access" ON ring_group_call_state
  FOR SELECT TO authenticated USING (false);

CREATE INDEX IF NOT EXISTS ring_group_call_state_created_idx
  ON ring_group_call_state (created_at DESC);
