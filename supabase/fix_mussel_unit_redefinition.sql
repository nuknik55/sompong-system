-- One-off correction: หอยแมลงภู่ (green mussel, half shell).
--
-- NOT part of the import path, and deliberately so. This is the case the
-- importer cannot fix by itself: the unit LABEL is unchanged while its MEANING
-- changed, so price, unit and yield have to move together in one deliberate
-- edit rather than through a preview checkbox.
--
-- ─── WHAT IS WRONG ─────────────────────────────────────────────────────────
-- Stored:  purchase_cost 2750.00  per "ลัง(แซนฟอร์ด)",  yield_qty 440 ตัว
--          -> 2750 / 440 = ฿6.2500 per mussel
--
-- The POS reports the SAME unit string "ลัง(แซนฟอร์ด)" for what is actually a
-- 1 kg box. Supplier order confirmation, 26/08/2026:
--
--     แชมฟอร์ด หอยแมลงภู่นิวซีแลนด์ครึ่งฝาแช่แข็ง ขนาด M 1 กก.
--     qty 5.00 x 269.00/EA = 1,345.00
--
-- so ฿269 is the price of ONE 1 kg box (Nik: "เป็นต่อ 1 กล่อง").
--
-- ─── EVIDENCE THAT ฿269 IS THE ROUTINE CASE ────────────────────────────────
-- Of the last 12 deliveries in pos_receipt_deliveries:
--     10 rows  qty 5  @ ฿1,345 = ฿269/unit   (also ฿259 and ฿279 variants)
--      2 rows  qty 1  @ ฿2,750 = ฿2,750/unit  (2026-06-03 and 2026-06-16)
-- The stored ฿2,750 came from those two rows. They are the anomalies; ฿269 is
-- what is actually bought, week after week, from the same vendor.
--
-- ─── THE YIELD FIGURE, AND ITS PROVENANCE ─────────────────────────────────
-- yield_qty must change with the price or the cost is understated 10.2x:
-- writing ฿269 against the old yield of 440 gives ฿0.61 per mussel, not ฿6.25.
--
-- 44 comes from the restaurant's own prior records of how many pieces are in a
-- 1 kg box. That is a real observation, independent of anything in this file.
--
-- It is corroborated to within 2% by a back-solve: 269 / 6.25 = 43.04, where
-- ฿6.25 is the per-mussel cost the system used before. Two unrelated routes
-- landing within 2% of each other is genuine corroboration.
--
-- 44 is used rather than 43.04 because of provenance, not precision. The
-- back-solve divides by ฿6.25, which comes from the 2750/440 pair — the pair
-- proved wrong in at least one component, so anything derived from it inherits
-- an unknown error. The records figure does not. Nothing material rides on the
-- choice: 269/44 = ฿6.1136 against 269/43 = ฿6.2558, a 2.3% difference. What
-- differs is which number can be defended a year from now.
--
-- Resulting change in per-mussel cost: ฿6.2500 -> ฿6.1136, i.e. -2.2%. Dishes
-- using mussels get very slightly cheaper, not 10x cheaper.
--
-- WHAT IS EVIDENCED BY WHAT:
--   price ฿269  -> supplier order confirmation 26/08/2026, and 10 of the last
--                  12 deliveries in pos_receipt_deliveries
--   yield 44    -> prior restaurant records, corroborated by back-solve
--   unit label  -> the invoice describes a 1 kg box, so "ลัง(แซนฟอร์ด)" is
--                  replaced by "กล่อง(1kg)"
--
-- Safe to re-run: it is idempotent on value, and the WHERE clause is by name.

BEGIN;

-- Guard: refuse to run if the row is not in the state this script expects,
-- so a second edit in between cannot be silently overwritten.
DO $$
DECLARE c NUMERIC; y NUMERIC; u TEXT;
BEGIN
  SELECT purchase_cost, yield_qty, purchase_unit_label
    INTO c, y, u
    FROM public.ingredients
   WHERE name = 'หอยแมลงภู่' AND is_prep = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ยกเลิก: ไม่พบวัตถุดิบ หอยแมลงภู่';
  END IF;

  -- Already corrected? Then this is a no-op re-run, which is fine.
  IF c = 269 AND y = 44 THEN
    RAISE NOTICE 'ข้อมูลถูกแก้ไว้แล้ว — ไม่มีอะไรต้องทำ';
    RETURN;
  END IF;

  IF c <> 2750 OR y <> 440 THEN
    RAISE EXCEPTION
      'ยกเลิก: คาดว่าจะพบ purchase_cost 2750 / yield_qty 440 แต่พบ % / % (หน่วย %) — ตรวจสอบก่อน',
      c, y, u;
  END IF;
END $$;

UPDATE public.ingredients
   SET purchase_cost      = 269,      -- confirmed: supplier invoice + 10 of 12 deliveries
       yield_qty          = 44,       -- prior records; see provenance note above
       purchase_unit_label = 'กล่อง(1kg)'  -- was "ลัง(แซนฟอร์ด)", which now means a box
 WHERE name = 'หอยแมลงภู่'
   AND is_prep = false
   AND purchase_cost = 2750;

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Expect 269 / 44 / กล่อง(1kg), and a per-mussel cost of ฿6.1136 — 2.2% below
-- the ฿6.2500 the system used before, so no dish cost should jump:
--
--   SELECT name,
--          purchase_cost,
--          purchase_unit_label,
--          receive_qty,
--          yield_qty,
--          usage_unit,
--          ROUND(purchase_cost * receive_qty / yield_qty, 4) AS cost_per_usage_unit
--     FROM public.ingredients
--    WHERE name = 'หอยแมลงภู่';
--
-- And confirm nothing else was touched:
--   SELECT count(*) FROM public.ingredients WHERE purchase_cost = 2750;
