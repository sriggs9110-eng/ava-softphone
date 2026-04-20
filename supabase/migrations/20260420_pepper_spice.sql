-- Pepper spice preference
-- Per-user dial for how aggressive Pepper's live coaching should be.
-- Targets softphone_users (the profile table in this project — spec originally said `profiles`).

ALTER TABLE softphone_users
  ADD COLUMN IF NOT EXISTS pepper_spice text DEFAULT 'medium'
  CHECK (pepper_spice IN ('mild', 'medium', 'hot'));
