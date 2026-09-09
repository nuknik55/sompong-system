-- Document the CoA accounts that were created through the UI and therefore
-- exist in production but in no migration file.
--
-- Safe to re-run. Sets `description` only — no INSERT, no account created, no
-- account renamed, no target_pct, no cost_behavior. Every clause is keyed on
-- `code`.
--
-- ── WHY THESE TEN ARE UNDOCUMENTED, AND WHY IT IS NOT AN OVERSIGHT ─────────
--
-- Comparing all 108 live CoA rows against every .sql file here: ten accounts
-- appear in production and in none of them. They were added through
-- /owner/accounting/coa, and `addCoaAccount` writes only code, name,
-- group_code, group_name, sort_order and is_sensitive. Every account created
-- that way is born with description NULL and cost_behavior NULL. The mechanism
-- guarantees the gap; it is not something anyone forgot.
--
-- All ten are in OPERATING groups, so all ten affect operating profit and the
-- cost ratios on /owner/accounting/summary. Between them they are not small:
-- 670 ถ่ายรูป ฿31,040 in August alone, 700 R&D ฿19,390 to date.
--
-- ── KEYED ON `code`, NEVER ON `name` ──────────────────────────────────────
--
-- `updateCoaAccount` lets a user change `name` and `target_pct`; it cannot
-- change `description`. So a migration may set description without re-asserting
-- a user-editable value (the target_pct lesson), but it must MATCH on the
-- primary key. coa_description_migration.sql matches on `WHERE name = '...'`
-- in all ten of its clauses — that file has already run and stays as it is,
-- but if anyone renames one of those accounts it silently stops matching on a
-- re-run. Do not copy that pattern.
--
-- ── FOUR CAME FROM NIK ────────────────────────────────────────────────────
--
-- A wrong description is worse than none: it is guidance the next person codes
-- entries by. Four accounts could not be derived from what had been posted,
-- and Nik answered all four. They are written below in his terms — 241 (event
-- costs, both halves of the name real), 380 (a daily recurring payment, not
-- the one-off the single entry suggested), 660 (the ChatGPT subscription the
-- entry notes implied), and the 125/126 boundary.
--
-- 125 and 126 are written to be unambiguous IN BOTH DIRECTIONS — each names
-- the other — because 126's own entries are all supplier-batch labels
-- ("วัตถุดิบ (ไหน)") that never say what was bought, so the description is the
-- only thing telling anyone where the line falls.
--
-- ── cost_behavior IS DELIBERATELY NOT SET HERE ────────────────────────────
--
-- Nothing in src/ reads cost_behavior yet; the break-even view is still
-- queued. One question has to be answered before it is built, and 998 is the
-- reason:
--
--   An account with cost_behavior NULL INHERITS ITS GROUP HEADER. G900 is
--   'fixed'. So 998 — money Sompong lays out for the coffee shop and gets
--   back — currently inherits 'fixed' and would enter the break-even
--   arithmetic as a restaurant fixed cost, about ฿3,600-4,100 a month.
--
-- NULL does not exclude an account; only NULL on a GROUP HEADER excludes a
-- group (that is why G950 Tax and G990 CapEx are out). Excluding 998 needs
-- either a third behaviour value (a CHECK change: today it permits only
-- NULL | fixed | variable) or a group of its own. Both are decisions for the
-- break-even work, not for a documentation migration. Recorded in
-- supabase/README.md.

UPDATE public.coa SET description =
  'ไข่ไก่เท่านั้น ซื้อเป็นแผง ราคาต่อแผงเปลี่ยนตามตลาด — '
  'ไข่ชนิดอื่น (ไข่เป็ด ไข่เค็ม เยี่ยวม้า) ลง 126'
 WHERE code = '125';

UPDATE public.coa SET description =
  'ไข่ทุกชนิดที่ไม่ใช่ไข่ไก่ — ไข่เป็ด ไข่เค็ม เยี่ยวม้า — ไข่ไก่ลง 125'
 WHERE code = '126';

UPDATE public.coa SET description =
  'ต้นทุนของฝากที่ซื้อสำเร็จมาขายต่อ เช่น ทองม้วน ขนมผิง คอนเฟลกคาราเมล น้ำพริก '
  'เม็ดมะม่วง — ไม่ใช่ของที่ครัวทำเอง เป็นคู่ต้นทุนของรายได้หมวดของฝาก '
  '(pos_item_categories category = souvenir)'
 WHERE code = '174';

UPDATE public.coa SET description =
  'ค่าเช่าโต๊ะเวลาจัดงาน และบางครั้งจ้างดนตรีมาเล่น — เป็นค่าใช้จ่ายของงานจัดเลี้ยง '
  'ทั้งสองอย่างตามชื่อหมวด'
 WHERE code = '241';

UPDATE public.coa SET description =
  'จ่ายค่าตำรวจที่เข้ามาตรวจร้านทุกวัน เป็นรายจ่ายประจำ ไม่ใช่ครั้งเดียว'
 WHERE code = '380';

UPDATE public.coa SET description =
  'ค่าสมาชิก ChatGPT'
 WHERE code = '660';

UPDATE public.coa SET description =
  'ค่าจ้างถ่ายภาพอาหารและทำกราฟฟิกสำหรับงานการตลาด'
 WHERE code = '670';

UPDATE public.coa SET description =
  'วัตถุดิบและอุปกรณ์สำหรับทดลองสูตรและพัฒนาเมนูใหม่ รวมค่าเทสอาหาร '
  'เช่น แป้ง เนย น้ำมะพร้าว แม่พิมพ์ขนม'
 WHERE code = '700';

UPDATE public.coa SET description =
  'ของที่ร้านสมพงษ์ออกเงินซื้อให้ร้านกาแฟไปก่อน แล้วร้านกาแฟคืนเงินตอนสิ้นเดือน '
  'ไม่ใช่ต้นทุนของร้านอาหาร เงินที่คืนมาอยู่รวมในยอด "อื่นๆ" ที่ฝ่ายบัญชีส่งมา '
  'ระบบนี้จึงไม่หักกลบให้ และตั้งใจไม่แก้ — ดู supabase/README.md'
 WHERE code = '998';

UPDATE public.coa SET description =
  'ที่พักรายการที่ยังไม่รู้ว่าเข้าหมวดไหน ต้องย้ายออกให้หมด '
  'ยอดที่ค้างอยู่ในหมวดนี้คือรายการที่รอจัดหมวด ไม่ใช่ค่าใช้จ่ายจริงของหมวด "อื่นๆ"'
 WHERE code = '999';

-- ─── Verification (run separately) ─────────────────────────────────────────
-- All ten described:
--   SELECT code, name, description IS NOT NULL AS documented
--     FROM public.coa
--    WHERE code IN ('125','126','174','241','380','660','670','700','998','999')
--    ORDER BY code;
--
-- Nothing else changed — this must be 13 + 10 = 23:
--   SELECT count(*) FROM public.coa WHERE description IS NOT NULL;
--
-- ── TWO POSTED ENTRIES TO REVIEW, NOT MOVED BY THIS FILE ───────────────────
--
-- Deliberately not touched: relocating a posted expense between COGS accounts
-- is Nik's call in the UI, not something a migration does unattended. See
-- supabase/README.md for the detail. Both are from the บิลพี่สมหมาย period:
--
--   2026-07-21  ฿385  in 130 ของแห้ง   "…, เยี่ยวม้า (1*385)"  → belongs in 126
--   2026-07-22  ฿40   in 125 ไข่ไก่     "วัตถุดิบร้าน (ไหน)"     → possibly 126
