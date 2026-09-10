-- The outsourced-accountant import (69-08.xlsx and its successors):
-- provenance table, idempotency index, and the function that writes one
-- month atomically.
--
-- ── WHAT THIS IMPORT IS ────────────────────────────────────────────────────
--
-- From August 2569 the source of the monthly-billed costs is the outsourced
-- accountant's file, not budget69. Sheet รับ-จ่าย<yy> holds, per month, a
-- daily table, a รวม row, a card-fee cell, a receipts block, the cash-paid
-- block (หักจ่ายสด …), a blank row, and THE MONTHLY BLOCK (ค่าแรงพนักงาน …
-- รวมคชจ.). The caller parses it (src/lib/outsource.ts) and sends the monthly
-- block plus the card fee; this function only validates and stores.
--
-- The month sheet (มค.<yy> …) contributes ONE cell, F7 รายได้อื่นๆ, which is
-- written to monthly_revenue.other. This import OWNS `other`: it is the
-- accountants' figure and this is their file. The POS revenue import still
-- never touches it.
--
-- ── THE FIGURES ARE WRITTEN IN FULL, NOT BY REMAINDER ──────────────────────
--
-- Unlike budget69, no daily entries are subtracted. The file's own
-- arithmetic — รวมคชจ. = หักจ่ายสด + Σ(monthly block), to the baht in nine
-- of nine months — makes the monthly figures distinct from the cash-paid
-- ones, and the app's daily entries ARE the cash-paid side. Three labels
-- occur in both blocks (ค่าแรงพนักงาน, ค่าอาหารพนักงาน, ค่าเช่า); the caller
-- takes the monthly one, located structurally, never by first match.
-- Accepted and named: ค่าภ.ง.ด.1 (฿10–20/month) sits in the cash-paid block
-- and reaches 952 as a daily entry, so 952 carries it twice-over by ฿10.
--
-- ── WHAT THE CALLER CANNOT DO, BY CONSTRUCTION ────────────────────────────
--
--   1. Only the allowlisted codes can be written — the 13 the file produces
--      today plus 953/955, which Nik named for the months they appear.
--      Everything else is refused, which makes these unreachable by name:
--        650/752/753  POS-owned (discount, GP)
--        230/231      ค่าประกันสังคม — in the cash-paid block, already a
--                     daily entry (Aug 2569: 231 = 36,360, exactly the file).
--                     The preview shows it as a check row; never written.
--        998          the coffee-shop reimbursement, deliberately not in
--                     the ledger (see README). จ่ายคืนร้านกาแฟ is likewise
--                     shown and never written: revenue already excludes
--                     coffee, booking the return would double-count.
--   2. A month owned by budget69 (a row in budget69_imports) accepts ONLY
--      `other`: p_entries must be empty. Jan–Jul 2569 keep their B69 lumps;
--      this fills the `other` budget69 never set. The reverse direction —
--      budget69 re-importing a month that has OUT lumps — is refused in the
--      server action, not here; the page offers one source per month.
--   3. payment_method is always 'accrual', supplier_id always NULL, and
--      entry_date is always the 1st — the same three reasons as budget69:
--      nothing to pay, off the transfer slip (which filters on supplier_id),
--      and the incomplete-month marker clears on a 1st-dated entry.
--   4. A sensitive account (790 เงินเดือนเจ้าของร้าน) can be written ONLY by
--      the owner. The server action is requireOwner; this is the second lock.
--   5. `other` is required, not optional. A month whose F7 the parser could
--      not locate is a named stop in the preview, never a zero here.
--
-- ── RE-IMPORT: ONE RULE ────────────────────────────────────────────────────
--
-- Deletes every OUT-…-<month> entry, inserts the current set, upserts
-- `other`. A re-run of the same figures is byte-identical; a corrected file
-- replaces cleanly; a line that disappears from the block loses its row.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outsource_imports (
  year_month        TEXT        PRIMARY KEY,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by       UUID        REFERENCES public.profiles(id),
  source_file       TEXT,
  -- Σ of the monthly block as the file states it (excluding จ่ายคืนร้านกาแฟ),
  -- plus the card fee; and Σ of what was written. Equal unless the month is
  -- budget69-owned, where written_total is 0 and only `other` landed.
  block_total       NUMERIC(14,2) NOT NULL,
  written_total     NUMERIC(14,2) NOT NULL,
  entries           INTEGER       NOT NULL,
  other_amount      NUMERIC(14,2) NOT NULL,
  -- FALSE for a budget69-owned month: the expenses stayed budget69's.
  expenses_written  BOOLEAN       NOT NULL
);

