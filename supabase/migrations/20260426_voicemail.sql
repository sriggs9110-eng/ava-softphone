-- Ring group voicemail capture + in-app inbox.

ALTER TABLE ring_groups
  ADD COLUMN IF NOT EXISTS voicemail_greeting_url text,
  ADD COLUMN IF NOT EXISTS voicemail_greeting_filename text;

-- Flip the default now that voicemail ships — new groups default to voicemail
-- fallback rather than hangup.
ALTER TABLE ring_groups
  ALTER COLUMN fallback_action SET DEFAULT 'voicemail';

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

-- Transient state for the multi-event voicemail flow. The webhook handler
-- dispatches across several Telnyx events (answered → playback.ended →
-- recording.saved) that may land on different serverless instances, so a
-- DB row is the only reliable correlation across cold starts. Rows self-
-- clean via state='done' + created_at index; a periodic sweep can garbage-
-- collect stale entries if needed.
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
-- Service role only — no direct client access needed.
DROP POLICY IF EXISTS "no direct access" ON ring_group_call_state;
CREATE POLICY "no direct access" ON ring_group_call_state
  FOR SELECT TO authenticated USING (false);

CREATE INDEX IF NOT EXISTS ring_group_call_state_created_idx
  ON ring_group_call_state (created_at DESC);
