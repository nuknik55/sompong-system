-- Drop the orphaned pos_coffee_items table. README queue item 11.
--
-- ── WHY IT EXISTS, AND WHY IT IS EMPTY ─────────────────────────────────────
--
-- pos_coffee_items was created (pos_coffee_items_migration.sql) for a single
-- boolean question — "is this item the coffee shop's?" — and the domain turned
-- out to need six categories. It was replaced by pos_item_categories, created
-- FRESH rather than renamed, because RENAME exists to preserve data and this
-- table never held a row: additive migration first, deploy second, no window
-- where deployed code pointed at a table that did not exist. The cost of that
-- decision is this orphan. This file pays it.
--
-- pos_coffee_items_migration.sql stays in the repo untouched: an applied
-- migration keeps describing what actually executed.
--
-- ── PRECONDITIONS, VERIFIED AGAINST PRODUCTION 2026-09-09 16:12 ─────────────
--
--   rows        content-range */0 via PostgREST with count=exact — ZERO
--   code        no reference in src/, scripts/, .github/ with comments
--               stripped; the only executable mention is its own CREATE file
--   deploy      the last code that read it was replaced in 77877f9, live on
--               production since 2026-09-08 22:26 (Vercel deployment status)
--
-- The row check is repeated below AT RUN TIME, so a re-run months from now
-- cannot drop a table something has started writing to. The code check
-- cannot be repeated in SQL; if this file is being run long after the date
-- above, grep first.
--
-- ── WHAT THIS DOES NOT DO ──────────────────────────────────────────────────
--
-- No CASCADE. If anything depends on the table — a view, a foreign key, a
-- policy on another table — DROP fails with 2BP01 and nothing changes. That
-- is the intended outcome: a dependency nobody knows about needs
-- understanding, not cascading. The table's own RLS policies
-- (pos_coffee_items_select / pos_coffee_items_all) are dropped with it.

BEGIN;

DO $$
DECLARE
  n BIGINT;
BEGIN
  IF to_regclass('public.pos_coffee_items') IS NULL THEN
    RAISE NOTICE 'pos_coffee_items already gone — nothing to do';
    RETURN;
  END IF;

  SELECT count(*) INTO n FROM public.pos_coffee_items;
  IF n <> 0 THEN
    RAISE EXCEPTION
      'pos_coffee_items holds % row(s) but was expected to be empty. Something '
      'has written to the old table since 2026-09-09 — find out what before '
      'dropping. See supabase/README.md item 11.', n;
  END IF;
END $$;

DROP TABLE IF EXISTS public.pos_coffee_items;

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
--   SELECT to_regclass('public.pos_coffee_items');   -- expect NULL
--
-- And the replacement is untouched:
--   SELECT count(*) FROM public.pos_item_categories;  -- expect 523 or more
