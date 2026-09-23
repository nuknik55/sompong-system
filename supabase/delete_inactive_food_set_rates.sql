-- Delete the deactivated food_set rates from catering_rates.
--
-- BACKGROUND. food_set held โต๊ะจีน / buffet package prices. Food quoting moved
-- to per-event menus (charge_type 'food', linked via event_menu_id), so these 8
-- rows were deactivated but left in place. They still render on the settings
-- page as dead rows. Nik will build proper set menus with the chef later, from
-- scratch — these values are not the starting point for that.
--
-- SAFETY. Verified before writing this:
--   * No foreign key anywhere references catering_rates. Nothing can be orphaned.
--   * catering_event_charges snapshots label/unit_price at write time; it has no
--     rate_id column, so existing quotations are self-contained and unaffected.
--   * 0 of the 31 catering_event_charges rows carry a label matching any of the
--     8 food_set labels, so no historical quote even derives from them.
--   * All 8 food_set rows are already is_active = false. The other 20 rates
--     (delivery 8, drink 3, music 3, staff_bonus 3, room 3) are all active and
--     out of scope.
--
-- The guard below refuses to run if reality has drifted from that. It is a
-- transaction: if the assertion fails, the DELETE is rolled back.

BEGIN;

-- Guard 1: scope must match exactly 8 rows, all inactive.
DO $$
DECLARE
  n_scoped  int;
  n_active  int;
BEGIN
  SELECT count(*) INTO n_scoped
    FROM public.catering_rates
   WHERE rate_type = 'food_set' AND is_active = false;

  SELECT count(*) INTO n_active
    FROM public.catering_rates
   WHERE rate_type = 'food_set' AND is_active = true;

  IF n_scoped <> 8 THEN
    RAISE EXCEPTION 'ยกเลิก: คาดว่าจะลบ 8 แถว แต่พบ % แถว (rate_type=food_set, is_active=false)', n_scoped;
  END IF;

  IF n_active <> 0 THEN
    RAISE EXCEPTION 'ยกเลิก: พบ food_set ที่ยัง active อยู่ % แถว — ตรวจสอบก่อน', n_active;
  END IF;
END $$;

-- Guard 2: no quotation line may be derived from one of these labels.
DO $$
DECLARE n_refs int;
BEGIN
  SELECT count(*) INTO n_refs
    FROM public.catering_event_charges c
   WHERE c.label IN (SELECT label FROM public.catering_rates
                      WHERE rate_type = 'food_set' AND is_active = false);

  IF n_refs > 0 THEN
    RAISE EXCEPTION 'ยกเลิก: มี catering_event_charges % แถวที่ label ตรงกับ food_set — ตรวจสอบก่อนลบ', n_refs;
  END IF;
END $$;

DELETE FROM public.catering_rates
 WHERE rate_type = 'food_set'
   AND is_active = false;

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Expect zero rows:
--   SELECT * FROM public.catering_rates WHERE rate_type = 'food_set';
--
-- Expect the other 20 rates untouched (delivery 8, drink 3, music 3,
-- staff_bonus 3, room 3), all is_active = true:
--   SELECT rate_type, is_active, count(*)
--     FROM public.catering_rates GROUP BY 1, 2 ORDER BY 1;
--
-- Expect 31, unchanged:
--   SELECT count(*) FROM public.catering_event_charges;
