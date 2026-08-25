-- ============================================================================
-- Per-event activity log (who/what/when — no field-level diffs)
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (CREATE TABLE IF NOT
-- EXISTS / DROP POLICY IF EXISTS throughout).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catering_event_activity_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.catering_events(id) ON DELETE CASCADE,
  actor       UUID REFERENCES public.profiles(id),
  action_key  TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catering_activity_log_event ON public.catering_event_activity_log(event_id, created_at DESC);

ALTER TABLE public.catering_event_activity_log ENABLE ROW LEVEL SECURITY;

-- No append-only-log precedent exists elsewhere in this app to follow (checked
-- — no HR audit trail or similar table exists). Falls back to the same role
-- set and single FOR ALL policy shape as every other table in this module:
-- every write already runs inside a server action gated by requireSales()
-- under the caller's own authenticated session, so there's no
-- untrusted-client-insert scenario to guard against here.
DROP POLICY IF EXISTS "catering_event_activity_log_rw" ON public.catering_event_activity_log;
CREATE POLICY "catering_event_activity_log_rw" ON public.catering_event_activity_log FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin','sales'));

COMMENT ON TABLE public.catering_event_activity_log IS
  'Simple who/what/when activity log for a catering event — no field-level diffs, just an action_key plus a pre-rendered Thai description. Written by logCateringActivity() in actions.ts, called from every event-scoped write action right after that write succeeds.';
COMMENT ON COLUMN public.catering_event_activity_log.actor IS
  'The profile who performed the action. Nullable to match other actor columns in this schema (e.g. catering_events.created_by), though every write path in this module always has an authenticated profile at hand when it logs.';
COMMENT ON COLUMN public.catering_event_activity_log.action_key IS
  'Short machine key: created, edited, quote_issued, menu_added, menu_removed, charges_updated, task_completed, task_uncompleted. Not a DB enum — matches this module''s convention of keeping the app-code template as the source of truth (see task_key on catering_event_task_completions for the same pattern).';
