-- monthly_covers: bills, customers, cancelled bills and cancelled amount per
-- month, written by the SAME call as the POS revenue import.
--
-- Run after pos_revenue_import_schema.sql and pos_revenue_import_rpc.sql.
-- This file REPLACES import_pos_month with an eight-parameter version; the
-- old seven-parameter one is dropped here on purpose (see below). After this
-- file has run, do not re-run pos_revenue_import_rpc.sql: it would recreate
-- the seven-parameter overload beside this one.
--
-- ── WHAT THIS IS ──────────────────────────────────────────────────────────
--
-- The POS export's Sheet4 gives the customer count and the completed-bill
-- count; Sheet5 gives cancelled bills and their amount (August 2569: 6,686
-- customers, 2,690 bills, 19 cancelled for ฿52,974; Sheet5's own total 2,709
-- = 2,690 + 19, so bills and cancelled bills are disjoint). The parser has
-- yielded them since the revenue import was built; until now they reached
-- the preview and stopped.
--
-- COUNTS ARE STORED, AVERAGES ARE NOT. Sheet4 also prints ฿/bill and ฿/head,
-- but those divide the export's net-of-discount total INCLUDING the coffee
-- shop (3,881,934 in August) — a basis the app never uses. Storing them would
-- put two bases side by side on one screen. The app divides its own revenue
-- by these counts; one basis is the rule.
--
-- ── WHY THE SAME RPC, NOT A TABLE OF ITS OWN WITH ITS OWN UPLOAD ──────────
--
-- Covers and revenue must always come from the same file. A separate write
-- path could take August's revenue from one export and August's covers from
-- another, and nothing would show it. So p_covers is a REQUIRED parameter of
-- import_pos_month, NULL is refused, and the row is deleted and re-inserted
-- inside the same transaction as the nine revenue/expense rows — one rule
-- for all ten.
--
-- ── WHY THE OLD FUNCTION IS DROPPED EXPLICITLY ────────────────────────────
--
-- Postgres identifies a function by name AND argument types. CREATE OR
-- REPLACE with a new parameter list does not replace the old function; it
-- creates a second one beside it. PostgREST would then have two candidates,
-- and the seven-parameter one would go on accepting calls that carry no
-- covers — the exact silent shape this import exists to prevent. Hence the
-- DROP, with the full old signature, before the CREATE.

BEGIN;

