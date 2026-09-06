-- Recode the vacuum sealer from Supply (810) to CapEx (992).
--
-- ONE-OFF data correction. Two rows. Reversible — the old value is 810.
--
-- WHY. The restaurant's rule is that a newly purchased, durable asset over
-- ฿20,000 is CapEx. The bookkeeper coded a ฿29,853 vacuum sealer to
-- 810 "Supply ครัว", which is consumables. It is the only miscode of its kind
-- in the database: of the 17 entries at or above ฿20,000, the other 16 are
-- consulting fees, social security, vegetable oil, crab, and security-guard
-- invoices — all correctly operating.
--
-- This matters more since 1f1d9bf, which stopped subtracting CapEx from
-- operating profit. While the sealer sits in G800 it is inflating August's
-- operating expenses by 30,130 baht and understating operating profit by the
-- same, which is exactly the distortion that change existed to remove.
--
-- ── The two rows ───────────────────────────────────────────────────────────
--
--   964c46c2…  2026-08-31  810  29,853.00  เครื่องซีลสูญากาศ   (the machine)
--   8df49910…  2026-08-31  810     277.00  ค่าส่งเครื่องซีล     (its delivery)
--
-- Both move. The freight follows the machine because acquisition cost is part
-- of the asset, and because leaving it behind strands a 277 baht delivery line
-- in Supply with nothing to say what it delivered.
--
-- Destination 992 "Asset Replacement - ครัว": kitchen equipment. It already
-- exists, so the coa_code foreign key holds.
--
-- Nothing else changes — amount, entry_date, supplier_id, payment_method,
-- bill_ref and note all stay as recorded. Only the account moves.
--
-- ── August is the first month recorded in this app ─────────────────────────
--
-- Do not widen this script. It touches two rows by primary key and is guarded
-- to abort if it finds anything other than those two in the expected state.

BEGIN;

DO $$
DECLARE
  matched INTEGER;
BEGIN
  SELECT count(*) INTO matched
    FROM public.expense_entries
   WHERE id IN ('964c46c2-6d74-4cc1-9a53-7751af785bc2',
                '8df49910-f7f8-422f-bd03-9c257adda347')
     AND coa_code = '810';

  IF matched <> 2 THEN
    RAISE EXCEPTION
      'ABORTED: expected 2 rows still coded 810, found %. They may already have '
      'been recoded, or edited. Nothing has been changed — check the two ids '
      'listed in this file before proceeding.', matched;
  END IF;
END $$;

UPDATE public.expense_entries
   SET coa_code = '992',
       updated_at = NOW()
 WHERE id IN ('964c46c2-6d74-4cc1-9a53-7751af785bc2',
              '8df49910-f7f8-422f-bd03-9c257adda347');

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Expect both rows on 992, totalling 30,130:
--   SELECT id, entry_date, coa_code, amount, note
--     FROM public.expense_entries
--    WHERE id IN ('964c46c2-6d74-4cc1-9a53-7751af785bc2',
--                 '8df49910-f7f8-422f-bd03-9c257adda347');
--
-- Expect August G800 to drop by 30,130 and G990 to rise by the same. On
-- /owner/accounting/summary?month=2026-08 the CapEx line below the operating
-- profit should read 30,130 where it previously read 0, and operating profit
-- should RISE by 30,130 — because CapEx is no longer subtracted.
