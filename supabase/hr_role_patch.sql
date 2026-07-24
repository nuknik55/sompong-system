-- HR Role Patch
-- Run this in Supabase SQL Editor
-- Adds 'hr' role + updates RLS policies for HR tables

-- ─── 1. Update profiles role constraint ─────────────────────────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('owner', 'admin', 'editor', 'staff', 'hr'));

-- ─── 2. Update RLS policies for HR tables ───────────────────────────────────
-- Drop all existing policies per table, then recreate with correct role sets.

-- Helper: we identify existing policy names dynamically, so we drop/recreate
-- by table. Use explicit names so reruns are safe (IF NOT EXISTS on policies
-- isn't supported, but DROP POLICY IF EXISTS is).

-- ── departments (owner + hr manage) ─────────────────────────────────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='departments' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.departments'; END LOOP;
END $$;

CREATE POLICY "hr_all" ON public.departments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "admin_read" ON public.departments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ── employees (owner + hr manage; admin read for leave/attendance joins) ─────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='employees' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.employees'; END LOOP;
END $$;

CREATE POLICY "hr_all" ON public.employees FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "admin_read" ON public.employees FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ── leave_types (owner + hr manage; admin read) ───────────────────────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='leave_types' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.leave_types'; END LOOP;
END $$;

CREATE POLICY "hr_all" ON public.leave_types FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "admin_read" ON public.leave_types FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ── leave_requests (admin can read for scheduling; only hr/owner can write) ──
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='leave_requests' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.leave_requests'; END LOOP;
END $$;

CREATE POLICY "hr_admin_read" ON public.leave_requests FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr','admin'))
);
CREATE POLICY "hr_insert" ON public.leave_requests FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "hr_update" ON public.leave_requests FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "hr_delete" ON public.leave_requests FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);

-- ── holidays (owner + hr manage) ─────────────────────────────────────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='holidays' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.holidays'; END LOOP;
END $$;

CREATE POLICY "hr_all" ON public.holidays FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);

-- ── ot_rules (owner + hr manage) ─────────────────────────────────────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='ot_rules' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.ot_rules'; END LOOP;
END $$;

CREATE POLICY "hr_all" ON public.ot_rules FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);

-- ── payroll_periods (owner + hr ONLY — salary data) ──────────────────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='payroll_periods' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.payroll_periods'; END LOOP;
END $$;

CREATE POLICY "hr_only" ON public.payroll_periods FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);

-- ── payroll_entries (owner + hr ONLY — salary data) ──────────────────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='payroll_entries' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.payroll_entries'; END LOOP;
END $$;

CREATE POLICY "hr_only" ON public.payroll_entries FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);

-- ── attendance_punches (admin read for scheduling; hr/owner write) ────────────
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE tablename='attendance_punches' AND schemaname='public'
  LOOP EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(p.policyname) || ' ON public.attendance_punches'; END LOOP;
END $$;

CREATE POLICY "hr_admin_read" ON public.attendance_punches FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr','admin'))
);
CREATE POLICY "hr_insert" ON public.attendance_punches FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "hr_update" ON public.attendance_punches FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "hr_delete" ON public.attendance_punches FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
