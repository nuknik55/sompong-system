-- ============================================================================
-- Internal transfer-cost rates (Phase 1) — owner/admin only, sales has ZERO access
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (CREATE TABLE IF NOT
-- EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING throughout).
--
-- Deliberately separate from catering_rates: catering_rates is customer-
-- facing sale prices (including rate_type='staff_bonus', a per-diem billed
-- TO the customer on offsite jobs — sales already reads that table via
-- catering_rates_select and this migration does not touch it). This table
-- is the opposite: what staffing/vehicle time actually COSTS the business
-- internally, used for margin/profitability — never shown to a customer,
-- never readable by sales.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.catering_transfer_cost_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_type   TEXT NOT NULL
              CHECK (cost_type IN ('staff_labor', 'kitchen_helper', 'vehicle', 'other')),
  label       TEXT NOT NULL,
  amount      NUMERIC NOT NULL,
  unit        TEXT,                     -- free text, e.g. "ต่อคน", "ต่อคัน", "ต่องาน" — matches catering_rates.unit's convention
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Not in the requested column list — added so the seed insert below can be
  -- ON CONFLICT DO NOTHING and stay re-run safe, same reasoning as
  -- catering_rates' UNIQUE (rate_type, label).
  UNIQUE (cost_type, label)
);

CREATE INDEX IF NOT EXISTS idx_catering_transfer_cost_rates_type ON public.catering_transfer_cost_rates(cost_type);

DROP TRIGGER IF EXISTS trg_catering_transfer_cost_rates_updated_at ON public.catering_transfer_cost_rates;
CREATE TRIGGER trg_catering_transfer_cost_rates_updated_at BEFORE UPDATE ON public.catering_transfer_cost_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.catering_transfer_cost_rates ENABLE ROW LEVEL SECURITY;

-- owner/admin only for EVERY operation, including SELECT — sales gets zero
-- access, unlike catering_rates (sales can read there, just not write).
-- This is the one place in the whole catering module where sales access is
-- intentionally narrower than catering_rates.
DROP POLICY IF EXISTS "catering_transfer_cost_rates_rw" ON public.catering_transfer_cost_rates;
CREATE POLICY "catering_transfer_cost_rates_rw" ON public.catering_transfer_cost_rates FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

COMMENT ON TABLE public.catering_transfer_cost_rates IS
  'Internal transfer-cost rates (staff labor, kitchen helper, vehicle, other) — what these actually cost the business, not what is charged to the customer. Deliberately separate from catering_rates (customer-facing sale prices, sales-readable) and unrelated to catering_rates.rate_type=''staff_bonus'' (a customer-facing per-diem line item on quotations). owner/admin only, including SELECT — sales has zero access, the one place in this module where that is true.';
COMMENT ON COLUMN public.catering_transfer_cost_rates.unit IS
  'Free text describing how amount applies, e.g. "ต่อคน", "ต่อคัน", "ต่องาน" — not a CHECK enum, matches catering_rates.unit''s convention.';

INSERT INTO public.catering_transfer_cost_rates (cost_type, label, amount, unit, sort_order) VALUES
  ('staff_labor',    'ค่าแรงพนักงาน/เชฟต่องาน', 250, 'ต่อคน',  10),
  ('kitchen_helper', 'ค่าแรงผู้ช่วยครัว',         100, 'ต่อคน',  20),
  ('vehicle',        'ค่าน้ำมันรถ',               200, 'ต่อคัน', 30)
ON CONFLICT (cost_type, label) DO NOTHING;
