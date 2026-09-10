-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║ SUPERSEDED 2026-09-10 by monthly_covers_migration.sql. DO NOT RE-RUN.  ║
-- ║                                                                         ║
-- ║ That file dropped this seven-parameter function and created an         ║
-- ║ eight-parameter one (p_covers). Running this file again would          ║
-- ║ recreate the seven-parameter version BESIDE it — Postgres identifies a ║
-- ║ function by name and argument types — and PostgREST would then have    ║
-- ║ two candidates, one of which accepts calls that carry no covers.       ║
-- ║ Kept for its header, which still describes the function's rules.       ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
--
-- import_pos_month — the whole monthly import as ONE transaction.
--
-- Run pos_revenue_import_schema.sql first; this function depends on the
-- widened CHECKs and the pos_revenue_imports table.
--
-- CREATE OR REPLACE, so a revision is a re-run of this file alone. Writes
-- nothing by itself: it only exists to be called.
--
-- ── WHY A DATABASE FUNCTION AT ALL ────────────────────────────────────────
--
-- The import writes six revenue rows and three expense entries, and a month
-- half-written is the state this exists to prevent: revenue without the
-- matching discount entry overstates operating profit by ฿102,876 (2.7 points
-- in August), and the discount without revenue understates it. The Supabase
-- JS client cannot open a transaction — every call is its own statement — so
-- "all or nothing" has to live here. Two sequential upserts plus a
-- compensating delete is exactly the half-written month, with extra steps.
--
-- ── WHAT THE CALLER CANNOT DO, BY CONSTRUCTION ────────────────────────────
--
-- Three things are decided HERE and cannot be passed in, so no bug in the
-- application layer can produce them:
--
--   1. 'other' IS UNREACHABLE. The delete and the insert both run against a
--      hardcoded allowlist of the six import-owned types. 'other' is not in
--      it, so no argument can name it. An allowlist rather than
--      `revenue_type <> 'other'` because the negative form would silently
--      sweep any type added later.
--   2. payment_method IS ALWAYS 'accrual'. Not a parameter. Platform GP is
--      withheld before payout and a discount moves no money, so neither may
--      ever reach the transfer to-pay list — and now cannot, whatever the
--      caller sends.
--   3. supplier_id IS ALWAYS NULL. These are not purchases from anyone.
--
-- ── RE-IMPORT: ONE RULE FOR ALL NINE ROWS ─────────────────────────────────
--
-- The import owns a defined set of rows for a month. A re-run DELETES exactly
-- that set and writes the current one. Not upsert here and insert there —
-- one sentence describes every row it touches.
--
-- Second run of the same file: byte-identical. Second run of a corrected
-- file: old set gone, new set present, no doubling. A month whose souvenir
-- falls to zero LOSES its souvenir row rather than keeping a stale one, which
-- an upsert would leave behind.
--
-- ── SECURITY INVOKER, DELIBERATELY ────────────────────────────────────────
--
-- Runs as the caller, so the RLS on monthly_revenue, expense_entries and
-- pos_revenue_imports applies exactly as it does everywhere else: owner and
-- admin only. SECURITY DEFINER would make this function a hole around those
-- policies for the sake of nothing — the server action already calls
-- requireAdmin() before it gets here, and defence in depth is the point.

