-- Add coa.description — plain-language guidance for the person coding entries.
--
-- Additive, nullable, safe to re-run. No existing data is touched.
--
-- WHY. The app gives the bookkeeper an account NAME and nothing else. The
-- restaurant's own rules for which account something belongs to are not simple,
-- and two criteria operate at once:
--
--   * new-vs-replacement decides Supply / Maintenance / CapEx
--   * a 20,000 baht threshold escalates Maintenance -> CapEx
--   * with an explicit exception: tablecloths and crockery stay Supply above
--     20,000 because they break and go missing
--
-- That dual test is very likely why a 29,853 baht vacuum sealer was coded to
-- 810 Supply ครัว instead of 992. See recode_vacuum_sealer_to_capex.sql.
--
-- WHAT THIS DOES NOT SOLVE. Only 13 descriptions exist in the bookkeeper's
-- workbook, and 810 Supply ครัว — the account actually miscoded — is not one of
-- them. Neither are the other three Supply accounts, nor 992 itself. The 13
-- below are worth having, but the descriptions that would have prevented the
-- known error still need writing. Two of the 13 (ค่าอุปกรณ์ซ่อม and
-- ซื้อของเพื่อทดแทน) sit exactly on the Maintenance/CapEx boundary, which shows
-- the shape a good description takes.
--
-- Populated by explicit code, not a name join, so a later rename cannot
-- silently attach a description to the wrong account.

ALTER TABLE public.coa ADD COLUMN IF NOT EXISTS description TEXT;

COMMENT ON COLUMN public.coa.description IS
  'Plain-language guidance shown to whoever is coding an entry: what belongs in '
  'this account and what does not. Sourced from the bookkeeper''s workbook. '
  'NULL means nobody has written one yet, which is the case for most accounts.';

UPDATE public.coa SET description = 'ผักทั่วไปรวมหัวหอม ขิง ข่า กะทิป้าณี เส้นใหญ่'                     WHERE name = 'ผักสด';
UPDATE public.coa SET description = 'สัตว์ต่างๆ'                                                        WHERE name = 'ของสด';
UPDATE public.coa SET description = 'เครื่องปรุง เครื่องเทศ ผงต่างๆ กะทิกล่อง กระเทียม หอมเจียว'        WHERE name = 'ของแห้ง';
UPDATE public.coa SET description = 'กะทิเฉพาะข้าวเหนียวมะม่วง'                                          WHERE name LIKE 'กะทิ%';
UPDATE public.coa SET description = 'ข้าวสารขาย'                                                        WHERE name = 'ข้าวสาร';
UPDATE public.coa SET description = 'ถุงพลาสติกใส่อาหาร กล่องใส่อาหาร — ของที่เอาให้ลูกค้า'              WHERE name LIKE 'วัสดุหีบห่อ-กล่อง%';
UPDATE public.coa SET description = 'ถุงที่เอาไว้แพ็ควัตถุดิบ'                                            WHERE name LIKE 'วัสดุหีบห่อ-ถุงซีล%';
UPDATE public.coa SET description = 'ค่าเรียกรถส่งอาหารถึงลูกค้า ทั้ง grab และพนักงานร้าน'                WHERE name = 'ค่าขนส่ง (ส่งลูกค้า)';
UPDATE public.coa SET description = 'ค่าส่งวัตถุดิบต่างๆ เช่น ค่าส่งเนื้อปู'                              WHERE name = 'ค่าขนส่งวัตถุดิบ';
UPDATE public.coa SET description = 'ของแจกพนักงาน น้ำแดง m100 งานสังสรรค์ เสื้อพนักงาน'                 WHERE name = 'สวัสดิการอื่นๆ';
UPDATE public.coa SET description = 'ของที่ซื้อมาเพื่อซ่อม อะไหล่ต่างๆ'                                   WHERE name = 'ค่าอุปกรณ์ซ่อม';
UPDATE public.coa SET description = 'ซื้อของใหม่มาเปลี่ยนของเก่า'                                        WHERE name = 'ซื้อของเพื่อทดแทน';
UPDATE public.coa SET description = 'ค่าทางด่วน ค่าซ่อม ค่าน้ำมัน ที่เกี่ยวกับการใช้รถที่ร้าน'            WHERE name = 'ค่าใช้จ่ายยานพาหนะ';

-- ─── Verification (run separately) ─────────────────────────────────────────
-- Expect 11-13 rows depending on which account names exist:
--   SELECT code, name, description FROM public.coa
--    WHERE description IS NOT NULL ORDER BY code;
--
-- These four SHOULD still be NULL — they are the ones worth writing next:
--   SELECT code, name FROM public.coa
--    WHERE code IN ('810','820','840','880','992') ORDER BY code;
