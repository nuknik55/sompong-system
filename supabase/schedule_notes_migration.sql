-- Weekly schedule notes — one note per employee per day.
--
-- Read by  getScheduleWeek()     (id, employee_id, note_date, note, note_type)
-- Written by upsertScheduleNote() (employee_id, note_date, note, note_type,
--                                  onConflict "employee_id,note_date")
--
-- This replaces an earlier copy that lived outside the git root and was never
-- run: public.schedule_notes did not exist in production (PGRST205), so every
-- write silently failed while ScheduleClient updated optimistically and the
-- note vanished on reload. The RLS below differs from that copy — it follows
-- the four-policy shape hr_role_patch.sql established for every other HR
-- table, rather than the single FOR ALL policy the old file used.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.schedule_notes (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id  UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  note_date    DATE NOT NULL,
  -- upsertScheduleNote always sends a string (clearNote sends ""), so NOT NULL
  -- with a default is right; note_type alone is meaningful without note text.
  note         TEXT NOT NULL DEFAULT '',
  note_type    TEXT NOT NULL DEFAULT 'note'
    -- Mirrors the NoteType union in src/app/owner/hr/actions.ts exactly.
    CHECK (note_type IN ('compensatory','holiday_use','leave','sick','vacation','event','note')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Required: upsertScheduleNote relies on onConflict "employee_id,note_date".
  -- Without this constraint the upsert errors rather than merging.
  UNIQUE (employee_id, note_date)
);

-- The schedule grid is read a week at a time, filtered on note_date.
CREATE INDEX IF NOT EXISTS schedule_notes_note_date_idx
  ON public.schedule_notes (note_date);

ALTER TABLE public.schedule_notes ENABLE ROW LEVEL SECURITY;

-- Policy shape copied from hr_role_patch.sql / attendance_daily_migration.sql:
-- owner+hr+admin read, owner+hr write, split per command so INSERT gets a real
-- WITH CHECK. Not the FOR ALL form — that would be a third shape in this schema.
--
-- Write set matches requireHR() in src/lib/auth.ts, which admits owner and hr
-- only. getScheduleWeek() has no auth guard of its own and relies entirely on
-- the SELECT policy below, so admin's read access has to come from here.

DROP POLICY IF EXISTS "hr_admin_read_schedule_notes" ON public.schedule_notes;
DROP POLICY IF EXISTS "hr_write_schedule_notes"      ON public.schedule_notes;
DROP POLICY IF EXISTS "hr_admin_read" ON public.schedule_notes;
DROP POLICY IF EXISTS "hr_insert"     ON public.schedule_notes;
DROP POLICY IF EXISTS "hr_update"     ON public.schedule_notes;
DROP POLICY IF EXISTS "hr_delete"     ON public.schedule_notes;

CREATE POLICY "hr_admin_read" ON public.schedule_notes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr','admin'))
);
CREATE POLICY "hr_insert" ON public.schedule_notes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "hr_update" ON public.schedule_notes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);
CREATE POLICY "hr_delete" ON public.schedule_notes FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','hr'))
);

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='schedule_notes'
--  ORDER BY ordinal_position;
--
-- SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint WHERE conrelid='public.schedule_notes'::regclass;
--
-- SELECT policyname, cmd, qual, with_check
--   FROM pg_policies WHERE tablename='schedule_notes';
