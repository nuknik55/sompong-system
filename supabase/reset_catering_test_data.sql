-- Clear the catering test data and reset the quote-number counter.
--
-- ONE-OFF. Not a schema change. Destructive and not reversible — read the
-- scope below before running, and do not run it twice.
--
-- WHY. All 8 catering events in production are test data: Nik confirms none
-- was sent to a customer. Two of the five issued quote numbers are also
-- mislabelled — QSP-IN6908-003 and QSP-IN6908-005 are offsite events carrying
-- the in-house "IN" prefix, because issueCateringQuote() hardcoded it. Rather
-- than rename two numbers that nobody outside the system has seen, the test
-- data goes and the first real quote starts clean at 001 under the fixed
-- generator.
--
-- ── SCOPE: the 8 events this deletes ───────────────────────────────────────
--
--   2026-08-20  QSP-IN6908-001  in_house  inquiry           aa
--   2026-08-24  (no quote)      in_house  inquiry           กกกก
--   2026-08-24  QSP-IN6908-002  in_house  inquiry           ฟฟฟ
--   2026-08-25  QSP-IN6908-004  in_house  done              test
--   2026-08-28  (no quote)      in_house  confirmed         พี่ไก่
--   2026-08-28  QSP-IN6908-005  offsite   awaiting_deposit  พานาโซนิค
--   2026-09-01  (no quote)      in_house  awaiting_deposit  aiatest
--   2026-09-04  QSP-IN6908-003  offsite   inquiry           kureha
--
-- ── SCOPE: the 104 child rows that cascade with them ───────────────────────
--
-- Every FK into catering_events is ON DELETE CASCADE, so these go
-- automatically. Counts measured 2026-09-03:
--
--   catering_event_activity_log       46
--   catering_event_charges            31
--   catering_event_menus              17
--   catering_event_task_completions    7
--   catering_event_labor               2
--   catering_event_cost_snapshots      1   (QSP-IN6908-004, which is cost-locked)
--   catering_event_staff               0
--                                    ---
--                                    104
--
-- ── SCOPE: what this deliberately does NOT touch ───────────────────────────
--
--   catering_customers        9 rows — KEPT. Nik has not called these
--                             disposable, they break nothing by remaining,
--                             and deleting them would be scope creep on an
--                             already-destructive operation. They simply end
--                             up with no events.
--   catering_set_menus        3 rows — KEPT. Configuration Nik built
--   catering_set_menu_items  14 rows   (e.g. ชุดงานนอก 3000), not test data.
--
-- Nothing outside the catering module reads any of this: a grep of
-- catering_events across src/ returns no hits outside owner/catering/, and
-- the only accounting -> catering link is a code import of daysInMonth, a
-- date utility with no data dependency.
--
-- ── The sequence reset, and a trap ─────────────────────────────────────────
--
-- catering_quote_sequences holds one row: {yymm: '6908', last_seq: 5}.
-- Deleting it makes next_catering_quote_seq()'s ON CONFLICT insert recreate
-- the counter at 1, so the first real quote is 001.
--
-- DO NOT inspect or "test" next_catering_quote_seq() by calling it. It is
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING — calling it ALLOCATES a
-- number and increments the counter. A probe of it earlier in this project
-- wrote a junk row that had to be deleted afterwards. Read
-- catering_quote_sequences directly instead; it is a plain table.
--
-- The counter keeps its current shape. Nik chose a SHARED counter per yymm
-- with both prefixes drawing from it, so no composite-key migration is
-- needed and this reset does not have to wait for one.
--
-- ── Guard ──────────────────────────────────────────────────────────────────
--
-- The whole thing is one transaction and aborts unless it finds exactly the
-- 8 events described above. If someone books a real event before this runs,
-- the count changes, the DO block raises, and NOTHING is deleted. Re-read
-- the scope and decide deliberately rather than editing the number.

BEGIN;

DO $$
DECLARE
  event_count INTEGER;
BEGIN
  SELECT count(*) INTO event_count FROM public.catering_events;

  IF event_count <> 8 THEN
    RAISE EXCEPTION
      'ABORTED: expected exactly 8 catering_events (the documented test set), found %. '
      'A real event may have been created since this script was written. '
      'Nothing has been deleted. Re-read the scope block at the top of this file '
      'and decide deliberately — do not simply change the 8.',
      event_count;
  END IF;
END $$;

-- The 104 child rows go with these, via ON DELETE CASCADE.
DELETE FROM public.catering_events;

-- Recreated at 1 by next_catering_quote_seq()'s ON CONFLICT insert, so the
-- first real quote is 001. Not an UPDATE to 0: an absent row and a zeroed row
-- behave identically here, and DELETE leaves no stale month behind.
DELETE FROM public.catering_quote_sequences;

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
--
-- All four expect 0:
--   SELECT count(*) FROM public.catering_events;
--   SELECT count(*) FROM public.catering_event_charges;
--   SELECT count(*) FROM public.catering_event_menus;
--   SELECT count(*) FROM public.catering_quote_sequences;
--
-- These must be UNCHANGED — 9, 3, 14:
--   SELECT count(*) FROM public.catering_customers;
--   SELECT count(*) FROM public.catering_set_menus;
--   SELECT count(*) FROM public.catering_set_menu_items;
--
-- Do NOT verify the counter by calling next_catering_quote_seq(). Issue a
-- real quote through the UI when you are ready; it should be 001.
