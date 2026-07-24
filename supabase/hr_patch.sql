-- ===================================================
-- HR Patch: align column names with app code
-- Run AFTER hr_migration.sql
-- ===================================================

-- ─── payroll_periods ────────────────────────────────────────────────────────
ALTER TABLE public.payroll_periods RENAME COLUMN year  TO period_year;
ALTER TABLE public.payroll_periods RENAME COLUMN month TO period_month;

-- Change period_half from INTEGER (1/2) to TEXT ('first'/'second')
ALTER TABLE public.payroll_periods DROP CONSTRAINT IF EXISTS payroll_periods_period_half_check;
ALTER TABLE public.payroll_periods
  ALTER COLUMN period_half TYPE TEXT
  USING (CASE WHEN period_half::text = '1' THEN 'first' ELSE 'second' END);
ALTER TABLE public.payroll_periods
  ADD CONSTRAINT payroll_periods_period_half_check
  CHECK (period_half IN ('first', 'second'));

-- Fix UNIQUE constraint (uses old column names)
ALTER TABLE public.payroll_periods
  DROP CONSTRAINT IF EXISTS payroll_periods_year_month_period_half_key;
ALTER TABLE public.payroll_periods
  ADD CONSTRAINT payroll_periods_unique
  UNIQUE (period_year, period_month, period_half);

-- ─── payroll_entries ────────────────────────────────────────────────────────
ALTER TABLE public.payroll_entries RENAME COLUMN period_id            TO payroll_period_id;
ALTER TABLE public.payroll_entries RENAME COLUMN bonus                TO special_bonus;
ALTER TABLE public.payroll_entries RENAME COLUMN social_security_ded  TO social_security_deduction;
ALTER TABLE public.payroll_entries RENAME COLUMN absent_leave_ded     TO leave_deduction;
ALTER TABLE public.payroll_entries RENAME COLUMN advance_ded          TO advance_deduction;
ALTER TABLE public.payroll_entries RENAME COLUMN penalty_ded          TO adjustment;
ALTER TABLE public.payroll_entries RENAME COLUMN other_allowance      TO other_amount;

-- Add missing columns
ALTER TABLE public.payroll_entries ADD COLUMN IF NOT EXISTS tip_amount  NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.payroll_entries ADD COLUMN IF NOT EXISTS gross_total NUMERIC;
ALTER TABLE public.payroll_entries ADD COLUMN IF NOT EXISTS net_total   NUMERIC;

-- Fix UNIQUE constraint (uses old period_id name)
ALTER TABLE public.payroll_entries
  DROP CONSTRAINT IF EXISTS payroll_entries_period_id_employee_id_key;
ALTER TABLE public.payroll_entries
  ADD CONSTRAINT payroll_entries_unique
  UNIQUE (payroll_period_id, employee_id);

-- ─── leave_requests ─────────────────────────────────────────────────────────
-- Add submitted_at (app code reads this field)
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ─── attendance_punches ──────────────────────────────────────────────────────
-- Add source column (app writes source = 'manual')
ALTER TABLE public.attendance_punches
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