COMMENT ON TABLE public.outsource_imports IS
  'One row per month imported from the outsourced accountant''s file '
  '(69-08.xlsx …). Provenance for the OUT- monthly lumps and for '
  'monthly_revenue.other; evidence the start-of-month checklist reads.';

ALTER TABLE public.outsource_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outsource_imports_select" ON public.outsource_imports;
DROP POLICY IF EXISTS "outsource_imports_all"    ON public.outsource_imports;
CREATE POLICY "outsource_imports_select" ON public.outsource_imports FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "outsource_imports_all"    ON public.outsource_imports FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner');

-- Idempotency, enforced. Its own prefix and its own index: three importers,
-- three owners, and a shared index would hide which one wrote a row.
CREATE UNIQUE INDEX IF NOT EXISTS expense_entries_out_bill_ref_uniq
  ON public.expense_entries (bill_ref)
  WHERE bill_ref LIKE 'OUT-%';

COMMIT;

CREATE OR REPLACE FUNCTION public.import_outsource_month(
  p_year_month   TEXT,
  -- [{"coa_code":"220","amount":604970,"note":"…"}, ...] — the monthly
  -- block in full plus the card fee; zero-amount rows omitted by the caller.
  -- MUST be empty for a budget69-owned month.
  p_entries      JSONB,
  -- F7 of the month sheet. 0 is a real value (มีค.69). NULL is refused.
  p_other        NUMERIC,
  p_source_file  TEXT,
  p_block_total  NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  -- The only codes this file can produce. Adding a label to the caller's map
  -- that maps to a code outside this list is refused here until the list is
  -- extended deliberately.
  allowed     TEXT[] := ARRAY['220','221','225','310','520','530','710','745',
                              '790','951','952','953','954','955','959'];
  r           JSONB;
  v_code      TEXT;
  v_sensitive BOOLEAN;
  v_role      TEXT;
  v_date      DATE;
  v_b69       BOOLEAN;
  n_entries   INT;
  deleted_n   INT;
  inserted_n  INT := 0;
BEGIN
  IF p_year_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'year_month must be YYYY-MM, got %', p_year_month;
  END IF;
  IF p_other IS NULL THEN
    RAISE EXCEPTION 'other (F7 รายได้อื่นๆ) is required — a month whose F7 was not located is a stop, not a zero';
  END IF;
  IF p_other < 0 THEN
    RAISE EXCEPTION 'other must not be negative, got %', p_other;
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a JSON array';
  END IF;
  n_entries := jsonb_array_length(p_entries);
  v_date := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  -- ── A budget69-owned month takes `other` only ───────────────────────────
  SELECT EXISTS (SELECT 1 FROM public.budget69_imports WHERE year_month = p_year_month) INTO v_b69;
  IF v_b69 AND n_entries > 0 THEN
    RAISE EXCEPTION 'month % is owned by the budget69 import — the outsource file may write only `other` for it (send an empty entries array)', p_year_month;
  END IF;

  -- ── Validate everything before deleting anything ────────────────────────
  FOR r IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_code := r->>'coa_code';
    IF NOT (v_code = ANY(allowed)) THEN
      RAISE EXCEPTION 'coa_code % is not one the outsource file may write (allowlist: %)', v_code, array_to_string(allowed, ',');
    END IF;
    SELECT is_sensitive INTO v_sensitive FROM public.coa WHERE code = v_code AND group_code IS NOT NULL;
    IF v_sensitive IS NULL THEN
      RAISE EXCEPTION 'coa_code % is not an account (unknown, or a group header)', v_code;
    END IF;
    IF v_sensitive AND v_role IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'coa_code % is owner-only', v_code;
    END IF;
    IF (r->>'amount') IS NULL OR (r->>'amount')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'amount for % must be positive (zero rows are omitted by the caller)', v_code;
    END IF;
  END LOOP;

  -- ── Replace this month's lumps ──────────────────────────────────────────
  DELETE FROM public.expense_entries
   WHERE bill_ref LIKE 'OUT-%-' || p_year_month;
  GET DIAGNOSTICS deleted_n = ROW_COUNT;

  FOR r IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    INSERT INTO public.expense_entries
      (entry_date, coa_code, amount, note, detail, bill_ref, payment_method, supplier_id, created_by)
    VALUES
      (v_date, r->>'coa_code', (r->>'amount')::NUMERIC,
       r->>'note', r->>'note',
       'OUT-' || (r->>'coa_code') || '-' || p_year_month,
       -- Not parameters. See point 3 in the header.
       'accrual', NULL, auth.uid());
    inserted_n := inserted_n + 1;
  END LOOP;

  -- ── `other`: this import owns it ────────────────────────────────────────
  INSERT INTO public.monthly_revenue (year_month, revenue_type, amount)
  VALUES (p_year_month, 'other', p_other)
  ON CONFLICT (year_month, revenue_type) DO UPDATE SET amount = EXCLUDED.amount;

  INSERT INTO public.outsource_imports
    (year_month, imported_at, imported_by, source_file, block_total, written_total, entries, other_amount, expenses_written)
  VALUES
    (p_year_month, NOW(), auth.uid(), p_source_file, p_block_total,
     (SELECT COALESCE(SUM((e->>'amount')::NUMERIC), 0) FROM jsonb_array_elements(p_entries) e),
     inserted_n, p_other, NOT v_b69)
  ON CONFLICT (year_month) DO UPDATE SET
    imported_at = NOW(), imported_by = auth.uid(), source_file = EXCLUDED.source_file,
    block_total = EXCLUDED.block_total, written_total = EXCLUDED.written_total,
    entries = EXCLUDED.entries, other_amount = EXCLUDED.other_amount,
    expenses_written = EXCLUDED.expenses_written;

  RETURN jsonb_build_object(
    'year_month', p_year_month, 'deleted', deleted_n, 'inserted', inserted_n,
    'other', p_other, 'budget69_owned', v_b69, 'was_reimport', deleted_n > 0
  );
END $$;

COMMENT ON FUNCTION public.import_outsource_month IS
  'Writes one month from the outsourced accountant''s file atomically: the '
  'monthly block and card fee as OUT-…-<month> lumps (allowlisted codes '
  'only, sensitive codes owner-only, accrual, no supplier, dated the 1st) and '
  'monthly_revenue.other. A budget69-owned month accepts only `other`.';

REVOKE ALL ON FUNCTION public.import_outsource_month FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_outsource_month TO authenticated;

-- ─── Verification (run separately) ─────────────────────────────────────────
--   SELECT p.proname, p.prosecdef AS is_security_definer
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='import_outsource_month';
--   -- is_security_definer must be FALSE
--
-- Nothing written yet:
--   SELECT (SELECT count(*) FROM public.outsource_imports)                              AS imports,
--          (SELECT count(*) FROM public.expense_entries WHERE bill_ref LIKE 'OUT-%')   AS lumps;
--   -- expect 0 | 0
--
-- Refusals, none of which write (validation precedes the delete). Each is
-- expected to ERROR with the text shown:
--   -- SELECT public.import_outsource_month('2099-01', '[{"coa_code":"230","amount":1,"note":"probe"}]'::jsonb, 0, 'probe', 0);
--   --   … is not one the outsource file may write
--   -- SELECT public.import_outsource_month('2099-01', '[{"coa_code":"650","amount":1,"note":"probe"}]'::jsonb, 0, 'probe', 0);
--   --   … is not one the outsource file may write
--   -- SELECT public.import_outsource_month('2026-07', '[{"coa_code":"310","amount":1,"note":"probe"}]'::jsonb, 0, 'probe', 0);
--   --   … owned by the budget69 import
--   -- SELECT public.import_outsource_month('2099-01', '[]'::jsonb, NULL, 'probe', 0);
--   --   … other (F7 รายได้อื่นๆ) is required
--   -- SELECT public.import_outsource_month('2099-01', '[{"coa_code":"310","amount":0,"note":"probe"}]'::jsonb, 0, 'probe', 0);
--   --   … must be positive
