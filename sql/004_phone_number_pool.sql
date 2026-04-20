-- Mirror of supabase/migrations/20260421_phone_number_pool.sql
CREATE TABLE IF NOT EXISTS phone_number_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL UNIQUE,
  area_code text NOT NULL,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS phone_pool_area_code_idx
  ON phone_number_pool (area_code) WHERE is_active;

ALTER TABLE phone_number_pool ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage pool" ON phone_number_pool;
CREATE POLICY "admins manage pool" ON phone_number_pool
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM softphone_users WHERE softphone_users.id = auth.uid() AND softphone_users.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM softphone_users WHERE softphone_users.id = auth.uid() AND softphone_users.role = 'admin'));

DROP POLICY IF EXISTS "agents read pool" ON phone_number_pool;
CREATE POLICY "agents read pool" ON phone_number_pool
  FOR SELECT TO authenticated USING (is_active = true);
