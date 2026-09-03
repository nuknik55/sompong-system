-- Add pos_receipt_deliveries.date_precision.
--
-- WHY. 1,647 deliveries were dropped at import because their DocumentDate cell
-- was empty — 3,312 of 3,322 raw rows have nothing in it, so there is no date
-- to parse. But the document number carries the period:
--
--     001DR042568/000323
--          ││││││
--          └┴┴┴┴┴─ month 04, Buddhist year 2568  ->  April 2025
--
-- That mapping was verified against every dated row in the table: the document
-- number's month and year agree with document_date on 22,715 of 22,715, i.e.
-- 100.0%. So the MONTH is recoverable exactly. The DAY is not recoverable at
-- all.
--
-- WHAT THIS COLUMN IS FOR. Recovered rows store document_date as the 1st of
-- their month. That day is a PLACEHOLDER, not an estimate — we do not believe
-- the delivery happened on the 1st, we simply need a valid DATE to store. This
-- column is what keeps that honest.
--
-- Without it, a fabricated day is indistinguishable from a measured one, and a
-- reader a year from now cannot tell which rows are trustworthy to the day.
-- That is the same failure mode as writing a back-solved yield next to a
-- measured price: a number that looks exactly as authoritative as a real one.
--
--   'day'   — document_date came from the report's own DocumentDate cell.
--             True for all 22,809 existing rows.
--   'month' — only the month is known; the day is a placeholder.
--
-- HOW THE PRICING RULE USES IT. A month-precision row is admitted to the
-- 90-day pricing window only when its WHOLE month falls inside that window, so
-- the unknown day cannot decide membership. It is also sorted after
-- day-precision rows at an equal date, so a placeholder never wins a recency
-- tiebreak. See src/lib/pos-pricing.ts.
--
-- NOT backfilled to anything but 'day': every existing row came from a real
-- DocumentDate and is accurate to the day.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.pos_receipt_deliveries
  ADD COLUMN IF NOT EXISTS date_precision TEXT NOT NULL DEFAULT 'day';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.pos_receipt_deliveries'::regclass
       AND conname = 'pos_receipt_deliveries_date_precision_check'
  ) THEN
    ALTER TABLE public.pos_receipt_deliveries
      ADD CONSTRAINT pos_receipt_deliveries_date_precision_check
      CHECK (date_precision IN ('day', 'month'));
  END IF;
END $$;

-- The pricing window reads by date and now also filters on precision.
CREATE INDEX IF NOT EXISTS pos_receipt_deliveries_precision_date_idx
  ON public.pos_receipt_deliveries (date_precision, document_date);

COMMENT ON COLUMN public.pos_receipt_deliveries.date_precision IS
  'day = document_date is exact. month = only month/year known (recovered from '
  'the document number); the day is a PLACEHOLDER of 1, not an estimate.';

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Expect one row: date_precision, text, NO (not null), default 'day'::text
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='pos_receipt_deliveries'
--      AND column_name='date_precision';
--
-- Expect every existing row to be 'day' and none to be 'month' yet:
--   SELECT date_precision, count(*)
--     FROM public.pos_receipt_deliveries GROUP BY 1;
--
-- Expect the CHECK to reject anything else:
--   -- should raise 23514
--   -- UPDATE public.pos_receipt_deliveries SET date_precision = 'week'
--   --  WHERE id = (SELECT id FROM public.pos_receipt_deliveries LIMIT 1);
