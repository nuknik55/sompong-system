-- Add 'souvenir' to pos_item_categories.category — six values, not five.
--
-- Safe to re-run. Does not touch any row: the table is empty, verified against
-- production immediately before writing this file (content-range */0).
--
-- ── WHY A SECOND FILE ──────────────────────────────────────────────────────
--
-- pos_item_categories_migration.sql has already run. An applied migration must
-- keep describing what actually executed, so the CHECK is widened here rather
-- than edited there.
--
-- ── THE CHECK CANNOT BE WIDENED IN PLACE ───────────────────────────────────
--
-- Postgres has no ALTER CONSTRAINT that rewrites a CHECK expression. A CHECK
-- can only be dropped and recreated. On a populated table that means a full
-- validation scan of every row (or ADD ... NOT VALID followed by VALIDATE
-- CONSTRAINT to avoid a long lock). Here the table is empty, so the drop and
-- recreate are instantaneous and cannot fail on existing data — which is the
-- cheapest this change will ever be.
--
-- ── WHY ของฝาก IS ITS OWN CATEGORY ─────────────────────────────────────────
--
-- The POS group กลุ่มของฝาก is 15 products, ฿5,539 in August 2569: nine
-- confections (ทองม้วน, ขนมผิง, คอนเฟลกคาราเมล, มะพร้าวอบกรอบ …), five jars of
-- น้ำพริก, and cashews. What unites them is not what they are but how they are
-- procured — BOUGHT FINISHED FOR RESALE, not cooked. That is what separates
-- them from both dessert and kitchen food.
--
-- It was nearly folded into 'other' on materiality: ฿5,539 is 0.14% of
-- revenue. Two things overruled that.
--
--   * 'other' holds ค่าทำ/ค่าห้อง, เพิ่มราคา and raw materials. Adding ของฝาก
--     makes a single ฿19,039 line out of four unrelated things, and the
--     question Nik could not answer — "how much did ของฝาก sell?" — stays
--     unanswerable. A named line that mixes four things is not visibility.
--   * Nik's own definition of อื่นๆ is "things with no distinct cost, or
--     unrelated". ของฝาก has a real cost: the purchase price. It fails that
--     definition on its face.
--
-- And it is not costless to defer. All 15 products currently sit inside his
-- อาหาร sheet, so ฿5,539 of bought-for-resale goods is inside the food COGS
-- denominator he actually uses. The split is a correction, not just a report.
--
-- ── ONE NAMED EXCEPTION LIVES IN THE SEED, NOT HERE ────────────────────────
--
-- ขนมบ้าบิ่น and (โปร) ขนมบ้าบิ่น 2 ชิ้น are in this POS group but are booked
-- as dessert — a per-item decision overriding the group default, which is what
-- per-item classification is for. That belongs in the seed script's exception
-- list where it is auditable, not in a CHECK constraint.
--
-- After that exception, souvenir holds ฿3,024 of the group's ฿5,539.

-- Drop first so this file re-runs cleanly. The constraint is recreated below;
-- between these two statements the column is briefly unconstrained, which is
-- why the whole thing is one transaction.
BEGIN;

ALTER TABLE public.pos_item_categories
  DROP CONSTRAINT IF EXISTS pos_item_categories_category_check;

ALTER TABLE public.pos_item_categories
  ADD CONSTRAINT pos_item_categories_category_check
  CHECK (category IN ('food','dessert','drink','coffee','souvenir','other'));

COMMENT ON COLUMN public.pos_item_categories.category IS
  'food | dessert | drink | coffee | souvenir | other. souvenir (ของฝาก) is '
  'goods bought finished for resale — confectionery, น้ำพริก, packaged items — '
  'which is neither kitchen-produced food nor dessert, and would otherwise sit '
  'inside the food COGS denominator. Displayed as ของฝาก.';

-- Provenance. The one-time seed (seed_pos_item_categories.sql) deliberately
-- does not set reviewed_by, so a seeded row is NULL here while a row a human
-- classified on the screen carries their UUID. It is the only way to tell the
-- two apart later. Do not backfill it.
COMMENT ON COLUMN public.pos_item_categories.reviewed_by IS
  'Who classified this row on the screen. NULL means the row came from the '
  'one-time seed (seed_pos_item_categories.sql) rather than from a person — '
  'the only provenance marker there is, so never backfill it.';

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- The constraint should now list six values:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.pos_item_categories'::regclass
--      AND conname = 'pos_item_categories_category_check';
--
-- souvenir must be accepted:
--   -- INSERT INTO public.pos_item_categories (pos_product_name, category)
--   -- VALUES ('probe1','souvenir');
--
-- An unknown value must still be rejected (expect 23514):
--   -- INSERT INTO public.pos_item_categories (pos_product_name, category)
--   -- VALUES ('probe2','retail');
--
-- The carve-out CHECK is untouched and must still reject a coffee row that
-- carries one (expect 23514):
--   -- INSERT INTO public.pos_item_categories (pos_product_name, category, coffee_share_per_unit)
--   -- VALUES ('probe3','coffee',15);
--
--   -- DELETE FROM public.pos_item_categories WHERE pos_product_name LIKE 'probe%';
--
-- Still empty afterwards:
--   SELECT count(*) FROM public.pos_item_categories;  -- expect 0
