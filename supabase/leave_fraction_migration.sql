-- ===================================================
-- Leave Fraction Migration
-- Run this in Supabase SQL Editor
-- ===================================================

-- Lets a "leave" day be recorded as a fraction (e.g. 0.5 for half-day leave)
-- instead of always counting as a full day.
ALTER TABLE attendance_daily ADD COLUMN IF NOT EXISTS leave_fraction NUMERIC NOT NULL DEFAULT 1;
