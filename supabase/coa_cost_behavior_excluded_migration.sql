-- cost_behavior gains a third value, 'excluded', and 998 ร้านกาแฟ takes it.
--
-- Run after coa_cost_behavior_migration.sql. Safe to re-run: the CHECK is
-- replaced with the same definition, and the UPDATE writes the same value.
--
-- ── WHY ───────────────────────────────────────────────────────────────────
--
-- The break-even page classifies every operating cost fixed or variable and
-- excludes a GROUP by leaving its header NULL (G950 Tax, G990 CapEx). That
-- rule has no way to exclude ONE ACCOUNT: an account with NULL inherits its
-- header, so 998 ร้านกาแฟ — the coffee-shop purchases the shop reimburses
-- through monthly_revenue.other, deliberately kept in the ledger (README,
-- "The coffee-shop reimbursement") — inherits `fixed` from G900 and would
-- enter break-even as a restaurant fixed cost. It is neither fixed nor
-- variable; it is money that comes back. Nik's decision, 2026-09-10:
-- EXCLUDED. August 2569: ฿3,614, so the arithmetic barely moves, but the
-- kind was wrong.
--
-- ── THE RULE, NOW COMPLETE ────────────────────────────────────────────────
--
--     an account uses its own cost_behavior;
--     NULL inherits the group header;
--     'excluded' is explicit and is NEVER inherited — a group header cannot
--     be 'excluded' (a group is excluded by NULL, as before), and an
--     'excluded' account is left out whatever its group says.
--
-- This SUPERSEDES the "cost_behavior deliberately not set" paragraph in the
-- header of coa_document_ui_created_accounts.sql, which recorded that 998
-- inherited fixed and that the decision waited for the break-even work. That
-- file stays as it ran; the README records the supersession.

BEGIN;

ALTER TABLE public.coa DROP CONSTRAINT IF EXISTS coa_cost_behavior_check;
ALTER TABLE public.coa
  ADD CONSTRAINT coa_cost_behavior_check
  CHECK (cost_behavior IS NULL OR cost_behavior IN ('fixed','variable','excluded'));

-- Group headers are excluded by NULL, never by 'excluded'. Enforced, not
-- documented: a header marked 'excluded' would read as a rule the resolver
-- does not have.
ALTER TABLE public.coa DROP CONSTRAINT IF EXISTS coa_cost_behavior_header_check;
ALTER TABLE public.coa
  ADD CONSTRAINT coa_cost_behavior_header_check
  CHECK (group_code IS NOT NULL OR cost_behavior IS DISTINCT FROM 'excluded');

UPDATE public.coa SET cost_behavior = 'excluded' WHERE code = '998';

COMMENT ON COLUMN public.coa.cost_behavior IS
  'fixed | variable | excluded, for break-even analysis. Set on group headers '
  '(fixed/variable only); set on an account ONLY where it differs from its '
  'group. An account with NULL inherits its group header. NULL on a group '
  'header means the group is excluded from break-even entirely (G950 Tax, '
  'G990 CapEx). ''excluded'' on an account is explicit and never inherited: '
  'the account is left out whatever its group says (998 ร้านกาแฟ, reimbursed '
  'money, neither fixed nor variable).';

COMMIT;

-- ─── Verification (run separately) ─────────────────────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.coa'::regclass AND conname='coa_cost_behavior_check';
--   -- expect the three values
--   SELECT code, name, group_code, cost_behavior FROM public.coa WHERE cost_behavior = 'excluded';
--   -- expect exactly one row: 998
--   -- A header cannot be excluded (expect ERROR 23514, state unchanged):
--   -- UPDATE public.coa SET cost_behavior = 'excluded' WHERE code = 'G900';
