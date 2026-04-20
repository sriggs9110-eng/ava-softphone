-- Mirror of supabase/migrations/20260421_ring_groups.sql
CREATE TABLE IF NOT EXISTS ring_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  inbound_number text NOT NULL UNIQUE,
  strategy text NOT NULL DEFAULT 'simultaneous'
    CHECK (strategy IN ('simultaneous', 'round_robin')),
  ring_timeout_seconds int NOT NULL DEFAULT 20,
  fallback_action text NOT NULL DEFAULT 'voicemail'
    CHECK (fallback_action IN ('voicemail', 'hangup')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ring_group_members (
  group_id uuid REFERENCES ring_groups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES softphone_users(id) ON DELETE CASCADE,
  priority int NOT NULL DEFAULT 1,
  PRIMARY KEY (group_id, user_id)
);

ALTER TABLE ring_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ring_group_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage ring groups" ON ring_groups;
CREATE POLICY "admins manage ring groups" ON ring_groups
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM softphone_users WHERE softphone_users.id = auth.uid() AND softphone_users.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM softphone_users WHERE softphone_users.id = auth.uid() AND softphone_users.role = 'admin'));

DROP POLICY IF EXISTS "anyone reads ring groups" ON ring_groups;
CREATE POLICY "anyone reads ring groups" ON ring_groups
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "admins manage members" ON ring_group_members;
CREATE POLICY "admins manage members" ON ring_group_members
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM softphone_users WHERE softphone_users.id = auth.uid() AND softphone_users.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM softphone_users WHERE softphone_users.id = auth.uid() AND softphone_users.role = 'admin'));

DROP POLICY IF EXISTS "users read own membership" ON ring_group_members;
CREATE POLICY "users read own membership" ON ring_group_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM softphone_users WHERE softphone_users.id = auth.uid() AND softphone_users.role = 'admin'));
