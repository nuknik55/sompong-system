-- ============================================================================
-- Per-event task checklist completion state
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (CREATE TABLE IF NOT
-- EXISTS / DROP POLICY IF EXISTS throughout).
--
-- The 11 checklist steps themselves are a static template in code (see
-- src/app/owner/catering/checklist.ts) — not editable via UI this round.
-- This table only stores per-event completion state, keyed by task_key
-- matching the code template. task_key is plain TEXT with no CHECK
-- constraint on purpose: keeping the DB decoupled from the code template
-- means a future round can add/reorder/remove steps without a migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catering_event_task_completions (
  event_id     UUID NOT NULL REFERENCES public.catering_events(id) ON DELETE CASCADE,
  task_key     TEXT NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES public.profiles(id),
  PRIMARY KEY (event_id, task_key)
);

CREATE INDEX IF NOT EXISTS idx_catering_task_completions_event ON public.catering_event_task_completions(event_id);

ALTER TABLE public.catering_event_task_completions ENABLE ROW LEVEL SECURITY;

-- Same role set as catering_events_rw (catering_migration.sql) — sales needs
-- full read/write to check things off, matching every other table in this
-- module that sales interacts with directly.
DROP POLICY IF EXISTS "catering_event_task_completions_rw" ON public.catering_event_task_completions;
CREATE POLICY "catering_event_task_completions_rw" ON public.catering_event_task_completions FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

COMMENT ON TABLE public.catering_event_task_completions IS
  'Per-event completion state for the static 11-step task checklist template (src/app/owner/catering/checklist.ts). task_key must match a key in that template — not enforced by a DB constraint since the template lives in code.';
COMMENT ON COLUMN public.catering_event_task_completions.completed_at IS
  'NULL = not completed. Set to now() when checked, cleared to NULL when unchecked — no history of prior toggles is kept.';
COMMENT ON COLUMN public.catering_event_task_completions.completed_by IS
  'Who last checked the box. NULL alongside a NULL completed_at (never completed); set together with completed_at when checked, cleared together when unchecked.';