CREATE TABLE IF NOT EXISTS public.monthly_covers (
  year_month        TEXT          PRIMARY KEY,
  bills             INTEGER       NOT NULL CHECK (bills >= 0),
  customers         INTEGER       NOT NULL CHECK (customers >= 0),
  cancelled_bills   INTEGER       NOT NULL CHECK (cancelled_bills >= 0),
  -- As the POS states it: the cancelled bills' face value on the POS's own
  -- basis. Stored for information, never added to or subtracted from revenue.
  cancelled_amount  NUMERIC(14,2) NOT NULL CHECK (cancelled_amount >= 0),
  source_file       TEXT,
  imported_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  imported_by       UUID          REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.monthly_covers IS
  'Completed bills, customers, cancelled bills and cancelled amount per month, '
  'from the POS export''s Sheet4/Sheet5. Written only by import_pos_month, in '
  'the same transaction as the month''s revenue, so both always come from one '
  'file. Counts only: averages are computed from the app''s own revenue.';

ALTER TABLE public.monthly_covers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "monthly_covers_select" ON public.monthly_covers;
DROP POLICY IF EXISTS "monthly_covers_all"    ON public.monthly_covers;
CREATE POLICY "monthly_covers_select" ON public.monthly_covers FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "monthly_covers_all"    ON public.monthly_covers FOR ALL    TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- The seven-parameter version, by its exact signature. See the header.
DROP FUNCTION IF EXISTS public.import_pos_month(TEXT, JSONB, JSONB, DATE, TEXT, NUMERIC, NUMERIC);

COMMIT;

-- Everything below is the previous function verbatim, plus p_covers and its
-- validation and write. The header comment of pos_revenue_import_rpc.sql
-- (why a database function, what the caller cannot do, the re-import rule,
-- SECURITY INVOKER) still describes this function and is not repeated here.
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
  p_restaurant_gross NUMERIC,
  -- {"bills":2690,"customers":6686,"cancelled_bills":19,"cancelled_amount":52974}
  -- REQUIRED: NULL is refused in the body, so covers and revenue come from
  -- one file, always. The DEFAULT NULL is not optionality — it is there so
  -- that, between this file running and commit 1 deploying, the still-
  -- deployed seven-argument call resolves to THIS function and fails with
  -- "covers are required" instead of PostgREST's "function does not exist".
  p_covers          JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  -- The six types this function owns. 'other' is deliberately absent; see the
  -- header of pos_revenue_import_rpc.sql. Changing this array changes what a
  -- re-import can overwrite.
  owned_types  TEXT[] := ARRAY['food','drink','dessert','delivery','souvenir','pos_other'];
  allowed_coa  TEXT[] := ARRAY['650','752','753'];
  r            JSONB;
  v_type       TEXT;
  v_coa        TEXT;
  v_ref        TEXT;
  v_bills      INT;
  v_customers  INT;
  v_cancelled  INT;
  v_cancelled_amount NUMERIC;
  deleted_rev  INT;
  deleted_exp  INT;
  deleted_cov  INT;
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

  -- Covers: required, four non-negative figures. A count of zero is a
  -- value (a month with no cancellations); a missing key is not.
  IF p_covers IS NULL OR jsonb_typeof(p_covers) <> 'object' THEN
    RAISE EXCEPTION 'covers are required — bills, customers, cancelled_bills, cancelled_amount from the same export as the revenue';
  END IF;
  IF (p_covers->>'bills') IS NULL OR (p_covers->>'customers') IS NULL
     OR (p_covers->>'cancelled_bills') IS NULL OR (p_covers->>'cancelled_amount') IS NULL THEN
    RAISE EXCEPTION 'covers must carry bills, customers, cancelled_bills and cancelled_amount, got %', p_covers::text;
  END IF;
  v_bills            := (p_covers->>'bills')::INT;
  v_customers        := (p_covers->>'customers')::INT;
  v_cancelled        := (p_covers->>'cancelled_bills')::INT;
  v_cancelled_amount := (p_covers->>'cancelled_amount')::NUMERIC;
  IF v_bills < 0 OR v_customers < 0 OR v_cancelled < 0 OR v_cancelled_amount < 0 THEN
    RAISE EXCEPTION 'covers must be non-negative, got %', p_covers::text;
  END IF;

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

  -- ── Replace the month's covers: the same rule, the tenth row ────────────
  DELETE FROM public.monthly_covers WHERE year_month = p_year_month;
  GET DIAGNOSTICS deleted_cov = ROW_COUNT;
  INSERT INTO public.monthly_covers
    (year_month, bills, customers, cancelled_bills, cancelled_amount, source_file, imported_at, imported_by)
  VALUES
    (p_year_month, v_bills, v_customers, v_cancelled, v_cancelled_amount, p_source_file, NOW(), auth.uid());

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
    'year_month',        p_year_month,
    'revenue_deleted',   deleted_rev,
    'revenue_inserted',  inserted_rev,
    'expenses_deleted',  deleted_exp,
    'expenses_inserted', inserted_exp,
    -- TRUE when the month had covers before this call — a re-run that ADDS
    -- covers to July or August reports FALSE here and TRUE for was_reimport.
    'covers_replaced',   deleted_cov > 0,
    'was_reimport',      (deleted_rev > 0 OR deleted_exp > 0)
  );
END $$;

COMMENT ON FUNCTION public.import_pos_month IS
  'Writes one month of POS revenue, its discount/GP entries and its covers '
  'atomically. Deletes and re-inserts exactly the rows the import owns; '
  'monthly_revenue type "other" is unreachable by construction, the three '
  'expense entries are always payment_method=accrual with no supplier, and '
  'covers are required so they always come from the same file as the revenue.';

REVOKE ALL ON FUNCTION public.import_pos_month FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_pos_month TO authenticated;

-- ─── Verification (run separately) ─────────────────────────────────────────
-- Exactly ONE import_pos_month, with eight parameters:
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS is_security_definer
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.proname='import_pos_month';
--   -- expect one row; args end in ", p_covers jsonb"; is_security_definer FALSE
--
-- Nothing written yet:
--   SELECT count(*) FROM public.monthly_covers;   -- expect 0
--
-- Refusals, none of which write (validation precedes every delete). Each
-- is expected to ERROR with the text shown:
--   -- SELECT public.import_pos_month('2099-01', '[]'::jsonb, '[]'::jsonb, '2099-01-31', 'probe', 0, 0, NULL);
--   --   … covers are required
--   -- SELECT public.import_pos_month('2099-01', '[]'::jsonb, '[]'::jsonb, '2099-01-31', 'probe', 0, 0, '{"bills":-1,"customers":0,"cancelled_bills":0,"cancelled_amount":0}'::jsonb);
--   --   … covers must be non-negative
--   -- SELECT public.import_pos_month('2099-01', '[]'::jsonb, '[]'::jsonb, '2099-01-31', 'probe', 0, 0, '{"bills":1}'::jsonb);
--   --   … covers must carry bills, customers, cancelled_bills and cancelled_amount
--
-- Between this file running and commit 1 deploying, the revenue-import
-- page's apply fails with "covers are required": the deployed action still
-- sends seven arguments, which resolve here with p_covers NULL and are
-- refused. Nothing is written in that window. Run this file and deploy
-- commit 1 in the same sitting.
