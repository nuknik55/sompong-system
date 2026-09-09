-- One-time seed: catering, set-menu and buffet products → category 'food'.
--
-- Decided by Nik 2026-09-10: "it is food being sold". Family sets, buffets,
-- อาหารชุด at every price point, the SEASET packs, the Ad- set add-ons, the
-- event deposit, and the music/electricity charges that ride on an event bill
-- all go to food. He chose the option that puts all of it in one place.
--
-- ── WHY THESE NEED A SEED AT ALL ───────────────────────────────────────────
--
-- pos_item_categories was seeded from August 2569, a month with no events.
-- Jan–Jul 2569 carry ฿1.95M of products with no row, and ฿1.2M of that is
-- these 26 names — January alone has Family1295 (฿156,695), บุฟเฟ่ต์ 1200
-- (฿144,000) and อาหารชุด3000 (฿108,000). They are not new dishes awaiting a
-- judgement; they are a product TYPE, and the decision is the same for every
-- one of them. Seeding them by name leaves ~343 genuine dishes across the
-- seven months for the classification screen, where each is a real choice.
--
-- ── THE DRINK-LIKE EVENT ITEMS → 'drink', decided separately ───────────────
--
-- Beer sold by the case and the mixer charges on event bills — 15 names,
-- ฿106,100 — were first held out of this file because Nik had not named them
-- and they are not food. He then decided them: beer by the case is beverage
-- revenue, a mixer charge is a drink charge. They are in the second block
-- below as 'drink'. Two decisions, two blocks, so the file shows which was
-- which.
--
-- ── ADDITIVE, SAFE TO RE-RUN ───────────────────────────────────────────────
--
-- Unlike seed_pos_item_categories.sql this does NOT refuse on a non-empty
-- table — it is adding to one. ON CONFLICT DO NOTHING means a name Nik has
-- since classified on the screen keeps HIS category, not this file's.
-- reviewed_by stays NULL: the provenance marker for "came from a seed, not a
-- person", exactly as the original seed.

INSERT INTO public.pos_item_categories (pos_product_name, category, coffee_share_per_unit) VALUES
  -- set menus and family packs (POS group อาหารชุด / Other)
  ('อาหารชุด3000',                    'food', NULL),
  ('อาหารชุด 3000',                   'food', NULL),
  ('อาหารชุด3500',                    'food', NULL),
  ('อาหารชุด4000',                    'food', NULL),
  ('อาหารชุด 4000',                   'food', NULL),
  ('อาหารชุด4500',                    'food', NULL),
  ('Family1295',                      'food', NULL),
  ('Family975',                       'food', NULL),
  ('Family725',                       'food', NULL),
  ('SEASET-เล็ก',                     'food', NULL),
  ('SEASET-ใหญ่',                     'food', NULL),
  -- buffets
  ('บุฟเฟ่ต์ 1200',                   'food', NULL),
  ('บุฟเฟ่ต์ 380',                    'food', NULL),
  ('บุฟเฟต์หัวละ380',                 'food', NULL),
  ('ค่าอาหารบุฟเฟต์',                 'food', NULL),
  -- set add-ons (Ad-)
  ('Ad-ปูนิ่มทอดกระเทียม',            'food', NULL),
  ('Ad-หอยเชลล์นึ่งกระเทียม',         'food', NULL),
  ('Ad-ยำถั่วพู(เล็ก)',               'food', NULL),
  ('Ad-ลูกชิ้นปลาภูเก็ตลวกจิ้ม',      'food', NULL),
  ('Ad-หมึกผัดผงกะหรี่',              'food', NULL),
  -- event deposits and event-bill charges Nik named explicitly
  ('มัดจำงานเลี้ยง',                  'food', NULL),
  ('มัดจำอุปกรณ์',                    'food', NULL),
  ('ดนตรีพร้อมผู้คุม',                'food', NULL),
  ('ค่าไฟลูกค้านำดนตรีเข้ามาเอง',     'food', NULL),
  ('ค่าไฟดนตรี',                      'food', NULL),
  ('ค่าไฟนำดนตรีเข้ามาใช้บริการร้าน', 'food', NULL)
ON CONFLICT (pos_product_name) DO NOTHING;

-- Drink-like event items → 'drink' (Nik, 2026-09-10). Jan–Jul gross in the
-- header; largest first.
INSERT INTO public.pos_item_categories (pos_product_name, category, coffee_share_per_unit) VALUES
  -- mixer charges
  ('ค่ามิกเซอร์บุฟเฟต์',              'drink', NULL),
  ('ค่ามิกซ์เซอร์เหมา',               'drink', NULL),
  ('ค่ามิกซ์เซอร์เหมา/หัว',           'drink', NULL),
  ('ค่ามิกเซอร์',                     'drink', NULL),
  ('มิกเชอร์เหมา',                    'drink', NULL),
  ('มิกเซอร์บุฟเฟต์ต่อเวลา',          'drink', NULL),
  ('เครื่องดื่มเหมา',                 'drink', NULL),
  -- beer by the case
  ('เบียร์สิงห์เหมาลัง',              'drink', NULL),
  ('โปรเบียร์สิงห์เหมา1ลัง',          'drink', NULL),
  ('เหมาเบียร์สิงห์',                 'drink', NULL),
  ('เบียร์สิงห์เหมา',                 'drink', NULL),
  ('เบียร์ไฮเน้นเก้นเหมาลัง',         'drink', NULL),
  ('โปรเบียร์ไฮเนเก้นเหมา1ลัง',       'drink', NULL),
  ('เหมาเบียร์ลีโอ1ลัง',              'drink', NULL),
  ('เหมาเบียร์ช้าง1ลัง',              'drink', NULL)
ON CONFLICT (pos_product_name) DO NOTHING;

-- ─── Verification (run separately) ─────────────────────────────────────────
-- 41 inserted on a first run (fewer on a re-run — the difference is names Nik
-- had already classified, and those keep his category):
--   SELECT category, count(*) FROM public.pos_item_categories
--    WHERE pos_product_name IN ('อาหารชุด3000','Family1295','บุฟเฟ่ต์ 1200','SEASET-เล็ก','มัดจำงานเลี้ยง',
--                               'ค่ามิกเซอร์บุฟเฟต์','เบียร์สิงห์เหมาลัง')
--      AND reviewed_by IS NULL
--    GROUP BY category;   -- expect food 5, drink 2
--
-- Table grew by at most 41 — was 523 (+ whatever the screen has added since):
--   SELECT count(*) FROM public.pos_item_categories;
