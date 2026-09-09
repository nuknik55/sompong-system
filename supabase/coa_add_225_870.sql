-- Two new CoA accounts, decided 2026-09-10 for the budget69 monthly import.
--
-- Additive, safe to re-run: INSERT … ON CONFLICT (code) DO NOTHING. Touches
-- no existing row, no amount, no target_pct.
--
--   225 โบนัส              G200 ต้นทุนแรงงาน (Labor)
--     budget69 row "Bonus69" — ฿80,400, paid once a year. Nik chose a line of
--     its own over folding it into 220 เงินเดือนพนักงาน: a once-a-year payment
--     buried in a monthly salary line would make that month's labour look
--     ฿80k worse for no visible reason, and the P&L should say what it is.
--
--   870 Supply จัดเลี้ยง    G800 อุปกรณ์ (Supply)
--     budget69 rows "Supply - Catering Supplies" and the ซีเกท job lines
--     beneath it — ฿35,271 Jan–Jul. Catering is a recurring business line and
--     "what did catering cost" is a question Nik asks; 880 Supply อื่นๆ would
--     answer it with a mixed number.
--
--     WHY 870 AND NOT 850. accounting_migration.sql originally created six
--     G800 accounts that no longer exist in production — 815, 825, 830, 850
--     (Supply - ซ่อมบำรุง), 860 and 870 (Supply - Catering) — deleted through
--     the CoA screen at some point, with no entry ever posted to any of them.
--     870 was this exact account under its first name. Reinstating it keeps
--     the repo's history readable; putting catering on 850 would give a
--     retired code a second, different meaning.
--
-- ── sort_order IS NOT THE CODE NUMBER IN PRODUCTION ────────────────────────
--
-- The seed convention was code-as-sort_order, but the CoA screen's reorder
-- buttons have since renumbered: 220 sits at 280, 240 at 330, and G800 runs
-- 910–940. A literal 225 would land between 210 and 211; a literal 870 would
-- land before 810. So each row is placed relative to its live neighbour —
-- 225 just after 222, 870 just after 840 — by subquery, which stays right
-- however the screen has reordered things by the time this runs.
-- (group, sort_order) is unique in production today; +5 leaves room.
--
-- description is set here because these rows come from a migration, not the
-- UI — the ten UI-created accounts had to be documented after the fact
-- (coa_document_ui_created_accounts.sql). cost_behavior is left NULL on both,
-- inheriting the group header (G200 fixed, G800 fixed) like every neighbour;
-- whether a bonus is "fixed" is a question for the break-even work.

INSERT INTO public.coa (code, name, group_code, group_name, target_pct, sort_order, is_sensitive, description) VALUES
  ('225', 'โบนัส', 'G200', 'ต้นทุนแรงงาน (Labor)', NULL,
   (SELECT sort_order + 5 FROM public.coa WHERE code = '222'),
   false,
   'โบนัสพนักงาน จ่ายปีละครั้ง — แยกจากเงินเดือน (220) เพื่อให้เห็นว่าเดือนที่จ่ายต่างจากเดือนอื่นเพราะอะไร'),
  ('870', 'Supply จัดเลี้ยง', 'G800', 'อุปกรณ์ (Supply)', NULL,
   (SELECT sort_order + 5 FROM public.coa WHERE code = '840'),
   false,
   'อุปกรณ์และของใช้สำหรับงานจัดเลี้ยง/งานนอก เช่น จาน ถ้วย รถเข็น กล่องใส่ผัก — แยกจาก Supply อื่นๆ (880) เพราะงานจัดเลี้ยงเป็นธุรกิจอีกสายที่ต้องรู้ต้นทุน')
ON CONFLICT (code) DO NOTHING;

-- ─── Verification (run separately) ─────────────────────────────────────────
--   SELECT code, name, group_code, sort_order, is_sensitive, cost_behavior, description IS NOT NULL AS documented
--     FROM public.coa WHERE code IN ('222','225','230','840','870','880') ORDER BY group_code, sort_order;
--   -- expect 225 between 222 and 230, 870 between 840 and 880; both documented;
--   -- both cost_behavior NULL; both is_sensitive false
--
-- Account count went from 108 to 110:
--   SELECT count(*) FROM public.coa;
