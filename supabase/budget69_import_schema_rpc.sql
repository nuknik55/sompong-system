-- The budget69 monthly import: provenance table, idempotency index, and the
-- function that writes one month atomically.
--
-- Run coa_add_225_870.sql first: the function validates every coa_code
-- against the live table, and two of budget69's rows map to those codes.
--
-- ── WHAT THIS IMPORT IS ────────────────────────────────────────────────────
--
-- The app's ledger has never held the monthly-billed costs — salaries,
-- owner's salary, land rent, electricity, water, accountant, card fees —
-- because nobody pays them at the till, so the bookkeeper's daily entries
-- never include them. In July 2569 that is ≈฿1,032,000; August's operating
-- profit of 38.7% is computed without any of it, and the honest figure is
-- nearer 12.8%. budget69.xlsx (sheet งบ69, the green ACTUAL column of each
-- month pair) is the trusted source for them. This function writes one
-- monthly lump per account per month from it.
--
-- That makes this a MONTHLY import, not a history load. It also fills
-- Jan–Jul 2569 for accounts the app has nothing for, and for July it fills
-- 1–16 for the accounts the bookkeeper began entering on the 17th.
--
-- ── THE LUMP IS THE REMAINDER, NOT THE SHEET FIGURE ────────────────────────
--
-- lump(code, month) = budget69 actual − Σ app entries for that code and month
-- that are NOT themselves budget69 lumps. The caller computes it; this
-- function only stores. For Jan–Jun that is the whole sheet figure (the app
-- has nothing). For July it is the 1–16 remainder. From August on it is
-- whatever the daily entries did not already cover. A negative remainder
-- means the daily entries exceed the sheet: the caller clamps to zero, keeps
-- the entries, and reports it — budget69 is the authority on the month, the
-- entries are the authority on the days.
--
-- ── WHAT THE CALLER CANNOT DO, BY CONSTRUCTION ────────────────────────────
--
--   1. Codes the POS import owns are REFUSED: 650, 752, 753. budget69 carries
--      the same discount and GP figures; writing them here too would double
--      every month's discount the moment both imports have run.
--   2. Revenue is unreachable: only expense_entries is written.
--   3. payment_method is always 'accrual' — a lump was paid months ago and
--      must never join the transfer to-pay list. supplier_id is always NULL,
--      which is what actually keeps it off that list: the weekly transfer
--      slip filters on supplier_id, not on payment_method. See the comment
--      in pos_revenue_import_rpc.sql before ever attaching a supplier.
--   4. entry_date is always the 1st. The incomplete-month marker fires for
--      the month holding the earliest entry when that entry is not on the
--      1st; lumps on the 1st mean MIN(entry_date) = 2026-01-01 and the marker
--      clears — correctly, because July becomes a full month once its lumps
--      land. Dating on the 31st would make January look incomplete forever.
--   5. A sensitive account (790 เงินเดือนเจ้าของร้าน) can be written ONLY by
--      the owner. The server action is requireOwner; this is the second lock.
--
-- ── RE-IMPORT: ONE RULE ────────────────────────────────────────────────────
--
-- Deletes every B69-…-<month> entry, inserts the current set. A re-run of the
-- same figures is byte-identical; a corrected sheet replaces cleanly; an
-- account that drops to zero loses its row rather than keeping a stale one.

BEGIN;

CREATE TABLE IF NOT EXISTS public.budget69_imports (
  year_month    TEXT        PRIMARY KEY,
  imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_by   UUID        REFERENCES public.profiles(id),
  source_file   TEXT,
  -- Σ of the sheet's actual for every mapped account, and Σ of what was
  -- written (after subtracting daily entries). The gap between them is the
  -- daily-entered part of the month, kept so a later reader can see it
  -- without the sheet.
  sheet_total   NUMERIC(14,2) NOT NULL,
  written_total NUMERIC(14,2) NOT NULL,
  entries       INTEGER       NOT NULL
);

COMMENT ON TABLE public.budget69_imports IS
  'One row per month imported from budget69.xlsx. Provenance for the monthly '
  'cost lumps, and the evidence the start-of-month checklist reads.';

ALTER TABLE public.budget69_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budget69_imports_select" ON public.budget69_imports;
DROP POLICY IF EXISTS "budget69_imports_all"    ON public.budget69_imports;
CREATE POLICY "budget69_imports_select" ON public.budget69_imports FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "budget69_imports_all"    ON public.budget69_imports FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'owner');

-- Idempotency, enforced. Partial like the POS one, and separate from it:
-- the two prefixes are two owners, and a shared index would hide that.
CREATE UNIQUE INDEX IF NOT EXISTS expense_entries_b69_bill_ref_uniq
  ON public.expense_entries (bill_ref)
  WHERE bill_ref LIKE 'B69-%';

