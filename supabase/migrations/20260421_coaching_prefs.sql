-- Persisted coaching preferences. One jsonb column keeps future toggles cheap to add.

ALTER TABLE softphone_users
  ADD COLUMN IF NOT EXISTS coaching_prefs jsonb NOT NULL DEFAULT
    '{"live_cards": true, "sound_fx": true, "celebrations": true, "auto_whisper": false}'::jsonb;
