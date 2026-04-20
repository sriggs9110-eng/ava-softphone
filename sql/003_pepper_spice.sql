-- Pepper spice preference (mirror of supabase/migrations/20260420_pepper_spice.sql)
ALTER TABLE softphone_users
  ADD COLUMN IF NOT EXISTS pepper_spice text DEFAULT 'medium'
  CHECK (pepper_spice IN ('mild', 'medium', 'hot'));
