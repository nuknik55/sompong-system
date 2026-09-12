-- Widen catering_events_deposit_percent_check to ALLOW 0. One constraint,
-- nothing else.
--
-- Run after catering_event_deposit_percent_migration.sql (which Nik has run).
-- Safe to re-run: drop-then-add.
--
-- ── WHY 0 IS NOW A VALUE ──────────────────────────────────────────────────
--
-- The original CHECK excluded 0 on the reasoning that "0 would assert no
-- deposit is due" — treating it as a mistake someone might type. Nik says it
-- is not a mistake: SOME JOBS CHARGE NO DEPOSIT, and that is an agreed term
-- like any other. So the field now has three states, and the documents print
-- them differently:
--
--   NULL   not yet discussed  -> the conditions print "______%" to write in
--   0      agreed: no deposit -> the deposit clause is OMITTED entirely —
--                                no "0%", no blank, no deposit row anywhere
--   1-100  agreed percent     -> the clause and the computed figure print
--
-- The distinction NULL vs 0 is the whole point of the column being nullable,
-- and it survives: NULL is a question nobody has answered, 0 is an answer.

BEGIN;

ALTER TABLE public.catering_events DROP CONSTRAINT IF EXISTS catering_events_deposit_percent_check;
ALTER TABLE public.catering_events
  ADD CONSTRAINT catering_events_deposit_percent_check
  CHECK (deposit_percent IS NULL OR (deposit_percent >= 0 AND deposit_percent <= 100));

COMMENT ON COLUMN public.catering_events.deposit_percent IS
  'Agreed deposit percentage for THIS event, 0 <= n <= 100. Negotiated per '
  'job, no default in the schema (the booking FORM pre-fills 30 on new '
  'bookings only). NULL = not yet agreed, prints as a blank to write in. '
  '0 = agreed no deposit, and every deposit clause and row is omitted from '
  'the printed documents. The amount actually received stays in '
  'deposit_amount.';

COMMIT;

-- ─── Verification (run separately) ─────────────────────────────────────────
--
-- Must now SUCCEED, then be rolled back:
--   -- BEGIN; UPDATE public.catering_events SET deposit_percent = 0; ROLLBACK;
--
-- Must still ERROR with 23514, writing nothing:
--   -- UPDATE public.catering_events SET deposit_percent = 101;
--   -- UPDATE public.catering_events SET deposit_percent = -1;
