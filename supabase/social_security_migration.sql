-- ===================================================
-- Social Security (ประกันสังคม) Migration
-- Run this in Supabase SQL Editor
-- ===================================================

-- Monthly social security amount the employee themselves is responsible for
-- (before any employer subsidy). Stored per-employee so payroll can default
-- half of it into each half-month pay period automatically.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS social_security_monthly NUMERIC NOT NULL DEFAULT 0;
