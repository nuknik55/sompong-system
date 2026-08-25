-- ============================================================================
-- Internal labor/vehicle cost entries per catering event (Phase 2)
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (CREATE TABLE IF NOT
-- EXISTS / DROP POLICY IF EXISTS throughout).
--
-- Each row is a snapshot of one catering_transfer_cost_rates pick at the
-- moment it was added to this event — label/unit_amount are copied at entry
-- time (same "copy the number, keep a link for reference" pattern as
-- catering_event_charges vs catering_rates), so a later rename/delete of the
-- underlying rate never changes what this event's P&L already shows.
-- cost_rate_id is kept only as a reference, never the source of truth for
-- display.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catering_event_labor (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID NOT NULL REFERENCES public.catering_events(id) ON DELETE CASCADE,
  cost_rate_id UUID REFERENCES public.catering_transfer_cost_rates(id) ON DELETE SET NULL,
  label        TEXT NOT NULL,
  quantity     NUMERIC NOT NULL DEFAULT 1,
  unit_amount  NUMERIC NOT NULL,
  amount       NUMERIC NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catering_event_labor_event ON public.catering_event_labor(event_id);

ALTER TABLE public.catering_event_labor ENABLE ROW LEVEL SECURITY;

-- owner/admin only, same as catering_transfer_cost_rates — sales has zero
-- access, including SELECT. Consistent with every other cost-bearing table
-- in this module.
DROP POLICY IF EXISTS "catering_event_labor_rw" ON public.catering_event_labor;
CREATE POLICY "catering_event_labor_rw" ON public.catering_event_labor FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

COMMENT ON TABLE public.catering_event_labor IS
  'Internal labor/vehicle cost entries for a specific catering event, picked from catering_transfer_cost_rates. label/unit_amount are snapshotted at entry time (same "copy the number, keep a link for reference" pattern as catering_event_charges vs catering_rates) so a later rename/delete of the source rate never changes what this event''s P&L already shows. owner/admin only, including SELECT — sales has zero access, same as catering_transfer_cost_rates.';
COMMENT ON COLUMN public.catering_event_labor.cost_rate_id IS
  'Reference only, nullable (ON DELETE SET NULL) — label/unit_amount are the source of truth for display, not a live join back to catering_transfer_cost_rates.';
COMMENT ON COLUMN public.catering_event_labor.amount IS
  'quantity × unit_amount by default, but editable independently at entry time — same override pattern as catering_event_charges.amount.';
