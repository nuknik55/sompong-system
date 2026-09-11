-- Drop public.catering_event_task_completions — the 12-task sales checklist's
-- table. Nothing in the application reads or writes it as of 665f458.
--
-- ── WHY IT IS GOING ───────────────────────────────────────────────────────
--
-- The checklist was a sales pipeline over weeks: รับข้อมูล, ออกใบเสนอราคา,
-- ยืนยัน+มัดจำ, นัดดูสถานที่, เตรียมงาน, โทรขอบคุณ. Nik's team does not use
-- it. What they DO fill in by hand is a 13-check pre-service sheet at the
-- venue on the day (ใบ CHECKLIST การจัดหน้างาน), and comparing the two item
-- by item found ZERO overlap — only "เก็บงาน + นับอุปกรณ์" is even adjacent,
-- and their version of that is a separate ~80-row equipment sheet. So this
-- was not a weak version of a paper form; it was a form nobody asked for.
--
-- The page, both server actions, the type and the template were deleted in
-- 24f393d + 665f458 (commit 3 of the catering reduction). Hiding it instead
-- would have left someone in six months wondering whether they were meant to
-- be filling it in, which is the whole reason the module went unused.
--
-- ── THE GUARD, AND WHY IT IS NOT CEREMONIAL ───────────────────────────────
--
-- The table held 0 rows when this file was written, and the deployed code no
-- longer writes it. But "0 rows now" is not "0 rows when Nik runs this": if
-- anyone ticks a box between then and now — an old tab still open on the
-- pre-deploy page, say — that tick is someone's work, and the drop should
-- STOP rather than discard it. Same shape as the guard on
-- drop_pos_coffee_items_migration.sql, for the same reason: a precondition
-- checked at run time, not at write time.
--
-- Run it, read the error if it fires, and decide deliberately.
--
-- ── SUPERSEDES ────────────────────────────────────────────────────────────
--
-- catering_task_checklist_migration.sql, which created this table. That file
-- stays as it ran; DO NOT re-run it after this one.

BEGIN;

DO $$
DECLARE n_rows int;
BEGIN
  SELECT count(*) INTO n_rows FROM public.catering_event_task_completions;
  IF n_rows <> 0 THEN
    RAISE EXCEPTION
      'ยกเลิก: ตาราง catering_event_task_completions มีข้อมูลอยู่ % แถว — ตรวจสอบก่อนว่าใครติ๊กไว้ แล้วจึงตัดสินใจ', n_rows;
  END IF;
END $$;

DROP TABLE public.catering_event_task_completions;

COMMIT;

-- ─── Verification (run separately) ─────────────────────────────────────────
--
-- BEFORE, to see what the guard will see:
--   SELECT count(*) FROM public.catering_event_task_completions;   -- expect 0
--
-- AFTER:
--   SELECT to_regclass('public.catering_event_task_completions');  -- expect NULL
--
-- The guard is not verified to fire, and is not claimed to be: its shape is
-- the one in drop_pos_coffee_items_migration.sql, which ran in production.
-- If the count above is not 0, the drop is refused and nothing is lost.
