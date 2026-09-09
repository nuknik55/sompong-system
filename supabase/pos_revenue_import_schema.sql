-- Schema for the unified POS revenue import: two widened CHECKs, one new
-- table, one partial unique index.
--
-- Additive and safe to re-run. Writes no business data: no revenue row, no
-- expense entry, no amount anywhere is changed by this file.
--
-- ── 1. monthly_revenue.revenue_type GAINS TWO VALUES ──────────────────────
--
-- 'souvenir' and 'pos_other'. Seven types, six of which the import owns and
-- one — 'other' — which it must never touch.
--
--   food · drink · dessert · souvenir · pos_other   dine-in, by category
--   delivery                                        every non-coffee Grab/LM line
--   other                                           NOT the import's
--
-- 'other' is compiled by the outsourced accountant and the in-house
-- bookkeeper, who hand Nik one total that he types in. It mixes scrap sales,
-- used-oil sales and the coffee-shop reimbursement. The app deliberately does
-- not decompose or correct it — see README, "The coffee-shop reimbursement".
--
-- 'pos_other' exists BECAUSE 'other' is off limits. The POS group อื่นๆ
-- (ค่าทำ/ค่าห้อง, เพิ่มราคา, raw materials sold on) is ฿19,150 in August 2569
-- and has to land somewhere: dropping it would understate revenue and break
-- the import's own sum check. Folding it into 'other' would write into the
-- accountants' box. So it gets its own line, displayed as อื่นๆ (POS) beside
-- อื่นๆ (บัญชี).
--
-- ── 2. expense_entries.payment_method GAINS 'accrual' ─────────────────────
--
-- THIS ONE IS OPERATIONAL, NOT COSMETIC. payment_method is not a label on a
-- past event; it drives what Nik actually pays:
--
--   cash      already settled
--   transfer  NOT yet paid — a TO-PAY LIST. Twice a week he gathers
--             everything marked transfer and sends the money.
--
-- Platform GP is withheld by Grab and LineMan before the payout ever reaches
-- him, and a discount moves no money at all. Booking either as 'transfer'
-- would put about ฿162,000 a month of never-owed money onto that list — a
-- wrong instruction to send money, not a wrong-looking total.
--
-- 'accrual' means: recorded as a cost, nothing to pay. The UI labels it in
-- those terms (ไม่ต้องจ่าย / หักไปแล้ว), not with the accounting word.
--
-- Consequence, and it is correct rather than broken: a day carrying one of
-- these entries has cash + transfer LESS than the day's total. The daily
-- screen labels that difference instead of hiding it.
--
-- ── 3. pos_revenue_imports ────────────────────────────────────────────────
--
-- One row per imported month. Answers "where did this month's revenue come
-- from" months later, and drives the revenue form: for an imported month the
-- six import-owned boxes render read-only, while 'other' stays editable
-- always. A month never imported keeps all boxes editable exactly as today.
--
-- ── 4. THE PARTIAL UNIQUE INDEX IS THE IDEMPOTENCY GUARANTEE ──────────────
--
-- The import owns exactly three expense entries per month, keyed by bill_ref:
-- POS-DISCOUNT-YYYY-MM, POS-GP-LM-YYYY-MM, POS-GP-GRAB-YYYY-MM. A re-run
-- deletes that set and writes the current one, so a second run of the same
-- file is byte-identical and a second run of a corrected file leaves no
-- orphan.
--
-- The index makes a duplicate impossible rather than merely unintended. It is
-- PARTIAL — only rows whose bill_ref starts with 'POS-' — because bill_ref is
-- a free-text field for hand entry where two entries legitimately share a
-- bill. Verified before writing this: 1,552 expense entries exist and NONE of
-- them uses bill_ref, so the index cannot fail on existing data and cannot
-- collide with anything Nik has typed.

BEGIN;

