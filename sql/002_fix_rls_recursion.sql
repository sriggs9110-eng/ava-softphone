-- Fix RLS infinite recursion on softphone_users
-- The "Admins can manage all" policy was querying softphone_users
-- to check role, which triggered the same policy check again.
-- Solution: SECURITY DEFINER function that bypasses RLS.

CREATE OR REPLACE FUNCTION public.get_softphone_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.softphone_users WHERE id = auth.uid()
$$;

-- Drop the recursive policies
DROP POLICY IF EXISTS "Admins can manage all" ON public.softphone_users;
DROP POLICY IF EXISTS "Users can view all softphone users" ON public.softphone_users;
DROP POLICY IF EXISTS "Users can update own record" ON public.softphone_users;

-- Recreate without recursion
CREATE POLICY "Users can view all softphone users"
  ON public.softphone_users FOR SELECT USING (true);

CREATE POLICY "Users can update own record"
  ON public.softphone_users FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Admins can manage all"
  ON public.softphone_users FOR ALL
  USING (public.get_softphone_user_role() IN ('admin', 'manager'));

-- Fix call_logs policy that also referenced softphone_users directly
DROP POLICY IF EXISTS "Agents see own calls, managers see all" ON public.call_logs;

CREATE POLICY "Agents see own calls, managers see all"
  ON public.call_logs FOR SELECT USING (
    user_id = auth.uid()
    OR public.get_softphone_user_role() IN ('admin', 'manager')
  );
