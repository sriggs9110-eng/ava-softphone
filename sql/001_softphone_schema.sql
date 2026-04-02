-- Ava Softphone Schema
-- Run this manually against the Supabase project

-- Enable uuid extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- softphone_users table
CREATE TABLE IF NOT EXISTS public.softphone_users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'agent'
    CHECK (role IN ('agent', 'manager', 'admin')),
  extension text,
  status text DEFAULT 'offline'
    CHECK (status IN ('available', 'on_call', 'after_call_work', 'dnd', 'offline')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.softphone_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all softphone users"
  ON public.softphone_users FOR SELECT USING (true);

CREATE POLICY "Users can update own record"
  ON public.softphone_users FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Admins can manage all"
  ON public.softphone_users FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.softphone_users
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- call_logs table
CREATE TABLE IF NOT EXISTS public.call_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.softphone_users(id),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  phone_number text NOT NULL,
  status text DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'ringing', 'connected',
    'completed', 'missed', 'declined', 'no_answer', 'voicemail')),
  duration_seconds integer DEFAULT 0,
  recording_url text,
  call_control_id text,
  call_session_id text,
  from_number text,
  transcript text,
  ai_summary text,
  ai_score integer,
  ai_analysis jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_logs_user ON public.call_logs(user_id);
CREATE INDEX idx_call_logs_created ON public.call_logs(created_at DESC);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents see own calls, managers see all"
  ON public.call_logs FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.softphone_users
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

CREATE POLICY "Users can insert own calls"
  ON public.call_logs FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own calls"
  ON public.call_logs FOR UPDATE USING (user_id = auth.uid());
