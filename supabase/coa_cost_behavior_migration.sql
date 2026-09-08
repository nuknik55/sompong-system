-- Add coa.cost_behavior (fixed / variable).
--
-- Purely additive, and genuinely safe to re-run: one new column, one CHECK, and
-- UPDATEs that write the same classification every time. No expense_entries
-- touched — August 2569 is the first month recorded in this app and nothing
-- here alters a recorded amount.
--
-- This file DELIBERATELY does not change coa.target_pct. An earlier draft set
-- G100's target to 43 here, which would have made "safe to re-run" false:
-- target_pct is user-editable at /owner/accounting/coa, so a re-run would have
-- silently reset a figure someone had since tuned. A migration should not
-- re-assert a value the application lets a human change.
--
-- WHY. Break-even analysis needs every cost classified fixed or variable.
-- Nik's own Cost Structure workbook already does this per line, and this brings
-- that classification into the system so it can be computed rather than
-- re-derived in Excel each month.
--
-- ── The resolution rule ────────────────────────────────────────────────────
--
-- ONE nullable column, set on group headers and overridden on accounts:
--
--     an account uses its own cost_behavior;
--     if that is NULL it inherits its group header's.
--
-- Two columns (one for groups, one for accounts) was considered and rejected:
-- it allows a group and its account to disagree with no rule saying which wins.
-- A single column with a documented fallback cannot express a contradiction.
--
-- ── Why labour is the only group split per account ─────────────────────────
--
-- Labour is the second-largest cost block at roughly 20% of revenue, and it
-- genuinely splits: permanent salaries do not move with covers, while
-- part-time, service charge and attendance bonus do. Misclassifying the block
-- whole would move break-even by hundreds of thousands of baht.
--
-- Every other group is classified whole. They split imperfectly too, but not by
-- enough to shift break-even more than the extra bookkeeping would cost.
--
-- G950 (Tax) and G990 (CapEx) are deliberately left NULL: they are already
-- excluded from operating expenses, and giving them a behaviour would imply
-- they belong in the break-even arithmetic. They do not.

ALTER TABLE public.coa ADD COLUMN IF NOT EXISTS cost_behavior TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.coa'::regclass
       AND conname = 'coa_cost_behavior_check'
  ) THEN
    ALTER TABLE public.coa
      ADD CONSTRAINT coa_cost_behavior_check
      CHECK (cost_behavior IS NULL OR cost_behavior IN ('fixed','variable'));
  END IF;
END $$;

COMMENT ON COLUMN public.coa.cost_behavior IS
  'fixed | variable, for break-even analysis. Set on group headers; set on an '
  'account ONLY where it differs from its group. An account with NULL inherits '
  'its group header. NULL on a group header means the group is excluded from '
  'break-even entirely (G950 Tax, G990 CapEx).';

-- ── Group-level defaults ───────────────────────────────────────────────────
UPDATE public.coa SET cost_behavior = 'variable' WHERE code IN ('G100','G750');
UPDATE public.coa SET cost_behavior = 'fixed'
 WHERE code IN ('G200','G300','G400','G500','G600','G700','G800','G900');
UPDATE public.coa SET cost_behavior = NULL WHERE code IN ('G950','G990');

-- ── Account-level overrides: G200 labour ───────────────────────────────────
-- Variable: everything paid per shift or per sale.
UPDATE public.coa SET cost_behavior = 'variable'
 WHERE code IN ('210','211','212','213','214','215','216','222');
-- Fixed: salaried staff, their meals, and statutory social security.
UPDATE public.coa SET cost_behavior = 'fixed'
 WHERE code IN ('220','221','230','231','240');

-- ── Account-level overrides: G600 marketing ────────────────────────────────
-- Discount and give-away marketing scale with sales; the rest are committed
-- spend that does not.
UPDATE public.coa SET cost_behavior = 'variable' WHERE code IN ('650','630');

-- ─── Verification (run separately) ─────────────────────────────────────────
-- Every group header classified except the two non-operating ones:
--   SELECT code, name, cost_behavior FROM public.coa
--    WHERE group_code IS NULL ORDER BY code;
--   -- expect G950, G990 NULL; the other ten set
--
-- The 13 G200 accounts, split 8 variable / 5 fixed:
--   SELECT code, name, cost_behavior FROM public.coa
--    WHERE group_code = 'G200' ORDER BY code;
--
-- target_pct is NOT touched by this file. G100's COGS target is changed
-- through the app at /owner/accounting/coa, not here.