COMMIT;

CREATE OR REPLACE FUNCTION public.import_budget69_month(
  p_year_month   TEXT,
  -- [{"coa_code":"220","amount":580846,"note":"…"}, ...] — already the
  -- remainder after daily entries; zero-amount rows are omitted by the caller
  p_entries      JSONB,
  p_source_file  TEXT,
  p_sheet_total  NUMERIC,
  p_written_total NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  pos_owned   TEXT[] := ARRAY['650','752','753'];
  r           JSONB;
  v_code      TEXT;
  v_sensitive BOOLEAN;
  v_role      TEXT;
  v_date      DATE;
  deleted_n   INT;
  inserted_n  INT := 0;
BEGIN
  IF p_year_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'year_month must be YYYY-MM, got %', p_year_month;
  END IF;
  v_date := to_date(p_year_month || '-01', 'YYYY-MM-DD');
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  -- ── Validate everything before deleting anything ────────────────────────
  FOR r IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_code := r->>'coa_code';
    IF v_code = ANY(pos_owned) THEN
      RAISE EXCEPTION 'coa_code % is written by the POS revenue import, not from budget69 — it would be counted twice', v_code;
    END IF;
    SELECT is_sensitive INTO v_sensitive FROM public.coa WHERE code = v_code AND group_code IS NOT NULL;
    IF v_sensitive IS NULL THEN
      RAISE EXCEPTION 'coa_code % is not an account (unknown, or a group header)', v_code;
    END IF;
    IF v_sensitive AND v_role IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'coa_code % is owner-only', v_code;
    END IF;
    IF (r->>'amount') IS NULL OR (r->>'amount')::NUMERIC <= 0 THEN
      RAISE EXCEPTION 'amount for % must be positive (zero rows are omitted, negatives are clamped by the caller)', v_code;
    END IF;
  END LOOP;

  -- ── Replace this month's lumps ──────────────────────────────────────────
  DELETE FROM public.expense_entries
   WHERE bill_ref LIKE 'B69-%-' || p_year_month;
  GET DIAGNOSTICS deleted_n = ROW_COUNT;

  FOR r IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    INSERT INTO public.expense_entries
      (entry_date, coa_code, amount, note, detail, bill_ref, payment_method, supplier_id, created_by)
    VALUES
      (v_date, r->>'coa_code', (r->>'amount')::NUMERIC,
       r->>'note', r->>'note',
       'B69-' || (r->>'coa_code') || '-' || p_year_month,
       -- Not parameters. accrual: paid long ago, nothing to pay from this
       -- row. NULL supplier: the transfer slip filters on supplier_id, and
       -- this is what keeps ฿1M a month of history off Nik's pay-out list.
       'accrual', NULL, auth.uid());
    inserted_n := inserted_n + 1;
  END LOOP;

  INSERT INTO public.budget69_imports
    (year_month, imported_at, imported_by, source_file, sheet_total, written_total, entries)
  VALUES
    (p_year_month, NOW(), auth.uid(), p_source_file, p_sheet_total, p_written_total, inserted_n)
  ON CONFLICT (year_month) DO UPDATE SET
    imported_at = NOW(), imported_by = auth.uid(), source_file = EXCLUDED.source_file,
    sheet_total = EXCLUDED.sheet_total, written_total = EXCLUDED.written_total, entries = EXCLUDED.entries;

  RETURN jsonb_build_object(
    'year_month', p_year_month, 'deleted', deleted_n, 'inserted', inserted_n,
    'was_reimport', deleted_n > 0
  );
END $$;

COMMENT ON FUNCTION public.import_budget69_month IS
  'Writes one month of monthly-cost lumps from budget69 atomically. Refuses '
  'POS-owned codes (650/752/753), refuses a sensitive code from a non-owner, '
  'always accrual with no supplier, always dated the 1st. Deletes and '
  're-inserts exactly the B69-…-<month> rows.';

REVOKE ALL ON FUNCTION public.import_budget69_month FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_budget69_month TO authenticated;

-- ─── Verification (run separately) ─────────────────────────────────────────
--   SELECT p.proname, p.prosecdef AS is_security_definer
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='import_budget69_month';
--   -- is_security_definer must be FALSE
--
-- Nothing written yet:
--   SELECT (SELECT count(*) FROM public.budget69_imports)                              AS imports,
--          (SELECT count(*) FROM public.expense_entries WHERE bill_ref LIKE 'B69-%')   AS lumps;
--   -- expect 0 | 0
--
-- The POS-owned refusal, without writing anything (validation precedes the delete):
--   -- SELECT public.import_budget69_month('2099-01',
--   --   '[{"coa_code":"650","amount":1,"note":"probe"}]'::jsonb, 'probe', 0, 0);
--   -- expect: ERROR … written by the POS revenue import
