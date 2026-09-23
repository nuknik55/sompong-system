-- Drop menus.fuel_cost.
--
-- BACKGROUND. fuel_cost was a per-dish gas/fuel cost in baht. It was superseded
-- by the flat q-factor uplift (app_settings.q_factor_pct), which covers gas,
-- spices and packaging together — see the comment on computeMenuCost() in
-- src/lib/costing.ts. Tracking fuel per dish badly distorts cheap, quick-cook
-- items, which is why the approach changed.
--
-- The column has been dead in computation ever since: nothing reads it into any
-- cost, margin or menu-engineering figure. It was still selected into MenuRow
-- and still written as 0 by the two menu-create paths, which is the only reason
-- it looked live.
--
-- DATA BEING DISCARDED. 230 of 239 menus carry a non-zero value, roughly
-- ฿5–16 per dish. Nik reviewed and decided against a CSV snapshot: the numbers
-- are stale, were never validated, and are not the basis for any future work.
-- They are gone after this runs.
--
-- Sales could read this column via the menus_read_all policy. It is gas cost
-- only and cannot be reconstructed into ingredient cost or margin, so this is a
-- tidy-up rather than a leak being closed.
--
-- Run the code change in the same deploy — src/lib/data.ts stops selecting the
-- column and both insert paths stop writing it, so the order does not matter,
-- but leaving code selecting a dropped column would 42703 every menu page.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.menus DROP COLUMN IF EXISTS fuel_cost;

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Expect zero rows:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'menus'
--      AND column_name = 'fuel_cost';
--
-- Expect 239, unchanged:
--   SELECT count(*) FROM public.menus;
