-- ================================================================
-- Role system update — migration 005
-- Run this in Supabase SQL Editor AFTER 004_sop_module.sql
-- ================================================================

-- 1. Drop old CHECK constraint on role column
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- 2. Rename existing roles (handle both English and Thai stored values)
UPDATE profiles SET role = 'admin' WHERE role IN ('owner', 'เจ้าของ');
UPDATE profiles SET role = 'staff' WHERE role = 'พนักงาน';
-- 'staff' values are already correct — no change needed

-- 3. Add new 3-role CHECK constraint
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'editor', 'staff'));

-- 4. pending_changes table — stores editor changes awaiting admin approval
CREATE TABLE pending_changes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  editor_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  change_type  TEXT NOT NULL CHECK (change_type IN (
               'recipe_edit', 'prep_yield_edit',
               'menu_create', 'menu_delete',
               'prep_create', 'prep_delete',
               'ingredient_edit', 'ingredient_create', 'ingredient_delete',
               'sop_upsert', 'sop_delete')),
  target_id    TEXT NOT NULL,   -- UUID string or descriptive label for creates
  payload      JSONB NOT NULL,  -- full snapshot of proposed change
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES profiles(id)
);

ALTER TABLE pending_changes ENABLE ROW LEVEL SECURITY;

-- Admin sees all; editor sees own records only
CREATE POLICY "pending read" ON pending_changes FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    OR editor_id = auth.uid()
  );

-- Any authenticated user can create pending changes (server action guards role)
CREATE POLICY "pending insert" ON pending_changes FOR INSERT TO authenticated
  WITH CHECK (editor_id = auth.uid());

-- Admin can update (approve/reject)
CREATE POLICY "pending admin update" ON pending_changes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
