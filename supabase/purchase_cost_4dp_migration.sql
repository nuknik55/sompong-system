-- Widen ingredients.purchase_cost from numeric(12,2) to numeric(12,4).
--
-- WHY. purchase_cost is a cost per PURCHASE unit, and rawUnitCost() then divides
-- it down to a usage unit:
--
--     unit cost = purchase_cost × receive_qty ÷ yield_qty
--
-- With yield_qty commonly 1000 (a kilo bought, grams used), two decimal places
-- of purchase cost is coarse: rounding ฿0.005 at the top becomes a systematic
-- error on every dish that uses the ingredient, always in the same direction
-- for a given ingredient rather than averaging out. receive_qty and yield_qty
-- are already numeric(_,4); purchase_cost was the odd one out.
--
-- THIS MIGRATION IS REQUIRED FOR THE CODE CHANGE TO DO ANYTHING. The POS import
-- rounds to 2dp in JS before writing, and that has now been changed to 4dp — but
-- while the column is numeric(12,2) Postgres re-rounds on write regardless, so
-- the code change alone is a no-op. Verified against production: purchase_cost
-- comes back over the wire as 1300.00 (scale 2) while receive_qty comes back as
-- 1.0000 (scale 4).
--
-- WIDENING IS LOSSLESS. Existing values keep their value; they simply gain two
-- trailing zeros. No data is rounded or discarded, and the change is backwards
-- compatible with every read. Reversing it later WOULD round, so treat the
-- reverse as a data change rather than a rollback.
--
-- The manual entry form in ingredient-manager.tsx is unchanged: it posts
-- whatever the user types and the column now stores more of it.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.ingredients
  ALTER COLUMN purchase_cost TYPE numeric(12, 4);

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Expect numeric_precision 12, numeric_scale 4:
--   SELECT column_name, numeric_precision, numeric_scale
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'ingredients'
--      AND column_name IN ('purchase_cost', 'receive_qty', 'yield_qty')
--    ORDER BY column_name;
--
-- Expect the same values as before, now with 4 decimals:
--   SELECT name, purchase_cost FROM public.ingredients
--    WHERE purchase_cost IS NOT NULL ORDER BY name LIMIT 5;
