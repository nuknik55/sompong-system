-- ================================================================
-- Migration 006: Add Owner role (superset of Admin, protected tier)
-- Run in Supabase SQL Editor
-- ================================================================

-- 1. Expand role CHECK constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'admin', 'editor', 'staff'));

-- 2. Promote the real restaurant owner
--    profiles has no email column — must join via auth.users
UPDATE profiles
SET role = 'owner'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'sompongseafood1996@gmail.com'
);

-- Sanity check — should return exactly 1 row with role = 'owner'
-- SELECT id, full_name, role FROM profiles WHERE role = 'owner';

-- 3. Update is_owner() to return true for BOTH 'owner' and 'admin'.
--    All existing RLS policies use is_owner() to grant write access —
--    if we made it return true only for 'owner', admins would lose
--    all write access across every table. Keep both privileged here.
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_role() IN ('owner', 'admin');
$$;

-- 4. Prevent non-owners from changing an owner's role
CREATE OR REPLACE FUNCTION prevent_owner_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.role = 'owner' AND NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Only an Owner can change another Owner''s role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_owner_role ON profiles;
CREATE TRIGGER protect_owner_role
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_owner_role_change();

-- 5. Prevent non-owners from deleting an owner account
CREATE OR REPLACE FUNCTION prevent_owner_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.role = 'owner' THEN
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Only an Owner can delete an Owner account';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS protect_owner_delete ON profiles;
CREATE TRIGGER protect_owner_delete
  BEFORE DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_owner_delete();

-- 6. Update pending_changes RLS policies to include 'owner'
--    (migration 005 hardcoded role = 'admin' in these policies)
DROP POLICY IF EXISTS "pending read" ON pending_changes;
CREATE POLICY "pending read" ON pending_changes FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'owner'))
    OR editor_id = auth.uid()
  );

DROP POLICY IF EXISTS "pending admin update" ON pending_changes;
CREATE POLICY "pending admin update" ON pending_changes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'owner')));