CREATE OR REPLACE FUNCTION public.import_pos_month(
  p_year_month      TEXT,
  -- [{"revenue_type":"food","amount":3136226}, ...]
  p_revenue         JSONB,
  -- [{"coa_code":"650","amount":102876.25,"bill_ref":"POS-DISCOUNT-2026-08","note":"..."}, ...]
  p_expenses        JSONB,
  -- The date the three expense entries carry: the last day of the month.
  p_entry_date      DATE,
  p_source_file     TEXT,
  p_gross_total     NUMERIC,
  p_restaurant_gross NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  -- The six types this function owns. 'other' is deliberately absent; see the
  -- header. Changing this array changes what a re-import can overwrite.
  owned_types  TEXT[] := ARRAY['food','drink','dessert','delivery','souvenir','pos_other'];
  allowed_coa  TEXT[] := ARRAY['650','752','753'];
  r            JSONB;
  v_type       TEXT;
  v_coa        TEXT;
  v_ref        TEXT;
  deleted_rev  INT;
  deleted_exp  INT;
  inserted_rev INT := 0;
  inserted_exp INT := 0;
BEGIN
  IF p_year_month !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'year_month must be YYYY-MM, got %', p_year_month;
  END IF;

  IF date_trunc('month', p_entry_date)::date <> to_date(p_year_month, 'YYYY-MM') THEN
    RAISE EXCEPTION 'entry_date % is not inside %', p_entry_date, p_year_month;
  END IF;

  -- ── Validate before deleting anything ───────────────────────────────────
  -- A bad payload must not be able to clear a month and then fail to refill
  -- it. The transaction would roll back, but validating first means the
  -- failure names the offending value rather than a constraint.
  FOR r IN SELECT * FROM jsonb_array_elements(p_revenue) LOOP
    v_type := r->>'revenue_type';
    IF NOT (v_type = ANY(owned_types)) THEN
      RAISE EXCEPTION
        'revenue_type "%" is not one the import owns. Allowed: %. '
        '"other" is the accountants'' figure and is never written here.',
        v_type, array_to_string(owned_types, ', ');
    END IF;
    IF (r->>'amount') IS NULL OR (r->>'amount')::NUMERIC < 0 THEN
      RAISE EXCEPTION 'revenue amount for "%" must be present and non-negative', v_type;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(p_expenses) LOOP
    v_coa := r->>'coa_code';
    v_ref := r->>'bill_ref';
    IF NOT (v_coa = ANY(allowed_coa)) THEN
      RAISE EXCEPTION 'coa_code "%" is not one the import writes. Allowed: %',
        v_coa, array_to_string(allowed_coa, ', ');
    END IF;
    -- The bill_ref is the idempotency key. If it did not carry this month,
    -- a re-import would delete one month's entries and insert another's.
    IF v_ref IS NULL OR v_ref NOT LIKE 'POS-%-' || p_year_month THEN
      RAISE EXCEPTION 'bill_ref "%" must look like POS-<kind>-%', v_ref, p_year_month;
    END IF;
    IF (r->>'amount') IS NULL OR (r->>'amount')::NUMERIC < 0 THEN
      RAISE EXCEPTION 'expense amount for % must be present and non-negative', v_coa;
    END IF;
  END LOOP;

  -- ── Replace the owned revenue rows ──────────────────────────────────────
  DELETE FROM public.monthly_revenue
   WHERE year_month = p_year_month
     AND revenue_type = ANY(owned_types);
  GET DIAGNOSTICS deleted_rev = ROW_COUNT;

  FOR r IN SELECT * FROM jsonb_array_elements(p_revenue) LOOP
    INSERT INTO public.monthly_revenue (year_month, revenue_type, amount)
    VALUES (p_year_month, r->>'revenue_type', (r->>'amount')::NUMERIC);
    inserted_rev := inserted_rev + 1;
  END LOOP;

  -- ── Replace the owned expense entries ───────────────────────────────────
  DELETE FROM public.expense_entries
   WHERE bill_ref IN (
     'POS-DISCOUNT-' || p_year_month,
     'POS-GP-LM-'    || p_year_month,
     'POS-GP-GRAB-'  || p_year_month
   );
  GET DIAGNOSTICS deleted_exp = ROW_COUNT;

  FOR r IN SELECT * FROM jsonb_array_elements(p_expenses) LOOP
    INSERT INTO public.expense_entries
      (entry_date, coa_code, amount, note, detail, bill_ref,
       payment_method, supplier_id, created_by)
    VALUES
      (p_entry_date, r->>'coa_code', (r->>'amount')::NUMERIC,
       r->>'note', r->>'note', r->>'bill_ref',
       -- Neither is a parameter, and the NULL is load bearing in a way the
       -- 'accrual' is not.
       --
       -- READ THIS BEFORE ATTACHING A SUPPLIER TO THESE ENTRIES. The weekly
       -- transfer slip — the list Nik works through twice a week actually
       -- sending money — does NOT filter on payment_method at all.
       -- getWeeklyTransferData selects every expense entry in the week with
       -- supplier_id IS NOT NULL, cash and transfer and accrual alike. So
       -- these three entries stay off the pay-out list BECAUSE THEY HAVE NO
       -- SUPPLIER, not because they are marked accrual.
       --
       -- Give them a supplier — "so the GP shows against Grab" is the
       -- obvious improvement — and about ฿162,000 a month of money that was
       -- withheld before it ever arrived appears as money to send. Nothing
       -- in the payment_method logic would stop it, because that path never
       -- looks at payment_method.
       'accrual', NULL, auth.uid());
    inserted_exp := inserted_exp + 1;
  END LOOP;

  -- ── Provenance ──────────────────────────────────────────────────────────
  INSERT INTO public.pos_revenue_imports
    (year_month, imported_at, imported_by, source_file, gross_total, restaurant_gross)
  VALUES
    (p_year_month, NOW(), auth.uid(), p_source_file, p_gross_total, p_restaurant_gross)
  ON CONFLICT (year_month) DO UPDATE SET
    imported_at      = NOW(),
    imported_by      = auth.uid(),
    source_file      = EXCLUDED.source_file,
    gross_total      = EXCLUDED.gross_total,
    restaurant_gross = EXCLUDED.restaurant_gross;

  RETURN jsonb_build_object(
    'year_month',       p_year_month,
    'revenue_deleted',  deleted_rev,
    'revenue_inserted', inserted_rev,
    'expenses_deleted', deleted_exp,
    'expenses_inserted', inserted_exp,
    'was_reimport',     (deleted_rev > 0 OR deleted_exp > 0)
  );
END $$;

COMMENT ON FUNCTION public.import_pos_month IS
  'Writes one month of POS revenue and its discount/GP entries atomically. '
  'Deletes and re-inserts exactly the rows the import owns; monthly_revenue '
  'type "other" is unreachable by construction, and the three expense entries '
  'are always payment_method=accrual with no supplier.';

REVOKE ALL ON FUNCTION public.import_pos_month FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_pos_month TO authenticated;

-- ─── Verification (run separately) ─────────────────────────────────────────
-- The function exists, is INVOKER, and only authenticated may execute:
--   SELECT p.proname, p.prosecdef AS is_security_definer,
--          pg_get_function_identity_arguments(p.oid) AS args
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='import_pos_month';
--   -- is_security_definer must be FALSE
--
-- Nothing has been written yet — all three still as before:
--   SELECT (SELECT count(*) FROM public.monthly_revenue)     AS revenue_rows,
--          (SELECT count(*) FROM public.expense_entries)     AS entries,
--          (SELECT count(*) FROM public.pos_revenue_imports) AS imports;
--   -- expect 10 | 1552 | 0
--
-- Refusing "other" can be checked without writing anything, because the
-- validation loop runs before the first DELETE and the whole call rolls back:
--   -- SELECT public.import_pos_month('2026-08',
--   --   '[{"revenue_type":"other","amount":1}]'::jsonb, '[]'::jsonb,
--   --   '2026-08-31'::date, 'probe', 0, 0);
--   -- expect: ERROR ... is not one the import owns
