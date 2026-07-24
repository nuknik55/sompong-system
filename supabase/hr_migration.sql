-- ===================================================
-- HR Module Migration
-- Run this in Supabase SQL Editor
-- ===================================================

-- Helper macro to check owner/admin role
-- (matches the pattern used in accounting_migration.sql)

-- ─── 1. Departments ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  id        UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT    NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dept_select" ON public.departments;
DROP POLICY IF EXISTS "dept_all"    ON public.departments;
CREATE POLICY "dept_select" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "dept_all"    ON public.departments FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── 2. Employees ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employees (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code     TEXT    NOT NULL UNIQUE,
  department_id     UUID    REFERENCES public.departments(id),
  full_name         TEXT    NOT NULL,
  nickname          TEXT,
  phone             TEXT,
  position          TEXT,
  employment_type   TEXT    NOT NULL DEFAULT 'full_time'
                    CHECK (employment_type IN ('full_time','part_time','contract')),
  base_salary       NUMERIC NOT NULL DEFAULT 0,
  position_allowance NUMERIC NOT NULL DEFAULT 0,
  hire_date         DATE,
  weekly_day_off    TEXT,
  citizenship_type  TEXT    NOT NULL DEFAULT 'thai'
                    CHECK (citizenship_type IN ('thai','foreign')),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "emp_select" ON public.employees;
DROP POLICY IF EXISTS "emp_all"    ON public.employees;
CREATE POLICY "emp_select" ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "emp_all"    ON public.employees FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── 3. Leave Types ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_types (
  id                          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  code                        TEXT    NOT NULL UNIQUE,
  name_th                     TEXT    NOT NULL,
  annual_quota_days           NUMERIC,
  is_paid                     BOOLEAN NOT NULL DEFAULT TRUE,
  is_subject_to_day_multiplier BOOLEAN NOT NULL DEFAULT FALSE,
  requires_medical_cert       BOOLEAN NOT NULL DEFAULT FALSE,
  is_active                   BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lt_select" ON public.leave_types;
DROP POLICY IF EXISTS "lt_all"    ON public.leave_types;
CREATE POLICY "lt_select" ON public.leave_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "lt_all"    ON public.leave_types FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- Seed default leave types (from Excel: AL, SL, SLA, PLW, PLP, CDW, CDP, UOT)
INSERT INTO public.leave_types (code, name_th, annual_quota_days, is_paid, is_subject_to_day_multiplier, requires_medical_cert) VALUES
  ('AL',  'ลาพักร้อน',         6,    true,  false, false),
  ('SL',  'ลาป่วย',            30,   true,  true,  false),
  ('SLA', 'ลาป่วยมีใบแพทย์',   null, true,  true,  true),
  ('PLW', 'ลากิจ (รายวัน)',    3,    true,  true,  false),
  ('PLP', 'ลากิจ (ราย period)', null, true,  true,  false),
  ('CDW', 'ชดเชย (รายวัน)',    null, true,  false, false),
  ('CDP', 'ชดเชย (ราย period)', null, true,  false, false),
  ('UOT', 'ขาดงาน/ไม่ชำระ',   null, false, true,  false)
ON CONFLICT (code) DO NOTHING;

-- ─── 4. Leave Requests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID    NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type_id  UUID    NOT NULL REFERENCES public.leave_types(id),
  date_from      DATE    NOT NULL,
  date_to        DATE    NOT NULL,
  total_days     NUMERIC NOT NULL DEFAULT 1,
  reason         TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected')),
  approved_by    UUID    REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lr_select" ON public.leave_requests;
DROP POLICY IF EXISTS "lr_all"    ON public.leave_requests;
CREATE POLICY "lr_select" ON public.leave_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "lr_all"    ON public.leave_requests FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── 5. Holidays ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.holidays (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date   DATE    NOT NULL UNIQUE,
  name           TEXT    NOT NULL,
  pay_type       TEXT    NOT NULL DEFAULT 'multiplier'
                 CHECK (pay_type IN ('multiplier','substitute')),
  pay_multiplier NUMERIC NOT NULL DEFAULT 2,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hol_select" ON public.holidays;
DROP POLICY IF EXISTS "hol_all"    ON public.holidays;
CREATE POLICY "hol_select" ON public.holidays FOR SELECT TO authenticated USING (true);
CREATE POLICY "hol_all"    ON public.holidays FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── 6. OT Rules ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ot_rules (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  applies_to  TEXT    NOT NULL DEFAULT 'weekday'
              CHECK (applies_to IN ('weekday','weekend','holiday')),
  multiplier  NUMERIC NOT NULL DEFAULT 1.5,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE public.ot_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ot_select" ON public.ot_rules;
DROP POLICY IF EXISTS "ot_all"    ON public.ot_rules;
CREATE POLICY "ot_select" ON public.ot_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "ot_all"    ON public.ot_rules FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- Seed default OT rules
INSERT INTO public.ot_rules (name, applies_to, multiplier) VALUES
  ('OT วันธรรมดา',       'weekday', 1.5),
  ('OT เสาร์-อาทิตย์',  'weekend', 2.0),
  ('OT วันนักขัตฤกษ์',  'holiday', 3.0)
ON CONFLICT DO NOTHING;

-- ─── 7. Payroll Periods ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  year        INTEGER NOT NULL,
  month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  period_half INTEGER NOT NULL CHECK (period_half IN (1, 2)),
  pay_date    DATE,
  is_closed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, month, period_half)
);

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pp_select" ON public.payroll_periods;
DROP POLICY IF EXISTS "pp_all"    ON public.payroll_periods;
CREATE POLICY "pp_select" ON public.payroll_periods FOR SELECT TO authenticated USING (true);
CREATE POLICY "pp_all"    ON public.payroll_periods FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── 8. Payroll Entries ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_entries (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id           UUID    NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
  employee_id         UUID    NOT NULL REFERENCES public.employees(id),
  base_salary         NUMERIC NOT NULL DEFAULT 0,
  position_allowance  NUMERIC NOT NULL DEFAULT 0,
  bonus               NUMERIC NOT NULL DEFAULT 0,
  holiday_pay         NUMERIC NOT NULL DEFAULT 0,
  ot_pay              NUMERIC NOT NULL DEFAULT 0,
  social_security_ded NUMERIC NOT NULL DEFAULT 0,
  absent_leave_ded    NUMERIC NOT NULL DEFAULT 0,
  advance_ded         NUMERIC NOT NULL DEFAULT 0,
  penalty_ded         NUMERIC NOT NULL DEFAULT 0,
  other_allowance     NUMERIC NOT NULL DEFAULT 0,
  meal_allowance      NUMERIC NOT NULL DEFAULT 0,
  note                TEXT,
  UNIQUE (period_id, employee_id)
);

ALTER TABLE public.payroll_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pe_select" ON public.payroll_entries;
DROP POLICY IF EXISTS "pe_all"    ON public.payroll_entries;
CREATE POLICY "pe_select" ON public.payroll_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "pe_all"    ON public.payroll_entries FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── 9. Attendance Punches ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attendance_punches (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID    NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date   DATE    NOT NULL,
  punch_type  TEXT    NOT NULL CHECK (punch_type IN ('in','out')),
  punch_time  TIMESTAMPTZ NOT NULL,
  note        TEXT,
  UNIQUE (employee_id, work_date, punch_type)
);

ALTER TABLE public.attendance_punches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ap_select" ON public.attendance_punches;
DROP POLICY IF EXISTS "ap_all"    ON public.attendance_punches;
CREATE POLICY "ap_select" ON public.attendance_punches FOR SELECT TO authenticated USING (true);
CREATE POLICY "ap_all"    ON public.attendance_punches FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employees_dept      ON public.employees(department_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp  ON public.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_date ON public.leave_requests(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_per ON public.payroll_entries(period_id);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON public.attendance_punches(employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_holidays_date       ON public.holidays(holiday_date);
