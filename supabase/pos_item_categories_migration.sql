-- Per-item revenue category for the monthly POS import.
--
-- Purely additive: a new table. Nothing existing is renamed, altered or
-- dropped, so the currently deployed code keeps working unchanged while this
-- runs. Safe to re-run.
--
-- ── WHY A NEW TABLE RATHER THAN RENAMING pos_coffee_items ──────────────────
--
-- pos_coffee_items answers one question — "is this item the coffee shop's?" —
-- and the real domain needs five categories. The obvious move was to rename
-- and widen it. That was wrong, for a reason worth recording:
--
-- It would not have been a rename. It would have been a rename PLUS four
-- schema changes (boolean -> five-value column, a renamed carve-out column, a
-- dropped column, two rewritten CHECKs). Any deploy ordering therefore forced
-- a choice between a window where the deployed code points at a table that no
-- longer exists, or shipping code that tolerates BOTH schemas — two column
-- lists, two row mappings, two write payloads — in the path that computes
-- restaurant revenue, written to be deleted later by someone who remembers.
--
-- RENAME exists to preserve data. pos_coffee_items has ZERO rows (verified
-- against production: content-range */0). There is nothing to preserve, so
-- creating this table fresh costs nothing and removes the choice entirely:
--
--   1. run this            additive; old table and old code untouched
--   2. deploy the code     the table it points at already exists
--   3. drop the old table  empty and unreferenced by then
--
-- Safe in both directions, with no instruction anyone has to remember. The
-- orphan pos_coffee_items is queued for deletion in supabase/README.md so it
-- does not become permanent.
--
-- ── THE TWO DIMENSIONS, AND WHY ONLY ONE IS STORED ─────────────────────────
--
-- Every month the POS export is split along two axes:
--
--   CHANNEL   Eat In / อาหารห่อ / Lineman / Grab
--             NOT stored here. The raw export carries a channel on every item
--             row — verified on the August export, 777 lines, 0 missing — so
--             it is a group-by at read time, not a judgment.
--
--   CATEGORY  food / dessert / drink / coffee / other
--             Stored here. It cannot be derived from the POS categories, and
--             that is the entire reason this table exists. Examples that
--             defeat any category rule: several drinks the POS files under
--             เครื่องดื่ม are coffee-shop sales, and ข้าวเหนียวมูน sits in the
--             POS coffee category but is dessert revenue.
--
-- ── coffee_share_per_unit ──────────────────────────────────────────────────
--
-- One item belongs to two categories at once. ไอติมข้าวเหนียวมะม่วง sells at
-- 129: Nik books 15 to the coffee shop and 114 to desserts, and his own sheets
-- show it in BOTH at exactly those two prices.
--
-- So the column carves a per-unit amount OUT to the coffee shop, and the
-- remainder goes to this row's category. That item is category='dessert' with
-- coffee_share_per_unit=15 — not category='coffee' with a share, which would
-- strand the other 114 with nowhere to go.
--
-- A row whose category is already 'coffee' cannot carry a carve-out; the CHECK
-- below forbids it, because carving coffee out of coffee is meaningless and a
-- schema that permits a meaningless state will eventually contain one.
--
-- ── A MISSING ROW MEANS NOT YET REVIEWED ───────────────────────────────────
--
-- Not "assume food". This is the state that matters over time: the
-- classification is a sit-down job done once, after which nobody thinks about
-- it until the kitchen adds a menu item. If a new item silently inherited a
-- default, the revenue split would drift by exactly the amount nobody is
-- watching. Every reviewed item gets a row — including the ones that are not
-- coffee — which is what makes absence mean "new since the last review"
-- rather than "never got round to it".

CREATE TABLE IF NOT EXISTS public.pos_item_categories (
  -- The POS product name with any (Grab)/(LM)/(ห่อ) channel prefix already
  -- stripped, matching what parsePosMonthlyExport emits. One row covers an
  -- item however it was sold — which is correct, because the channel is a
  -- separate dimension read from the file.
  pos_product_name      TEXT        PRIMARY KEY,
  category              TEXT        NOT NULL,
  -- Baht per unit carved out to the coffee shop; the rest goes to `category`.
  -- NULL means none.
  coffee_share_per_unit NUMERIC(12,2),
  reviewed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by           UUID        REFERENCES public.profiles(id),

  CONSTRAINT pos_item_categories_category_check
    CHECK (category IN ('food','dessert','drink','coffee','other')),

  CONSTRAINT pos_item_categories_coffee_share_check
    CHECK (
      coffee_share_per_unit IS NULL
      OR (category <> 'coffee' AND coffee_share_per_unit > 0)
    )
);

COMMENT ON TABLE public.pos_item_categories IS
  'Per-item revenue category for the monthly POS import: food, dessert, drink, '
  'coffee, other. A row is a REVIEWED DECISION; a missing row means the item '
  'has not been reviewed yet and must be surfaced, not defaulted. CHANNEL '
  '(Eat In / อาหารห่อ / Lineman / Grab) is deliberately NOT stored here — the '
  'raw POS export carries it on every item row, so it is a group-by rather '
  'than a judgment.';

COMMENT ON COLUMN public.pos_item_categories.coffee_share_per_unit IS
  'Baht per unit carved OUT to the coffee shop, with the remainder going to '
  'this row''s category. NULL means none. Exists for one real case: '
  'ไอติมข้าวเหนียวมะม่วง sells at 129, of which 15 is the coffee shop''s and '
  '114 is dessert.';

ALTER TABLE public.pos_item_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_item_categories_select" ON public.pos_item_categories;
DROP POLICY IF EXISTS "pos_item_categories_all"    ON public.pos_item_categories;

-- Same shape as expense_entries: owner/admin only, read and write. This is
-- revenue-classification data and has no reason to be visible to staff.
CREATE POLICY "pos_item_categories_select" ON public.pos_item_categories FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "pos_item_categories_all" ON public.pos_item_categories FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── Verification (run separately) ─────────────────────────────────────────
-- Table exists and is empty:
--   SELECT count(*) FROM public.pos_item_categories;
--
-- Five columns, category NOT NULL, no is_coffee:
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='pos_item_categories'
--    ORDER BY ordinal_position;
--
-- Both policies present:
--   SELECT policyname FROM pg_policies
--    WHERE schemaname='public' AND tablename='pos_item_categories';
--
-- An unknown category must be rejected (expect 23514):
--   -- INSERT INTO public.pos_item_categories (pos_product_name, category)
--   -- VALUES ('probe1','snacks');
--
-- A coffee row must not carry a carve-out (expect 23514):
--   -- INSERT INTO public.pos_item_categories (pos_product_name, category, coffee_share_per_unit)
--   -- VALUES ('probe2','coffee',15);
--
-- A zero carve-out must be rejected — absent means none, 0 is a third way of
-- saying it (expect 23514):
--   -- INSERT INTO public.pos_item_categories (pos_product_name, category, coffee_share_per_unit)
--   -- VALUES ('probe3','dessert',0);
--
-- Both valid shapes accepted, then clean up:
--   -- INSERT INTO public.pos_item_categories (pos_product_name, category) VALUES ('probe4','coffee');
--   -- INSERT INTO public.pos_item_categories (pos_product_name, category, coffee_share_per_unit)
--   -- VALUES ('probe5','dessert',15);
--   -- DELETE FROM public.pos_item_categories WHERE pos_product_name LIKE 'probe%';
--
-- pos_coffee_items is NOT touched by this file and still exists. It is dropped
-- separately once the deploy has landed — see the queue in supabase/README.md.
