-- catering_set_menu_items gains a SECTION. One column. A0 of the catering
-- document work, and the only schema change the three documents need.
--
-- Run after catering_migration.sql. Safe to re-run: the ADD is guarded, the
-- CHECK is dropped before it is added, and nothing existing is rewritten.
--
-- ── WHY ───────────────────────────────────────────────────────────────────
--
-- All three documents Nik's team uses group a package's food the same way:
-- the package's dishes, then ขนมหวาน, then เครื่องดื่ม, then รายการแถมฟรี
-- (ข้าวหอมมะลิ / ขนมจีน / น้ำเปล่า / น้ำแข็ง). That grouping cannot be derived
-- from what exists, and this was checked rather than assumed:
--
--   * menus.category is a KITCHEN-STATION taxonomy — ปลา, หมึก กุ้ง, ยำ, ผัก,
--     ต้มยำ แกง, กับแกล้ม, อาหารจานเดียว, ปู กั้ง, หอย, อีสานสุดแซ่บ,
--     จานร้อน หม้อไฟ, เมนูใหม่, ของหวาน. Only 2 of 239 menus carry ของหวาน.
--   * There is NO เครื่องดื่ม category in menus at all.
--
-- ── WHY IT BELONGS ON THIS ROW AND NOT ON menus ───────────────────────────
--
-- Because it is a property of the row IN THIS PACKAGE, not of the dish. The
-- same ขนมจีน can be a free item in one package and a listed dish in another;
-- the same ข้าวเหนียวมะม่วง can be the dessert of one set and a paid dish of
-- the next. A column on menus would force one answer for every package.
--
-- ── WHAT THIS FILE DELIBERATELY DOES NOT ADD ──────────────────────────────
--
-- An earlier draft also made menu_id nullable and added a `label` column, so
-- น้ำเปล่า and น้ำแข็ง could sit in a package without existing as menus rows.
-- That is reversed, and the reason is recorded here so nobody re-adds it:
--
-- Nik wants TRUE CATERING COST, to know which jobs make money. A labelled row
-- is uncostable by construction — that was the whole point of it: no menus row
-- to join to, so no recipe, so no cost. It would make the four free items the
-- only lines on the sheet whose cost can never be known. They are free to the
-- CUSTOMER, not to the restaurant.
--
-- And there is nothing to work around. All four already exist as costed
-- ingredients: น้ำแข็ง / น้ำแข็งบด / น้ำแข็งหลอด, น้ำเปล่า(พลาสติก) /
-- น้ำเปล่า(ขวดแก้ว), ข้าวสารขาย, ขนมจีน. So each is an ordinary menus row with
-- a one-line recipe and a real unit cost. selling_price 0 is already
-- expressible — five menus rows carry it today.
--
-- The one objection that survived — that such rows would then distort Menu
-- Engineering — is answered by the catering flag on menus, which is needed
-- anyway for the (จีน)-prefixed catering dishes. One exclusion, both problems.
--
-- Consequence for this file: menu_id stays NOT NULL, and every row still joins
-- to a dish. The event cost page's expansion therefore picks up the free
-- items' cost automatically, with no change to it.
--
-- ── THE PRINT CONTRACT, STATED HERE BECAUSE THE DATA IMPLIES IT ───────────
--
-- A section with no rows prints NOTHING — no heading, no empty row, on any of
-- the three documents. A package with no dessert is a package with no dessert,
-- not a document with a blank ขนมหวาน line. Enforced in each print component.
--
-- The set-menu EDITOR is the opposite, deliberately: it shows all four
-- headings always, so there is a place to add the first dessert to a package
-- that has none. Missing is visible where you fix it, absent where you print.

BEGIN;

-- DEFAULT 'dish' so the 13 existing rows keep exactly the meaning they have
-- today: they are the package's dishes.
ALTER TABLE public.catering_set_menu_items
  ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT 'dish';

ALTER TABLE public.catering_set_menu_items DROP CONSTRAINT IF EXISTS catering_set_menu_items_section_check;
ALTER TABLE public.catering_set_menu_items
  ADD CONSTRAINT catering_set_menu_items_section_check
  CHECK (section IN ('dish', 'dessert', 'drink', 'free'));

COMMENT ON COLUMN public.catering_set_menu_items.section IS
  'Which group this row prints under on the quote, the service function sheet '
  'and the kitchen function sheet: dish | dessert | drink | free. A section '
  'with no rows prints nothing at all — no heading. It is a property of the '
  'row in this package, not of the dish: the same item can be free in one set '
  'and a listed dish in another.';

COMMIT;

-- ─── Verification (run separately) ─────────────────────────────────────────
--
--   SELECT column_name, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='catering_set_menu_items'
--      AND column_name IN ('section','menu_id')
--    ORDER BY column_name;
--   -- section: NO, 'dish'::text | menu_id: NO
--
--   SELECT section, count(*) FROM public.catering_set_menu_items GROUP BY section;
--   -- expect exactly one row: dish | 13     (every existing row, meaning unchanged)
--
-- The CHECK, proven to refuse rather than assumed to. Expected to ERROR with
-- 23514, and it writes nothing:
--   -- INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, section)
--   --   SELECT s.id, m.id, 1, 'beverage' FROM public.catering_set_menus s, public.menus m LIMIT 1;
--   --   … 'beverage' is not one of the four
