-- Which POS menu items belong to the coffee shop, and how much of each.
--
-- New table. Additive. Nothing existing is touched.
--
-- ── WHY THIS CANNOT BE A CATEGORY RULE ─────────────────────────────────────
--
-- The coffee shop is excluded from restaurant revenue. The obvious rule —
-- "everything in the POS group ร้านกาแฟ" — is permanently about 4,000 baht
-- wrong every month, and the reason is that coffee-shop membership is a
-- property of the ITEM, not of the POS category:
--
--   * Items the POS files under เครื่องดื่ม that are really coffee-shop sales:
--     (Grab)น้ำส้ม (คั้น), (LM)ทิมแทมปั่น, (LM)ชานม, (LM)มะนาวโซดา,
--     (LM)น้ำแตงโมปั่น, (LM)น้ำเก็กฮวยเย็น, (LM)/(Grab)พุดดิ้งมะพร้าวอ่อน
--   * Other :: Other is a free-text section staff type themselves, and it
--     contains coffee items — August 2569 had exactly one, คาปูชิโน่ร้อน 32
--   * ข้าวเหนียวมูน sits in ร้านกาแฟ :: ไอศครีม but is NOT coffee-shop revenue
--
-- ── THREE STATES, IN TWO COLUMNS ───────────────────────────────────────────
--
--   is_coffee = true,  share_per_unit NULL   the WHOLE line is coffee
--   is_coffee = true,  share_per_unit = 15   only 15 baht per unit is coffee
--   is_coffee = false                        not coffee, whatever its category
--
-- The middle state exists because one item genuinely splits:
-- ไอติมข้าวเหนียวมะม่วง sells at 129 and 15 of that is the ice cream, which is
-- the coffee shop's. A boolean cannot express that, which is why this is not
-- a boolean.
--
-- ── AND A FOURTH STATE THAT IS THE POINT: NO ROW AT ALL ────────────────────
--
-- A missing row means NOT YET REVIEWED — not "assume it is not coffee".
--
-- This is the state that matters over time. The classification is a sit-down
-- job done once; after that nobody thinks about it until the kitchen adds a
-- menu item. If a new item arrived and silently inherited a default, the
-- coffee exclusion would drift by exactly the amount nobody was looking at.
--
-- So the import must treat "no row" as a question, not an answer. Every item
-- shown during a review gets a row, including the ones marked not-coffee —
-- that is what makes absence mean "new since the last review" rather than
-- "never got round to it".
--
-- The 30% Grab / 26.75% LineMan platform commission on coffee items sold
-- through those channels is NOT stored here. It is a computation, the rates
-- differ per platform and change over time, and Sheet2 of every export
-- already carries them. See PosPaymentLine in src/lib/pos-parse.ts.

CREATE TABLE IF NOT EXISTS public.pos_coffee_items (
  -- The POS product name with any (Grab)/(LM)/(ห่อ) channel prefix already
  -- stripped, matching what parsePosMonthlyExport emits. One row covers an
  -- item however it was sold.
  pos_product_name TEXT        PRIMARY KEY,
  is_coffee        BOOLEAN     NOT NULL,
  -- Baht per unit attributable to the coffee shop. NULL with is_coffee = true
  -- means the whole line price. Must be NULL when is_coffee is false.
  share_per_unit   NUMERIC(12,2),
  reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by      UUID        REFERENCES public.profiles(id),

  CONSTRAINT pos_coffee_items_share_check CHECK (
    (is_coffee = false AND share_per_unit IS NULL)
    OR (is_coffee = true AND (share_per_unit IS NULL OR share_per_unit >= 0))
  )
);

COMMENT ON TABLE public.pos_coffee_items IS
  'Per-item coffee-shop classification for the monthly revenue import. A row '
  'is a REVIEWED DECISION; a missing row means the item has not been reviewed '
  'yet and must be surfaced, not defaulted.';

COMMENT ON COLUMN public.pos_coffee_items.share_per_unit IS
  'Baht per unit belonging to the coffee shop. NULL (with is_coffee) = the '
  'whole line. e.g. ไอติมข้าวเหนียวมะม่วง is 129 a unit of which 15 is coffee.';

ALTER TABLE public.pos_coffee_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_coffee_items_select" ON public.pos_coffee_items;
DROP POLICY IF EXISTS "pos_coffee_items_all"    ON public.pos_coffee_items;

-- Same shape as expense_entries: owner/admin only, both read and write. This
-- is revenue-classification data and has no reason to be visible to staff.
CREATE POLICY "pos_coffee_items_select" ON public.pos_coffee_items FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "pos_coffee_items_all" ON public.pos_coffee_items FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─── Verification (run separately) ─────────────────────────────────────────
-- Expect the table to exist and be empty:
--   SELECT count(*) FROM public.pos_coffee_items;
--
-- Expect the CHECK to reject a non-coffee item carrying a share (23514):
--   -- INSERT INTO public.pos_coffee_items (pos_product_name, is_coffee, share_per_unit)
--   -- VALUES ('probe', false, 10);
--
-- Expect both valid coffee shapes to be accepted:
--   -- INSERT INTO public.pos_coffee_items (pos_product_name, is_coffee) VALUES ('probe-whole', true);
--   -- INSERT INTO public.pos_coffee_items (pos_product_name, is_coffee, share_per_unit) VALUES ('probe-part', true, 15);
--   -- DELETE FROM public.pos_coffee_items WHERE pos_product_name LIKE 'probe%';
