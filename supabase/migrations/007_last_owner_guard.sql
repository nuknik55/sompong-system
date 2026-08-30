-- ================================================================
-- Migration 007: Last-owner guard on role-change and delete triggers
-- Run in Supabase SQL Editor AFTER 006_owner_role.sql
-- ================================================================

-- Prevent demoting the last owner (blocks everyone, including owners)
CREATE OR REPLACE FUNCTION prevent_owner_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.role = 'owner' AND NEW.role IS DISTINCT FROM OLD.role THEN
    -- Last-owner check: anyone trying to demote the last owner is blocked
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id != OLD.id AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'ต้องมี Owner อย่างน้อย 1 คนในระบบ ไม่สามารถเปลี่ยนสิทธิ์ Owner คนสุดท้ายได้';
    END IF;
    -- Non-owners cannot change an owner's role at all
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Only an Owner can change another Owner''s role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Prevent deleting the last owner (blocks everyone, including owners)
CREATE OR REPLACE FUNCTION prevent_owner_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF OLD.role = 'owner' THEN
    -- Last-owner check
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id != OLD.id AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'ต้องมี Owner อย่างน้อย 1 คนในระบบ ไม่สามารถลบ Owner คนสุดท้ายได้';
    END IF;
    -- Non-owners cannot delete an owner
    IF NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Only an Owner can delete an Owner account';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