-- ── 1. revenue_type ───────────────────────────────────────────────────────
-- Drop every CHECK on the table that mentions revenue_type, whatever it is
-- named. The original was declared inline in CREATE TABLE, so its name is
-- whatever Postgres generated; matching on the definition is robust where
-- guessing the name is not.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.monthly_revenue'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%revenue_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.monthly_revenue DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.monthly_revenue
  ADD CONSTRAINT monthly_revenue_revenue_type_check
  CHECK (revenue_type IN ('food','drink','dessert','delivery','souvenir','pos_other','other'));

COMMENT ON COLUMN public.monthly_revenue.revenue_type IS
  'food | drink | dessert | souvenir | pos_other — dine-in, by item category; '
  'delivery — every non-coffee Grab/LineMan line; other — compiled by the '
  'accountants and hand-entered, THE IMPORT MUST NEVER WRITE IT. Coffee-shop '
  'sales are excluded entirely and appear in no type.';

-- ── 2. payment_method ─────────────────────────────────────────────────────
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.expense_entries'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%payment_method%'
  LOOP
    EXECUTE format('ALTER TABLE public.expense_entries DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.expense_entries
  ADD CONSTRAINT expense_entries_payment_method_check
  CHECK (payment_method IN ('cash','transfer','accrual'));

COMMENT ON COLUMN public.expense_entries.payment_method IS
  'cash = already settled. transfer = NOT yet paid, a to-pay list Nik works '
  'through twice a week. accrual = a real cost with nothing to pay: platform '
  'GP withheld before payout, and POS discounts, where no money moves. Never '
  'mark an accrual entry transfer — it would become an instruction to send '
  'money that is not owed.';

-- ── 3. pos_revenue_imports ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_revenue_imports (
  year_month       TEXT        PRIMARY KEY,
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by      UUID        REFERENCES public.profiles(id),
  source_file      TEXT,
  -- The export's own Sheet3 gross, and that figure less the coffee side.
  -- Kept so a later reader can check what the month was imported from without
  -- the file.
  gross_total      NUMERIC(14,2) NOT NULL,
  restaurant_gross NUMERIC(14,2) NOT NULL
);

COMMENT ON TABLE public.pos_revenue_imports IS
  'One row per month imported from a POS export. Provenance, and the signal '
  'that makes the six import-owned revenue boxes read-only for that month.';

ALTER TABLE public.pos_revenue_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pos_revenue_imports_select" ON public.pos_revenue_imports;
DROP POLICY IF EXISTS "pos_revenue_imports_all"    ON public.pos_revenue_imports;

CREATE POLICY "pos_revenue_imports_select" ON public.pos_revenue_imports FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "pos_revenue_imports_all"    ON public.pos_revenue_imports FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ── 4. bill_ref uniqueness, for POS keys only ─────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS expense_entries_pos_bill_ref_uniq
  ON public.expense_entries (bill_ref)
  WHERE bill_ref LIKE 'POS-%';

COMMIT;

-- ─── Verification (run separately after COMMIT) ────────────────────────────
-- Seven revenue types:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.monthly_revenue'::regclass
--      AND conname='monthly_revenue_revenue_type_check';
--
-- Three payment methods:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='public.expense_entries'::regclass
--      AND conname='expense_entries_payment_method_check';
--
-- Existing data untouched — 10 revenue rows, 1,552 entries, still only
-- cash and transfer in use:
--   SELECT (SELECT count(*) FROM public.monthly_revenue)                  AS revenue_rows,
--          (SELECT count(*) FROM public.expense_entries)                  AS entries,
--          (SELECT count(*) FROM public.expense_entries
--            WHERE payment_method NOT IN ('cash','transfer'))             AS non_cash_transfer,
--          (SELECT count(*) FROM public.pos_revenue_imports)              AS imports;
--   -- expect 10 | 1552 | 0 | 0
--
-- The index exists and is partial:
--   SELECT indexdef FROM pg_indexes
--    WHERE schemaname='public' AND indexname='expense_entries_pos_bill_ref_uniq';
