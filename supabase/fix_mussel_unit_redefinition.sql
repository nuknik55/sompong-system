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
-- ─── !! DO NOT RUN THIS YET !! ─────────────────────────────────────────────
--
-- The PRICE below is evidenced. The YIELD below is NOT — it is a placeholder
-- pending a physical count, and running this before that count lands would
-- write an unevidenced number into every dish that uses mussels.
--
-- Nik counts the pieces in one 1 kg box; that number replaces the 43. Only
-- then does this run.
--
-- ─── THE YIELD FIGURE, AND WHICH BASIS IT USES ─────────────────────────────
-- yield_qty must change with the price or the cost is understated 10.2x:
-- writing ฿269 against yield 440 gives ฿0.61 per mussel instead of ฿6.25.
--
-- 43 is a PLACEHOLDER derived by back-solve, NOT evidence of anything:
--     269 / 6.25 = 43.04  ->  43,  giving 269 / 43 = ฿6.2558 per mussel,
--     which preserves the old ฿6.2500.
--
-- ** It back-solves from the 2750/440 pair, and that pair is exactly what we
--    just proved wrong. ** At least one of its two components was incorrect;
--    deriving the missing component from the same discredited pair carries any
--    error in it straight through, silently. Getting 43.06 from the 10.22x
--    ratio instead is the SAME back-solve by another route — two routes to one
--    assumption is not corroboration.
--
-- What IS evidenced: the price. ฿269 per 1 kg box, from the supplier's own
-- confirmation and from 10 of the last 12 deliveries.
-- What is NOT evidenced: how many mussels are in a 1 kg box. Nothing in the
-- delivery data, the invoice, or the stored row answers that.
--
-- SO: this file must not run until Nik has physically counted one box. If the
-- true count is 38 rather than 43, the per-mussel cost is ฿7.08 instead of
-- ฿6.26 — a 13% error on every dish using mussels, written silently and
-- looking exactly as authoritative as a correct number would.
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
  IF c = 269 AND y = 43 THEN
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
       yield_qty          = 43,       -- <<< PLACEHOLDER. Replace with the counted
       purchase_unit_label = 'กล่อง(1kg)'  -- was "ลัง(แซนฟอร์ด)", which now means a box
 WHERE name = 'หอยแมลงภู่'
   AND is_prep = false
   AND purchase_cost = 2750;

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Expect 269 / 43 / กล่อง(1kg), and a per-mussel cost of ฿6.2558 — within 0.1%
-- of the ฿6.2500 the system used before, so no dish cost should jump:
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
