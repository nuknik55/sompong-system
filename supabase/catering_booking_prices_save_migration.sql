-- ============================================================================
-- Catering: ONE transaction for the booking screen's price box
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. One
-- transaction: it records what is live, creates one function, tests it AS
-- REAL ACCOUNTS with every test write rolled back, counts its own result rows,
-- and rolls the whole thing back if anything disagrees. Safe to re-run: the
-- only change is CREATE OR REPLACE FUNCTION, so a second run changes nothing
-- and prints the same table.
--
-- Needs catering_event_menu_items_migration.sql (applied 2026-09-19) for the
-- booking's own copy of a set and catering_copy_set_menu(uuid), and
-- catering_sales_limits_migration.sql (applied 2026-09-17) for
-- catering_event_unlocked(uuid). Step 0 stops if any of them is missing.
--
-- WHY (Nik, 2026-09-21). The booking screen saved its price box through
-- separate statements: remove the dropped menu lines, add the new ones, then
-- DELETE EVERY CHARGE ROW OF THE BOOKING and insert the new list. One bad
-- line — a missing or non-numeric amount, an overflowing price — failed that
-- insert AFTER the delete, and the booking was left with no price lines at
-- all. Nik's decision: the save must be unable to leave a partial state. This
-- file gives the app one function that writes the whole price box in ONE
-- transaction — whole, or not at all — and checks every line before it
-- writes anything.
--
-- WHAT IT CHANGES
--   catering_save_booking_prices(p_event_id uuid, p_lines jsonb,
--     p_known_menu_ids jsonb DEFAULT NULL, p_dry_run boolean DEFAULT false)
--     RETURNS jsonb.
--   p_lines is the price box exactly as the screen sends it (BookingLine in
--   src/app/owner/catering/actions.ts): menu lines
--   {kind: set|dish, refId, eventMenuId, quantity} and charge lines
--   {kind: charge, label, charge_type, unit_price, quantity, amount, note,
--   rate_id}, in the order they print. p_known_menu_ids is the menu lines the
--   screen had when it opened; NULL means every line the booking stores (an
--   older bundle's behaviour).
--   In one transaction, after checking EVERY line:
--     0. moves the booking row's updated_at — the booking screen's conflict
--        token — so that a screen which took the booking between the saving
--        screen's two writes (its fields, then this) is refused rather than
--        saving over it (review, 2026-09-21);
--     1. removes each line the screen had and dropped (its charge and its
--        copied courses go with it, ON DELETE CASCADE), writing
--        "ลบเมนู: <name>" to the history with the line's OWN name — a custom
--        or copied set's set_name first, so the history no longer reads
--        "ลบเมนู: -" (Nik, 2026-09-21);
--     2. deletes the charges it is about to rewrite — every charge of the
--        booking except those of lines created ELSEWHERE since the screen
--        opened (the menu page in another tab), which stay as they are;
--     3. writes the payload in order: a kept menu line gets the quantity sent
--        and its charge back at the STORED price and label (THE ONE PRICE —
--        the menu page edits it), keeping its stored amount when the quantity
--        did not change; a new menu line gets its row, the booking's own copy
--        of a set (catering_copy_set_menu), a charge at the set's or dish's
--        price and "เพิ่มเมนู: <name>" — or, when the booking gained a line
--        for that same set or dish elsewhere, becomes that line; a charge line
--        is written as sent;
--     4. keeps the charges of lines created elsewhere, printed after the rest;
--     5. writes one "แก้ไขรายการค่าใช้จ่าย" history line, as the save did.
--   With p_dry_run it checks everything and writes NOTHING: the app calls it
--   so before it writes the booking's own fields, so a line the database
--   would refuse stops the save before anything at all is written. A dry run
--   may name no booking yet (a new one).
--
--   It refuses, before any write: a caller who is not owner, admin or sales;
--   a p_dry_run that is NULL (neither a check nor a save);
--   a booking that does not exist or is cost-locked (for everyone, owner and
--   admin included, as the app does); a line that is not an object of kind
--   set, dish or charge; a stored line that is not this booking's, or that was
--   removed elsewhere since the screen opened; the same stored line twice, or
--   two new lines for one set or dish; a set or dish that does not exist; a
--   new set named like a set line the booking keeps (A5); a set count that is
--   not a whole number from 1 to 100,000 (the message names the booking's own
--   unit, โต๊ะ / กล่อง / ชุด); a dish quantity that is not above 0, above
--   100,000 or with more than three decimals; and a charge line with no name,
--   a type the table does not accept or typed as food, a price, quantity or
--   amount that is not a number, over 100,000,000, a negative price or amount
--   on anything but a discount, a positive discount, or a rate that does not
--   exist. The same rules as src/app/owner/catering/booking-lines.ts, which
--   the screen and saveBooking apply first.
--
--   SECURITY INVOKER: every statement runs under the caller's own row-level
--   security as well as the checks above; catering_copy_set_menu is the one
--   call that bypasses a policy, under its own checks, as it does today.
--
-- WHO MAY DO WHAT, matching saveBooking (requireSales)
--   owner, admin, sales   save an unlocked booking's price box
--   anyone else           nothing
--
-- CHANGES NO DATA. Its tests clone a booking, and re-save every real unlocked
-- booking unchanged, INSIDE A BLOCK THAT ALWAYS ROLLS BACK; Step 3 then checks
-- every row count and a checksum of every charge, menu line, copied course
-- and booking row in the database against the values read before the tests.
--
-- RUN IT WHILE NOBODY IS SAVING A BOOKING. A booking saved while the file
-- runs changes what E1 and Step 3 compare (E1 reports it as CHANGED ANOTHER
-- BOOKING), and the whole file rolls back: nothing applied, run it again.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: CREATE OR REPLACE FUNCTION ×17
-- (public.catering_save_booking_prices, and 16 pg_temp helpers that live only
-- as long as this session); COMMENT ON FUNCTION ×1; after COMMIT, DROP
-- FUNCTION IF EXISTS on 15 of those pg_temp helpers (the 16th prints the
-- result table); and, inside the always-aborting test block, the
-- INSERT/UPDATE/DELETE the tests make on the cloned booking, on three test set
-- menus, and on real bookings' charges, menu lines, history and booking rows
-- through the function (all rolled back). Anything else is unexpected. It creates no
-- table and drops nothing but its own pg_temp helpers.
--
-- THE TESTS DO NOT KEEP TO "EACH TEST WRITE TOUCHES ONE ROW" (AGENTS.md), on
-- purpose: the clone's charges go in with one INSERT, a set's courses are
-- copied whole, and E1 re-saves every charge of every unlocked real booking.
-- All of it inside the always-aborting block; Step 3 then checks every
-- charge, menu line, course and booking row by id.
--
-- THE THREE LESSONS OF 2026-09-19 are built in (AGENTS.md): the function this
-- file creates is named only in text before its CREATE (check C); the
-- patterns have no backslash (check D); the results are carried out of the
-- always-aborting block in a variable (check E); and Step 3 asserts the
-- result table's row count (check F).
-- ============================================================================

BEGIN;

-- ── Test scaffolding: notes in a session setting, never a table ────────────

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  PERFORM set_config('booking_prices.log',
    COALESCE(current_setting('booking_prices.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('booking_prices.log', true), '');
BEGIN
  PERFORM set_config('booking_prices.log', '', false);
  RETURN QUERY
    SELECT r.i, r.l
      FROM regexp_split_to_table(v_log, chr(30)) WITH ORDINALITY AS r(l, i)
     WHERE r.l <> ''
     ORDER BY r.i;
END
$fn$;

-- How many lines the result table holds RIGHT NOW; Step 3 checks it against
-- the number the file is supposed to emit.
CREATE OR REPLACE FUNCTION pg_temp.logged()
RETURNS bigint
LANGUAGE sql
STABLE
AS $fn$
  SELECT count(*)
    FROM regexp_split_to_table(COALESCE(current_setting('booking_prices.log', true), ''), chr(30)) AS l
   WHERE l <> '';
$fn$;

-- Runs one statement as one account and ALWAYS rolls it back (a private
-- SQLSTATE, caught). Returns the identity it actually ran as, first. With
-- p_check, a SELECT run right after the statement, in the same impersonated
-- sub-transaction, whose row count is appended as "check=N".
CREATE OR REPLACE FUNCTION pg_temp.probe(p_who uuid, p_sql text, p_check text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_role text;
  v_n    bigint;
  v_c    bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_who::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', p_who::text, true);
    PERFORM set_config('role', 'authenticated', true);
    v_role := CASE WHEN current_user::text = 'authenticated'
                   THEN COALESCE(public.current_role(), 'no-profile')
                   ELSE 'not-authenticated' END;
    IF p_sql ~* '^[[:space:]]*select' THEN
      EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_n;
    ELSE
      EXECUTE p_sql;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    IF p_check IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM (' || p_check || ') q' INTO v_c;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'U0001';
  EXCEPTION
    WHEN SQLSTATE 'U0001' THEN
      RETURN v_role || ' rows=' || v_n || CASE WHEN p_check IS NULL THEN '' ELSE ' check=' || v_c END;
    WHEN check_violation THEN
      RETURN COALESCE(v_role, '?') || ' check-refused';
    WHEN unique_violation THEN
      RETURN COALESCE(v_role, '?') || ' unique-refused';
    WHEN insufficient_privilege THEN
      IF SQLERRM LIKE '%row-level security%' THEN
        RETURN COALESCE(v_role, '?') || ' denied:'
          || COALESCE(substring(SQLERRM from 'table "([^"]+)"'), '?');
      END IF;
      RETURN COALESCE(v_role, '?') || ' error 42501 ' || SQLERRM;
    WHEN raise_exception THEN
      -- The function's own refusals (P0001). The message is recorded
      -- separately so the table stays one word per outcome.
      PERFORM set_config('booking_prices.last_refusal', SQLERRM, true);
      RETURN COALESCE(v_role, '?') || ' refused';
    WHEN OTHERS THEN
      RETURN COALESCE(v_role, '?') || ' error ' || SQLSTATE || ' ' || SQLERRM;
  END;
END
$fn$;

-- The table a write statement names. NO BACKSLASH APPEARS IN THIS PATTERN,
-- on purpose (AGENTS.md, the de-escaping trap).
CREATE OR REPLACE FUNCTION pg_temp.sql_target(p_sql text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT lower((regexp_match(p_sql,
    '(?:insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(?:[[:alnum:]_]+[.])?([[:alnum:]_]+)',
    'i'))[1]);
$fn$;

-- One probe result, in the vocabulary the expectations use. A refusal counts
-- as 'denied' ONLY when it came from the table the statement writes to; one
-- that cannot be attributed RAISES rather than guessing.
CREATE OR REPLACE FUNCTION pg_temp.classify(p_res text, p_sql text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_table text := pg_temp.sql_target(p_sql);
BEGIN
  IF p_res NOT LIKE 'denied:%' THEN
    RETURN p_res;
  END IF;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'the harness cannot tell which table this statement writes to, so a refusal cannot be attributed: %', p_sql;
  END IF;
  IF p_res = 'denied:' || v_table THEN
    RETURN 'denied';
  END IF;
  RETURN 'error (a policy on another table) ' || p_res;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.t(p_label text, p_who uuid, p_role text, p_sql text, p_want text[], p_check text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_got  text := pg_temp.probe(p_who, p_sql, p_check);
  v_role text := split_part(v_got, ' ', 1);
  v_res  text := pg_temp.classify(substr(v_got, length(split_part(v_got, ' ', 1)) + 2), p_sql);
BEGIN
  IF v_role IS DISTINCT FROM p_role THEN
    RAISE EXCEPTION '% — ran as %, expected %: the impersonation did not take, so the result means nothing. Nothing applied.',
      p_label, v_role, p_role;
  END IF;
  IF NOT (v_res = ANY (p_want)) THEN
    RAISE EXCEPTION 'FAIL    % — as %, got "%", expected one of %. Nothing applied.',
      p_label, v_role, v_res, array_to_string(p_want, ' / ');
  END IF;
  PERFORM pg_temp.note(format('ok      %s — as %s, %s', p_label, v_role, v_res));
END
$fn$;

-- The price box as the booking screen sends it for a booking nobody edited:
-- linesFromCharges then bookingLinesForSave, in SQL. The charges in their
-- order; a menu-linked charge becomes its line (the kind from the line's
-- shape, the quantity from the charge, as the screen reads it; refId as the
-- screen sends it, "" for a custom set); every other charge goes as stored.
CREATE OR REPLACE FUNCTION pg_temp.payload_of(p_event uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(jsonb_agg(
           CASE WHEN c.event_menu_id IS NOT NULL THEN
             jsonb_build_object(
               'kind', CASE WHEN m.set_menu_id IS NOT NULL OR m.menu_id IS NULL THEN 'set' ELSE 'dish' END,
               'refId', COALESCE(COALESCE(m.set_menu_id, m.menu_id)::text, ''),
               'eventMenuId', c.event_menu_id::text,
               'quantity', c.quantity)
           ELSE
             jsonb_build_object(
               'kind', 'charge', 'label', c.label, 'charge_type', c.charge_type,
               'unit_price', c.unit_price, 'quantity', c.quantity, 'amount', c.amount,
               'note', c.note, 'rate_id', c.rate_id::text)
           END ORDER BY c.sort_order, c.id), '[]'::jsonb)
    FROM public.catering_event_charges c
    LEFT JOIN public.catering_event_menus m ON m.id = c.event_menu_id
   WHERE c.event_id = p_event;
$fn$;

-- The menu lines the screen knows: those it shows, i.e. those with a charge.
CREATE OR REPLACE FUNCTION pg_temp.known_of(p_event uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
  SELECT COALESCE(jsonb_agg(DISTINCT c.event_menu_id::text), '[]'::jsonb)
    FROM public.catering_event_charges c
   WHERE c.event_id = p_event AND c.event_menu_id IS NOT NULL;
$fn$;

-- Payload edits for the tests.
CREATE OR REPLACE FUNCTION pg_temp.with_qty(p jsonb, p_line uuid, p_qty numeric)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(jsonb_agg(CASE WHEN x.e->>'eventMenuId' = p_line::text
                                 THEN jsonb_set(x.e, '{quantity}', to_jsonb(p_qty)) ELSE x.e END ORDER BY x.i), '[]'::jsonb)
    FROM jsonb_array_elements(p) WITH ORDINALITY AS x(e, i);
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.without(p jsonb, p_line uuid)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(jsonb_agg(x.e ORDER BY x.i) FILTER (WHERE x.e->>'eventMenuId' IS DISTINCT FROM p_line::text), '[]'::jsonb)
    FROM jsonb_array_elements(p) WITH ORDINALITY AS x(e, i);
$fn$;

-- The text of a SELECT that fingerprints one booking's charges: every stored
-- value in print order, sort_order included, no row ids (a save rewrites the
-- rows).
CREATE OR REPLACE FUNCTION pg_temp.fp_sql(p_event uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT format($q$SELECT COALESCE(string_agg(concat_ws('|', c.label, c.charge_type, c.unit_price, c.quantity, c.amount, COALESCE(c.note, '~'), COALESCE(c.event_menu_id::text, '~'), COALESCE(c.rate_id::text, '~'), c.sort_order), ';' ORDER BY c.sort_order, c.id), '') FROM public.catering_event_charges c WHERE c.event_id = %L$q$, p_event);
$fn$;

-- The same for its menu lines and their copied courses, ids included (a save
-- must keep them).
CREATE OR REPLACE FUNCTION pg_temp.lines_sql(p_event uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT format($q$SELECT (SELECT COALESCE(string_agg(concat_ws('|', m.id, COALESCE(m.set_menu_id::text, '~'), COALESCE(m.menu_id::text, '~'), COALESCE(m.set_name, '~'), m.quantity), ';' ORDER BY m.id), '') FROM public.catering_event_menus m WHERE m.event_id = %L) || '#' || (SELECT COALESCE(string_agg(i::text, ';' ORDER BY i.id), '') FROM public.catering_event_menu_items i WHERE i.event_id = %L)$q$, p_event, p_event);
$fn$;

-- The text of a SELECT that fingerprints everything OUTSIDE one booking that
-- its save could reach — every other booking's row, charges, menu lines,
-- copied courses and history, with row ids: a save must leave them alone.
CREATE OR REPLACE FUNCTION pg_temp.others_sql(p_event uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT format($q$SELECT md5((SELECT COALESCE(string_agg(e::text, ';' ORDER BY e.id), '') FROM public.catering_events e WHERE e.id <> %L) || '#' || (SELECT COALESCE(string_agg(c::text, ';' ORDER BY c.id), '') FROM public.catering_event_charges c WHERE c.event_id <> %L) || '#' || (SELECT COALESCE(string_agg(m::text, ';' ORDER BY m.id), '') FROM public.catering_event_menus m WHERE m.event_id <> %L) || '#' || (SELECT COALESCE(string_agg(i::text, ';' ORDER BY i.id), '') FROM public.catering_event_menu_items i WHERE i.event_id <> %L) || '#' || (SELECT COALESCE(string_agg(l::text, ';' ORDER BY l.id), '') FROM public.catering_event_activity_log l WHERE l.event_id <> %L))$q$, p_event, p_event, p_event, p_event, p_event);
$fn$;

-- Every charge, menu line, copied course and booking row in the database,
-- with its row id: if anything the tests wrote survived them, this changes.
-- PL/pgSQL, so that its body is not resolved when it is created, before
-- Step 0 has checked that the tables and columns it names exist (AGENTS.md).
CREATE OR REPLACE FUNCTION pg_temp.checksum()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $fn$
BEGIN
  RETURN md5(
    (SELECT COALESCE(string_agg(concat_ws('|', c.id, c.event_id, c.label, c.charge_type, c.unit_price, c.quantity, c.amount, COALESCE(c.note, '~'), COALESCE(c.event_menu_id::text, '~'), COALESCE(c.rate_id::text, '~'), c.sort_order), ';' ORDER BY c.id), '')
       FROM public.catering_event_charges c)
    || '#' ||
    (SELECT COALESCE(string_agg(concat_ws('|', m.id, m.event_id, COALESCE(m.set_menu_id::text, '~'), COALESCE(m.menu_id::text, '~'), COALESCE(m.set_name, '~'), m.quantity, m.sort_order), ';' ORDER BY m.id), '')
       FROM public.catering_event_menus m)
    || '#' ||
    (SELECT COALESCE(string_agg(concat_ws('|', i.id, i.event_menu_id, i.menu_id, i.quantity, i.section, i.sort_order), ';' ORDER BY i.id), '')
       FROM public.catering_event_menu_items i)
    || '#' ||
    (SELECT COALESCE(string_agg(e::text, ';' ORDER BY e.id), '')
       FROM public.catering_events e));
END
$fn$;

-- ── The harness tests ITSELF, before it tests anything else ────────────────

DO $do$
DECLARE
  v_here  constant text := 'INSERT INTO public.catering_event_charges (event_id) VALUES (NULL)';
  v_ok    boolean := false;
BEGIN
  -- X1. A refusal FROM THE TABLE UNDER TEST reads as 'denied'.
  IF pg_temp.sql_target(v_here) IS DISTINCT FROM 'catering_event_charges'
     OR pg_temp.sql_target('UPDATE public.catering_event_menus SET quantity = 1 WHERE id = NULL') IS DISTINCT FROM 'catering_event_menus'
     OR pg_temp.sql_target('DELETE FROM public.catering_event_charges WHERE id = NULL') IS DISTINCT FROM 'catering_event_charges'
     OR pg_temp.sql_target('insert into catering_event_menus (event_id) values (NULL)') IS DISTINCT FROM 'catering_event_menus' THEN
    RAISE EXCEPTION 'FAIL    X1 the harness cannot read the table out of a statement. Nothing applied.';
  END IF;
  IF pg_temp.classify('denied:catering_event_charges', v_here) IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'FAIL    X1 a refusal from the table under test was not read as "denied": got %. Nothing applied.',
      pg_temp.classify('denied:catering_event_charges', v_here);
  END IF;
  PERFORM pg_temp.note('ok      X1 a refusal from the table under test reads as "denied" (insert, update, delete, with and without the schema)');

  -- X2. A refusal from ANOTHER table does not, one that cannot be attributed
  --     raises, and a non-refusal passes through untouched.
  IF pg_temp.classify('denied:catering_events', v_here) NOT LIKE 'error (a policy on another table)%' THEN
    RAISE EXCEPTION 'FAIL    X2 a refusal from another table passed as the table under test: got %. Nothing applied.',
      pg_temp.classify('denied:catering_events', v_here);
  END IF;
  BEGIN
    PERFORM pg_temp.classify('denied:catering_events', 'SELECT 1');
  EXCEPTION WHEN raise_exception THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'FAIL    X2 a refusal that cannot be attributed to any table was classified anyway. Nothing applied.';
  END IF;
  IF pg_temp.classify('rows=1 check=3', v_here) IS DISTINCT FROM 'rows=1 check=3' THEN
    RAISE EXCEPTION 'FAIL    X2 a non-refusal was rewritten. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      X2 a refusal from another table is not "denied", an unattributable one raises, and a non-refusal is untouched');
END
$do$;

-- ── Step 0: what is live, and the accounts the tests need ──────────────────

DO $do$
DECLARE
  v_owner uuid;
  v_admin uuid;
  v_sales uuid;
  v_other uuid;
  v_other_role text;
  v_has   boolean;
BEGIN
  PERFORM 'public.current_role()'::regprocedure;
  BEGIN
    PERFORM 'public.catering_event_unlocked(uuid)'::regprocedure;
    PERFORM 'public.catering_copy_set_menu(uuid)'::regprocedure;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'catering_event_unlocked(uuid) or catering_copy_set_menu(uuid) is missing: catering_sales_limits_migration.sql or catering_event_menu_items_migration.sql has not run. Nothing changed.';
  END;
  IF to_regclass('public.catering_event_menu_items') IS NULL THEN
    RAISE EXCEPTION 'catering_event_menu_items is missing: catering_event_menu_items_migration.sql has not run. Nothing changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'catering_event_menus' AND column_name = 'set_name') THEN
    RAISE EXCEPTION 'catering_event_menus.set_name is missing: catering_event_menu_items_migration.sql has not run. Nothing changed.';
  END IF;

  SELECT id INTO v_owner FROM public.profiles WHERE role = 'owner' ORDER BY id LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY id LIMIT 1;
  SELECT id INTO v_sales FROM public.profiles WHERE role = 'sales' ORDER BY id LIMIT 1;
  SELECT id, role INTO v_other, v_other_role FROM public.profiles
   WHERE role IS NOT NULL AND role NOT IN ('owner', 'admin', 'sales') ORDER BY role, id LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL OR v_sales IS NULL THEN
    RAISE EXCEPTION 'need one owner, one admin and one sales profile to test as; found owner %, admin %, sales %. Nothing changed.',
      v_owner, v_admin, v_sales;
  END IF;
  PERFORM set_config('booking_prices.owner', v_owner::text, false);
  PERFORM set_config('booking_prices.admin', v_admin::text, false);
  PERFORM set_config('booking_prices.sales', v_sales::text, false);
  PERFORM set_config('booking_prices.other', COALESCE(v_other::text, ''), false);
  PERFORM set_config('booking_prices.other_role', COALESCE(v_other_role, ''), false);

  -- The function this file creates, looked up by NAME AS TEXT in the catalog
  -- — never named in executable SQL before its own CREATE (AGENTS.md).
  v_has := EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'catering_save_booking_prices');
  PERFORM pg_temp.note(format('before  catering_save_booking_prices exists: %s (a re-run says true)', v_has));
  PERFORM pg_temp.note(format('before  bookings %s (%s cost-locked), menu lines %s, charges %s, copied courses %s, history lines %s',
    (SELECT count(*) FROM public.catering_events),
    (SELECT count(*) FROM public.catering_events WHERE cost_locked_at IS NOT NULL),
    (SELECT count(*) FROM public.catering_event_menus),
    (SELECT count(*) FROM public.catering_event_charges),
    (SELECT count(*) FROM public.catering_event_menu_items),
    (SELECT count(*) FROM public.catering_event_activity_log)));
  PERFORM pg_temp.note(format('before  history lines reading exactly "ลบเมนู: -": %s — left as they are; the function writes the name from now on',
    (SELECT count(*) FROM public.catering_event_activity_log WHERE description = 'ลบเมนู: -')));
  PERFORM set_config('booking_prices.n_events',  (SELECT count(*) FROM public.catering_events)::text, false);
  PERFORM set_config('booking_prices.n_lines',   (SELECT count(*) FROM public.catering_event_menus)::text, false);
  PERFORM set_config('booking_prices.n_charges', (SELECT count(*) FROM public.catering_event_charges)::text, false);
  PERFORM set_config('booking_prices.n_items',   (SELECT count(*) FROM public.catering_event_menu_items)::text, false);
  PERFORM set_config('booking_prices.n_log',     (SELECT count(*) FROM public.catering_event_activity_log)::text, false);
  PERFORM set_config('booking_prices.n_sets',    (SELECT count(*) FROM public.catering_set_menus)::text, false);
  PERFORM set_config('booking_prices.n_set_items', (SELECT count(*) FROM public.catering_set_menu_items)::text, false);
  PERFORM set_config('booking_prices.checksum',  pg_temp.checksum(), false);
END
$do$;

-- ── Step 1: the one save of the price box ──────────────────────────────────
--
-- SECURITY INVOKER, deliberately: every INSERT, UPDATE and DELETE below runs
-- under the caller's own RLS as well as the explicit checks. The one call
-- that bypasses a policy is catering_copy_set_menu, under its own checks —
-- the call the app makes today when a set is picked.

CREATE OR REPLACE FUNCTION public.catering_save_booking_prices(
  p_event_id       uuid,
  p_lines          jsonb,
  p_known_menu_ids jsonb   DEFAULT NULL,
  p_dry_run        boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  c_qty_max   constant numeric := 100000;
  c_money_max constant numeric := 100000000;
  c_types     constant text[]  := ARRAY['food', 'drink', 'venue', 'service', 'transport', 'equipment', 'other', 'discount'];
  c_uuid      constant text    := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  c_nothing   constant text    := ' — ยังไม่ได้บันทึกอะไร';
  v_role     text := public.current_role();
  v_unit     text := 'โต๊ะ';
  v_line     jsonb;
  v_step     jsonb;
  v_plan     jsonb := '[]'::jsonb;
  v_stored   jsonb;
  v_i        integer := 0;
  v_kind     text;
  v_emid     uuid;
  v_ref      uuid;
  v_qty      numeric;
  v_name     text;
  v_label    text;
  v_type     text;
  v_price    numeric;
  v_amount   numeric;
  v_known    uuid[];
  v_sent     uuid[] := ARRAY[]::uuid[];
  v_remove   uuid[] := ARRAY[]::uuid[];
  v_elsewhere uuid[] := ARRAY[]::uuid[];
  v_matches  uuid[];
  v_new_refs text[] := ARRAY[]::text[];
  v_new_names text[] := ARRAY[]::text[];
  v_id       uuid;
  v_msort    integer;
  v_n        integer;
  r          record;
BEGIN
  -- ── WHO, AND WHAT SHAPE ──────────────────────────────────────────────────
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์บันทึกรายการราคาของงาน';
  END IF;
  -- Neither a check nor a save: refused, rather than read as one of them
  -- (a NULL would otherwise write without taking the booking's lock).
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (p_dry_run)%', c_nothing;
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการในกล่องราคา)%', c_nothing;
  END IF;
  IF p_known_menu_ids IS NOT NULL AND jsonb_typeof(p_known_menu_ids) = 'array' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_known_menu_ids) AS k(v)
                WHERE jsonb_typeof(k.v) IS DISTINCT FROM 'string' OR NOT ((k.v #>> '{}') ~ c_uuid)) THEN
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่หน้าจอเปิดไว้)%', c_nothing;
    END IF;
    v_known := ARRAY(SELECT (k.v #>> '{}')::uuid FROM jsonb_array_elements(p_known_menu_ids) AS k(v));
  ELSIF p_known_menu_ids IS NOT NULL AND jsonb_typeof(p_known_menu_ids) <> 'null' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่หน้าจอเปิดไว้)%', c_nothing;
  END IF;

  -- ── WHICH BOOKING. A new one has no row yet: only a dry run may go without.
  IF p_event_id IS NULL THEN
    IF NOT p_dry_run THEN
      RAISE EXCEPTION 'ไม่พบข้อมูลงาน';
    END IF;
  ELSE
    SELECT CASE e.food_format WHEN 'chinese_table' THEN 'โต๊ะ' WHEN 'box_set' THEN 'กล่อง' ELSE 'ชุด' END
      INTO v_unit
      FROM public.catering_events e WHERE e.id = p_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ไม่พบข้อมูลงาน';
    END IF;
    IF NOT p_dry_run THEN
      -- Two booking-screen saves of one booking queue here: the second waits
      -- for the first to commit, then reads the lines it wrote. So does
      -- anything that adds a line or a charge to the booking (the foreign key
      -- takes a share lock on this row). The menu page's price and course
      -- edits do not wait here: README queue item 48.
      PERFORM 1 FROM public.catering_events e WHERE e.id = p_event_id FOR UPDATE;
    END IF;
    -- For everyone, owner and admin included, as the app has always done:
    -- they unlock on the cost page first.
    IF NOT public.catering_event_unlocked(p_event_id) THEN
      RAISE EXCEPTION 'ต้นทุนของงานนี้ถูกล็อกแล้ว ปลดล็อกก่อนจึงจะแก้ไขได้';
    END IF;
  END IF;

  -- ── EVERY LINE, CHECKED BEFORE ANYTHING IS WRITTEN ───────────────────────
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
    END IF;
    v_kind := v_line->>'kind';

    IF v_kind IN ('set', 'dish') THEN
      IF jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (จำนวนของรายการที่ %)%', v_i, c_nothing;
      END IF;
      v_qty := (v_line->>'quantity')::numeric;
      v_emid := NULL;
      v_ref := NULL;
      IF jsonb_typeof(v_line->'eventMenuId') = 'string' THEN
        IF p_event_id IS NULL OR NOT ((v_line->>'eventMenuId') ~ c_uuid) THEN
          RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
        END IF;
        v_emid := (v_line->>'eventMenuId')::uuid;
        -- A LINE THE BOOKING STORES: judged by its STORED kind, named by its
        -- own name.
        SELECT CASE WHEN m.set_menu_id IS NOT NULL OR m.menu_id IS NULL THEN 'set' ELSE 'dish' END,
               COALESCE(m.set_name, s.name, d.name,
                        (SELECT c.label FROM public.catering_event_charges c
                          WHERE c.event_menu_id = m.id ORDER BY c.sort_order, c.id LIMIT 1),
                        'รายการที่ ' || v_i)
          INTO v_kind, v_name
          FROM public.catering_event_menus m
          LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
          LEFT JOIN public.menus d ON d.id = m.menu_id
         WHERE m.id = v_emid AND m.event_id = p_event_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'รายการหนึ่งในกล่องราคาถูกลบหรือเปลี่ยนจากหน้าอื่นหลังจากเปิดหน้านี้ — กดโหลดข้อมูลล่าสุด แล้วทำใหม่%', c_nothing;
        END IF;
        IF v_emid = ANY (v_sent) THEN
          RAISE EXCEPTION 'ชุดเมนูหรือเมนูเดียวกันอยู่ในกล่องราคา 2 บรรทัด — ลบบรรทัดที่ซ้ำก่อนบันทึก%', c_nothing;
        END IF;
        v_sent := v_sent || v_emid;
      ELSIF jsonb_typeof(v_line->'eventMenuId') IS NULL OR jsonb_typeof(v_line->'eventMenuId') = 'null' THEN
        -- A NEW LINE: the set or dish it names must exist.
        IF jsonb_typeof(v_line->'refId') IS DISTINCT FROM 'string' OR NOT ((v_line->>'refId') ~ c_uuid) THEN
          RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
        END IF;
        v_ref := (v_line->>'refId')::uuid;
        IF v_kind = 'set' THEN
          SELECT s.name INTO v_name FROM public.catering_set_menus s WHERE s.id = v_ref;
        ELSE
          SELECT d.name INTO v_name FROM public.menus d WHERE d.id = v_ref;
        END IF;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ไม่พบชุดเมนูหรือเมนูที่เลือก (รายการที่ %) — อาจถูกลบไปแล้ว%', v_i, c_nothing;
        END IF;
        IF (v_kind || ':' || v_ref::text) = ANY (v_new_refs) THEN
          RAISE EXCEPTION '"%" อยู่ในกล่องราคา 2 บรรทัด — ลบบรรทัดที่ซ้ำก่อนบันทึก%', v_name, c_nothing;
        END IF;
        v_new_refs := v_new_refs || (v_kind || ':' || v_ref::text);
      ELSE
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
      END IF;

      -- THE QUANTITY RULE (booking-lines.ts): a set counts whole tables,
      -- boxes or sets; a dish takes up to three decimals.
      IF v_kind = 'set' THEN
        IF v_qty <> trunc(v_qty) OR v_qty < 1 OR v_qty > c_qty_max THEN
          RAISE EXCEPTION '"%": จำนวน%ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป ไม่เกิน 100,000%', v_name, v_unit, c_nothing;
        END IF;
      ELSIF v_qty <= 0 OR v_qty > c_qty_max OR v_qty <> round(v_qty, 3) THEN
        RAISE EXCEPTION '"%": จำนวนต้องมากกว่า 0 ไม่เกิน 100,000 และมีทศนิยมไม่เกิน 3 ตำแหน่ง%', v_name, c_nothing;
      END IF;

      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'kind', v_kind, 'emid', v_emid, 'ref', v_ref, 'qty', v_qty, 'name', v_name));

    ELSIF v_kind = 'charge' THEN
      IF jsonb_typeof(v_line->'label') IS DISTINCT FROM 'string' OR btrim(v_line->>'label') = '' THEN
        RAISE EXCEPTION 'มีรายการที่ยังไม่มีชื่อในกล่องราคา (รายการที่ %) — ใส่ชื่อ หรือลบแถวนั้น%', v_i, c_nothing;
      END IF;
      v_label := btrim(v_line->>'label');
      v_type := v_line->>'charge_type';
      IF v_type IS NULL OR NOT (v_type = ANY (c_types)) THEN
        RAISE EXCEPTION '"%": ประเภทรายการไม่ถูกต้อง%', v_label, c_nothing;
      END IF;
      IF v_type = 'food' THEN
        RAISE EXCEPTION '"%": อาหารต้องเลือกจากชุดเมนูหรือเมนูเดี่ยว — รายการที่พิมพ์เองหรือเลือกจากอัตราใช้ประเภทอาหารไม่ได้%', v_label, c_nothing;
      END IF;
      IF jsonb_typeof(v_line->'unit_price') IS DISTINCT FROM 'number'
         OR jsonb_typeof(v_line->'quantity') IS DISTINCT FROM 'number'
         OR jsonb_typeof(v_line->'amount') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION '"%": ราคา จำนวน และยอดเงินต้องเป็นตัวเลข%', v_label, c_nothing;
      END IF;
      v_price := (v_line->>'unit_price')::numeric;
      v_qty := (v_line->>'quantity')::numeric;
      v_amount := (v_line->>'amount')::numeric;
      IF abs(v_price) > c_money_max OR abs(v_amount) > c_money_max THEN
        RAISE EXCEPTION '"%": ยอดเงินต้องไม่เกิน 100,000,000 บาท%', v_label, c_nothing;
      END IF;
      IF v_qty < 0 OR v_qty > c_qty_max THEN
        RAISE EXCEPTION '"%": จำนวนต้องอยู่ระหว่าง 0 ถึง 100,000%', v_label, c_nothing;
      END IF;
      IF v_type = 'discount' THEN
        IF v_amount > 0 THEN
          RAISE EXCEPTION '"%": ส่วนลดต้องเป็นยอดติดลบหรือ 0%', v_label, c_nothing;
        END IF;
      ELSIF v_price < 0 OR v_amount < 0 THEN
        RAISE EXCEPTION '"%": ราคาและยอดเงินต้องไม่ติดลบ — ถ้าเป็นส่วนลด ให้ใช้แถวส่วนลด%', v_label, c_nothing;
      END IF;
      IF jsonb_typeof(v_line->'rate_id') = 'string' THEN
        IF NOT ((v_line->>'rate_id') ~ c_uuid)
           OR NOT EXISTS (SELECT 1 FROM public.catering_rates t WHERE t.id = (v_line->>'rate_id')::uuid) THEN
          RAISE EXCEPTION '"%": ไม่พบอัตราที่เลือก — อาจถูกลบไปแล้ว เลือกใหม่ หรือพิมพ์รายการเอง%', v_label, c_nothing;
        END IF;
      ELSIF jsonb_typeof(v_line->'rate_id') IS DISTINCT FROM 'null' THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง ("%")%', v_label, c_nothing;
      END IF;
      IF jsonb_typeof(v_line->'note') IS NOT NULL AND jsonb_typeof(v_line->'note') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง ("%")%', v_label, c_nothing;
      END IF;

      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'kind', 'charge', 'label', v_label, 'type', v_type, 'price', v_price, 'qty', v_qty,
        'amount', v_amount, 'note', nullif(btrim(v_line->>'note'), ''), 'rate', v_line->>'rate_id'));
    ELSE
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (รายการที่ %)%', v_i, c_nothing;
    END IF;
  END LOOP;

  -- ── WHAT THE PAYLOAD MEANS FOR THE LINES THE BOOKING STORES ──────────────
  IF p_event_id IS NOT NULL THEN
    -- The lines the screen had and dropped. NULL known ids: every stored line.
    SELECT COALESCE(array_agg(m.id ORDER BY m.id), ARRAY[]::uuid[]) INTO v_remove
      FROM public.catering_event_menus m
     WHERE m.event_id = p_event_id
       AND NOT (m.id = ANY (v_sent))
       AND (v_known IS NULL OR m.id = ANY (v_known));
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(v_plan) - 1 LOOP
    v_step := v_plan->v_i;
    CONTINUE WHEN v_step->>'kind' = 'charge' OR (v_step->>'emid') IS NOT NULL;
    v_ref := (v_step->>'ref')::uuid;
    v_matches := ARRAY[]::uuid[];
    IF p_event_id IS NOT NULL THEN
      SELECT COALESCE(array_agg(m.id ORDER BY m.id), ARRAY[]::uuid[]) INTO v_matches
        FROM public.catering_event_menus m
       WHERE m.event_id = p_event_id
         AND NOT (m.id = ANY (v_remove))
         AND CASE WHEN v_step->>'kind' = 'set' THEN m.set_menu_id = v_ref ELSE m.menu_id = v_ref END;
    END IF;
    IF v_matches && v_sent THEN
      RAISE EXCEPTION '"%" อยู่ในกล่องราคาแล้ว — แก้จำนวนในบรรทัดเดิมแทน%', v_step->>'name', c_nothing;
    END IF;
    IF cardinality(v_matches) > 1 THEN
      RAISE EXCEPTION '"%" อยู่ในงานนี้มากกว่า 1 บรรทัดแล้ว — กดโหลดข้อมูลล่าสุด แล้วลบบรรทัดที่ซ้ำก่อน%', v_step->>'name', c_nothing;
    END IF;
    IF cardinality(v_matches) = 1 THEN
      -- The booking gained a line for this same set or dish ELSEWHERE since
      -- the screen opened: this line is that one, as the save always treated
      -- it (it used to add to it, then write the screen's quantity over it).
      v_plan := jsonb_set(v_plan, ARRAY[v_i::text, 'emid'], to_jsonb(v_matches[1]::text));
      v_sent := v_sent || v_matches[1];
      CONTINUE;
    END IF;
    IF v_step->>'kind' = 'set' THEN
      -- A5: one set of a name per booking — against every set line that stays
      -- and every other new set of this payload.
      IF lower(btrim(v_step->>'name')) = ANY (v_new_names)
         OR EXISTS (SELECT 1
                      FROM public.catering_event_menus m
                      LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
                     WHERE m.event_id = p_event_id AND m.menu_id IS NULL
                       AND NOT (m.id = ANY (v_remove))
                       AND lower(btrim(COALESCE(m.set_name, s.name,
                             (SELECT c.label FROM public.catering_event_charges c WHERE c.event_menu_id = m.id ORDER BY c.sort_order, c.id LIMIT 1),
                             ''))) = lower(btrim(v_step->>'name'))) THEN
        RAISE EXCEPTION 'งานนี้มีชุดชื่อ "%" อยู่แล้ว — แก้จำนวนในบรรทัดเดิม หรือลบชุดเดิมก่อน%', v_step->>'name', c_nothing;
      END IF;
      v_new_names := v_new_names || lower(btrim(v_step->>'name'));
    END IF;
  END LOOP;

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'lines', jsonb_array_length(v_plan), 'removed', cardinality(v_remove));
  END IF;

  -- ── THE WRITE: one transaction, so a failure anywhere below undoes all of it
  --
  -- 0. The booking's conflict token moves with its price box. The screen
  --    writes the booking's fields first, in a transaction of their own; a
  --    screen that took the booking between the two held the new token and
  --    the OLD price box, and its save then passed the token check and wrote
  --    its stale price box over this one (review, 2026-09-21).
  UPDATE public.catering_events e SET updated_at = now() WHERE e.id = p_event_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ไม่พบข้อมูลงาน%', c_nothing;
  END IF;

  -- Each stored line's charge, read BEFORE anything is deleted: a kept line's
  -- label, price and note come from here.
  SELECT COALESCE(jsonb_object_agg(x.event_menu_id::text, jsonb_build_object(
           'label', x.label, 'unit_price', x.unit_price, 'quantity', x.quantity, 'amount', x.amount, 'note', x.note)),
         '{}'::jsonb)
    INTO v_stored
    FROM (SELECT DISTINCT ON (c.event_menu_id) c.event_menu_id, c.label, c.unit_price, c.quantity, c.amount, c.note
            FROM public.catering_event_charges c
           WHERE c.event_id = p_event_id AND c.event_menu_id IS NOT NULL
           ORDER BY c.event_menu_id, c.sort_order, c.id) x;

  -- 1. The lines the screen dropped, each named in the history by its OWN
  --    name — a custom or copied set's set_name first.
  FOR r IN SELECT m.id,
                  COALESCE(m.set_name, s.name, d.name, v_stored->(m.id::text)->>'label', 'ชุดเมนูของงาน') AS name
             FROM public.catering_event_menus m
             LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
             LEFT JOIN public.menus d ON d.id = m.menu_id
            WHERE m.id = ANY (v_remove)
            ORDER BY m.sort_order, m.id LOOP
    DELETE FROM public.catering_event_menus m WHERE m.id = r.id;
    INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
      VALUES (p_event_id, auth.uid(), 'menu_removed', 'ลบเมนู: ' || r.name);
  END LOOP;

  -- 2. Every charge the payload rewrites. The charges of lines created
  --    ELSEWHERE since the screen opened stay as they are.
  SELECT COALESCE(array_agg(m.id), ARRAY[]::uuid[]) INTO v_elsewhere
    FROM public.catering_event_menus m
   WHERE m.event_id = p_event_id AND NOT (m.id = ANY (v_sent));
  DELETE FROM public.catering_event_charges c
   WHERE c.event_id = p_event_id
     AND (c.event_menu_id IS NULL OR NOT (c.event_menu_id = ANY (v_elsewhere)));

  -- 3. The payload, in print order.
  SELECT COALESCE(max(m.sort_order), 0) INTO v_msort FROM public.catering_event_menus m WHERE m.event_id = p_event_id;
  FOR v_i IN 0 .. jsonb_array_length(v_plan) - 1 LOOP
    v_step := v_plan->v_i;
    IF v_step->>'kind' = 'charge' THEN
      INSERT INTO public.catering_event_charges
        (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order)
      VALUES
        (p_event_id, v_step->>'label', v_step->>'type', (v_step->>'price')::numeric, (v_step->>'qty')::numeric,
         (v_step->>'amount')::numeric, v_step->>'note', NULL, (v_step->>'rate')::uuid, (v_i + 1) * 10);
      CONTINUE;
    END IF;

    v_qty := (v_step->>'qty')::numeric;
    IF (v_step->>'emid') IS NOT NULL THEN
      -- A kept line: the quantity sent, and its charge back at THE STORED
      -- PRICE (the menu page edits it; the screen never sends one).
      v_id := (v_step->>'emid')::uuid;
      UPDATE public.catering_event_menus m SET quantity = v_qty WHERE m.id = v_id AND m.quantity IS DISTINCT FROM v_qty;
      IF v_stored ? v_id::text THEN
        v_label := v_stored->(v_id::text)->>'label';
        v_price := (v_stored->(v_id::text)->>'unit_price')::numeric;
        -- Saved at the quantity it had, it keeps the amount it had: a save
        -- that changes nothing changes nothing.
        v_amount := CASE WHEN (v_stored->(v_id::text)->>'quantity')::numeric = v_qty
                         THEN (v_stored->(v_id::text)->>'amount')::numeric
                         ELSE round(v_price * v_qty, 2) END;
        INSERT INTO public.catering_event_charges
          (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order)
        VALUES
          (p_event_id, v_label, 'food', v_price, v_qty, v_amount, v_stored->(v_id::text)->>'note', v_id, NULL, (v_i + 1) * 10);
      ELSE
        -- A stored line without a charge (none today): priced from its set or
        -- dish, as when it was picked.
        SELECT COALESCE(m.set_name, s.name, d.name, v_step->>'name'), COALESCE(s.price_per_set, d.selling_price, 0)
          INTO v_label, v_price
          FROM public.catering_event_menus m
          LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
          LEFT JOIN public.menus d ON d.id = m.menu_id
         WHERE m.id = v_id;
        INSERT INTO public.catering_event_charges
          (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order)
        VALUES
          (p_event_id, v_label, 'food', v_price, v_qty, round(v_price * v_qty, 2), NULL, v_id, NULL, (v_i + 1) * 10);
      END IF;
    ELSE
      -- A NEW line: its row, the booking's own copy of a set, and its charge
      -- at the set's or dish's price.
      v_ref := (v_step->>'ref')::uuid;
      v_msort := v_msort + 10;
      IF v_step->>'kind' = 'set' THEN
        SELECT s.name, s.price_per_set INTO v_label, v_price FROM public.catering_set_menus s WHERE s.id = v_ref;
        INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order)
          VALUES (p_event_id, v_ref, NULL, v_qty, v_msort)
          RETURNING id INTO v_id;
        PERFORM public.catering_copy_set_menu(v_id);
      ELSE
        SELECT d.name, d.selling_price INTO v_label, v_price FROM public.menus d WHERE d.id = v_ref;
        INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order)
          VALUES (p_event_id, NULL, v_ref, v_qty, v_msort)
          RETURNING id INTO v_id;
      END IF;
      INSERT INTO public.catering_event_charges
        (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order)
      VALUES
        (p_event_id, v_label, 'food', v_price, v_qty, round(v_price * v_qty, 2), NULL, v_id, NULL, (v_i + 1) * 10);
      INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
        VALUES (p_event_id, auth.uid(), 'menu_added', 'เพิ่มเมนู: ' || v_label);
    END IF;
  END LOOP;

  -- 4. Lines created elsewhere keep their charges, printed after the rest.
  v_n := jsonb_array_length(v_plan);
  FOR r IN SELECT c.id FROM public.catering_event_charges c
            WHERE c.event_id = p_event_id AND c.event_menu_id = ANY (v_elsewhere)
            ORDER BY c.sort_order, c.id LOOP
    v_n := v_n + 1;
    UPDATE public.catering_event_charges c SET sort_order = v_n * 10 WHERE c.id = r.id;
  END LOOP;

  -- 5. One history line for the price box, as the save always wrote.
  INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
    VALUES (p_event_id, auth.uid(), 'charges_updated', 'แก้ไขรายการค่าใช้จ่าย');

  RETURN jsonb_build_object('dry_run', false, 'lines', jsonb_array_length(v_plan), 'removed', cardinality(v_remove));
END
$fn$;

COMMENT ON FUNCTION public.catering_save_booking_prices(uuid, jsonb, jsonb, boolean) IS
  'ONE save of the booking screen''s price box (Nik, 2026-09-21): removes the lines the screen dropped '
  '(named in the history by their own name), rewrites every charge of the payload, adds new lines with '
  'the booking''s own copy of a set, and keeps lines created elsewhere since the screen opened — in one '
  'transaction that also moves the booking''s updated_at (the screen''s conflict token), after checking every line. '
  'A kept menu line''s price is the stored one. Owner, admin, sales; refuses a locked booking for everyone. '
  'p_dry_run checks and writes nothing. SECURITY INVOKER.';

-- ── Step 2: tests, as real accounts, every write rolled back ───────────────
--
-- Inside one block that ends by raising a private SQLSTATE, so the cloned
-- booking, its lines, copies and charges, the test set menus, the lock, and
-- every re-save of a real booking all go, whatever the outcome. The results
-- are carried out by a VARIABLE (see v_log).

-- Re-saves one booking exactly as the screen would send it unedited, as one
-- account, dry run then the real save, and ALWAYS rolls back. 'same' when its
-- charges, menu lines and copied courses read exactly as before, AND nothing
-- outside the booking changed.
CREATE OR REPLACE FUNCTION pg_temp.save_unchanged(p_who uuid, p_event uuid)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  -- Everything from pg_temp is read HERE, as the file's own role: once the
  -- block below becomes the app's role, only plain SQL on public tables runs.
  v_payload jsonb := pg_temp.payload_of(p_event);
  v_known   jsonb := pg_temp.known_of(p_event);
  v_fp_sql  text  := pg_temp.fp_sql(p_event);
  v_ln_sql  text  := pg_temp.lines_sql(p_event);
  v_os_sql  text  := pg_temp.others_sql(p_event);
  v_me      text  := current_user::text;
  v_fp0     text;
  v_fp1     text;
  v_ln0     text;
  v_ln1     text;
  v_os0     text;
  v_os1     text;
  v_out     text;
BEGIN
  EXECUTE v_fp_sql INTO v_fp0;
  EXECUTE v_ln_sql INTO v_ln0;
  EXECUTE v_os_sql INTO v_os0;
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_who::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', p_who::text, true);
    PERFORM set_config('role', 'authenticated', true);
    IF current_user::text <> 'authenticated' THEN
      v_out := 'NOT IMPERSONATED';
    ELSE
      PERFORM public.catering_save_booking_prices(p_event, v_payload, v_known, true);
      PERFORM public.catering_save_booking_prices(p_event, v_payload, v_known, false);
      EXECUTE v_fp_sql INTO v_fp1;
      EXECUTE v_ln_sql INTO v_ln1;
      -- Everything outside the booking, read back as the file's own role,
      -- which sees every row, like the reading before.
      PERFORM set_config('role', v_me, true);
      EXECUTE v_os_sql INTO v_os1;
      v_out := CASE WHEN v_fp1 IS DISTINCT FROM v_fp0 OR v_ln1 IS DISTINCT FROM v_ln0 THEN 'CHANGED'
                    WHEN v_os1 IS DISTINCT FROM v_os0 THEN 'CHANGED ANOTHER BOOKING'
                    ELSE 'same' END;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'U0003';
  EXCEPTION
    WHEN SQLSTATE 'U0003' THEN
      RETURN v_out;
    WHEN OTHERS THEN
      RETURN 'refused: ' || SQLERRM;
  END;
END
$fn$;

DO $do$
DECLARE
  owner_   uuid := current_setting('booking_prices.owner')::uuid;
  admin_   uuid := current_setting('booking_prices.admin')::uuid;
  sales_   uuid := current_setting('booking_prices.sales')::uuid;
  other_   uuid := nullif(current_setting('booking_prices.other', true), '')::uuid;
  other_role text := current_setting('booking_prices.other_role', true);
  marker   constant text := 'probe-booking-prices';
  v_u      uuid;   -- an UNLOCKED real booking, cloned for its columns — never written
  v_u_line uuid;   -- a line of a real booking, named by a probe — never written
  v_cols   text;
  v_e      uuid;   -- the clone
  v_l1     uuid;   -- its copied standard set line (10 tables at 4,500)
  v_lc     uuid;   -- its custom set line (2 at 1,000), named ชุดทดสอบลบ-probe
  v_ld     uuid;   -- its single-dish line (3 at 200)
  v_ux     uuid;   -- a dish line "created elsewhere after the screen opened" (7 at 150)
  v_set    uuid;
  v_set_name text;
  v_dish   uuid;
  v_dish_name text;
  v_dish2  uuid;
  v_rate   uuid;
  v_s_ok   uuid;   -- a test set menu of two dishes, 2,500 a table
  v_s_bad  uuid;   -- a test set menu whose one dish is at quantity 0: its copy fails
  v_s_clash uuid;  -- a test set menu named like the clone's custom set
  v_p      jsonb;  -- the price box as the screen had it (without the line created elsewhere)
  v_k      jsonb;  -- the lines the screen knew
  v_fp0    text;
  v_ln0    text;
  v_xmin0  text;   -- the version of the clone's own row before the tests: a write makes a new one
  v_n_items bigint;
  v_res    text;
  v_n      integer := 0;
  v_bad    text := '';
  v_log    text;   -- THE RESULTS, carried out of the rollback by hand
BEGIN
  BEGIN
    SELECT e.id INTO v_u FROM public.catering_events e WHERE e.cost_locked_at IS NULL ORDER BY e.id LIMIT 1;
    SELECT m.id INTO v_u_line FROM public.catering_event_menus m ORDER BY m.id LIMIT 1;
    SELECT s.id, s.name INTO v_set, v_set_name
      FROM public.catering_set_menus s
     WHERE EXISTS (SELECT 1 FROM public.catering_set_menu_items i WHERE i.set_menu_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM public.catering_set_menu_items i WHERE i.set_menu_id = s.id AND i.quantity <= 0)
     ORDER BY s.id LIMIT 1;
    SELECT d.id, d.name INTO v_dish, v_dish_name FROM public.menus d ORDER BY d.id LIMIT 1;
    SELECT d.id INTO v_dish2 FROM public.menus d WHERE d.id <> v_dish ORDER BY d.id LIMIT 1;
    SELECT t.id INTO v_rate FROM public.catering_rates t ORDER BY t.id LIMIT 1;
    IF v_u IS NULL OR v_u_line IS NULL OR v_set IS NULL OR v_dish2 IS NULL OR v_rate IS NULL THEN
      RAISE EXCEPTION 'FAIL    the tests need an unlocked booking, a menu line, a set menu with dishes, two dishes and a rate; found %, %, %, %, %. Nothing applied.',
        v_u, v_u_line, v_set, v_dish2, v_rate;
    END IF;

    -- The clone (the technique of the two earlier catering files), as a
    -- chinese-table booking so a set counts โต๊ะ.
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO v_cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = 'catering_events'
       AND c.is_generated = 'NEVER' AND c.is_identity = 'NO'
       AND c.column_name NOT IN ('id', 'cost_locked_at', 'quote_number', 'created_at', 'updated_at', 'detail_note');
    EXECUTE format('INSERT INTO public.catering_events (%s, detail_note) SELECT %s, %L FROM public.catering_events WHERE id = %L RETURNING id',
      v_cols, v_cols, marker, v_u) INTO v_e;
    UPDATE public.catering_events SET food_format = 'chinese_table' WHERE id = v_e;

    INSERT INTO public.catering_event_menus (event_id, set_menu_id, set_name, quantity, sort_order, note)
      VALUES (v_e, v_set, v_set_name, 10, 10, marker) RETURNING id INTO v_l1;
    INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id, quantity, section, sort_order, note, source_set_menu_id)
      SELECT v_e, v_l1, i.menu_id, i.quantity, i.section, i.sort_order, i.note, v_set
        FROM public.catering_set_menu_items i WHERE i.set_menu_id = v_set;
    INSERT INTO public.catering_event_menus (event_id, set_name, quantity, sort_order, note)
      VALUES (v_e, 'ชุดทดสอบลบ-probe', 2, 20, marker) RETURNING id INTO v_lc;
    INSERT INTO public.catering_event_menus (event_id, menu_id, quantity, sort_order, note)
      VALUES (v_e, v_dish, 3, 30, marker) RETURNING id INTO v_ld;
    INSERT INTO public.catering_event_menus (event_id, menu_id, quantity, sort_order, note)
      VALUES (v_e, v_dish2, 7, 40, marker) RETURNING id INTO v_ux;
    INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, sort_order) VALUES
      (v_e, v_set_name, 'food', 4500, 10, 45000, NULL, v_l1, NULL, 10),
      (v_e, 'ชุดทดสอบลบ-probe', 'food', 1000, 2, 2000, NULL, v_lc, NULL, 20),
      (v_e, v_dish_name, 'food', 200, 3, 600, NULL, v_ld, NULL, 30),
      (v_e, 'ห้องทดสอบ-probe', 'venue', 3000, 1, 3000, NULL, NULL, v_rate, 40),
      (v_e, 'ค่าไฟทดสอบ-probe', 'other', 500, 1, 500, 'หมายเหตุเดิม-probe', NULL, NULL, 50),
      (v_e, 'ส่วนลด', 'discount', 1000, 1, -1000, NULL, NULL, NULL, 60),
      (v_e, 'ของที่เพิ่มจากที่อื่น-probe', 'food', 150, 7, 1050, NULL, v_ux, NULL, 70);

    INSERT INTO public.catering_set_menus (name, price_per_set) VALUES ('ชุดทดสอบเพิ่ม-probe', 2500) RETURNING id INTO v_s_ok;
    INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, sort_order, section)
      VALUES (v_s_ok, v_dish, 1, 10, 'dish'), (v_s_ok, v_dish2, 2, 20, 'dish');
    INSERT INTO public.catering_set_menus (name, price_per_set) VALUES ('ชุดทดสอบเสีย-probe', 1000) RETURNING id INTO v_s_bad;
    INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, sort_order, section)
      VALUES (v_s_bad, v_dish, 0, 10, 'dish');
    INSERT INTO public.catering_set_menus (name, price_per_set) VALUES ('ชุดทดสอบลบ-probe', 999) RETURNING id INTO v_s_clash;

    -- The screen opened BEFORE the line UX was added elsewhere.
    v_p := pg_temp.without(pg_temp.payload_of(v_e), v_ux);
    v_k := (SELECT COALESCE(jsonb_agg(x.v), '[]'::jsonb) FROM jsonb_array_elements(pg_temp.known_of(v_e)) AS x(v) WHERE x.v #>> '{}' <> v_ux::text);
    EXECUTE pg_temp.fp_sql(v_e) INTO v_fp0;
    EXECUTE pg_temp.lines_sql(v_e) INTO v_ln0;
    SELECT count(*) INTO v_n_items FROM public.catering_event_menu_items WHERE event_id = v_e;
    -- now() is the same all through this file's one transaction, so a save
    -- cannot be seen moving updated_at here; that it WRITES the row can be.
    SELECT e.xmin::text INTO v_xmin0 FROM public.catering_events e WHERE e.id = v_e;

    -- ── P1–P4: saves that land ──
    PERFORM pg_temp.t('P1 sales saves the booking unchanged: every charge reads as before (note, rate, discount, order), no line moves, and the line created elsewhere keeps its charge', sales_, 'sales',
      format($q$SELECT 1 WHERE (public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb) ->> 'lines') IS NOT NULL$q$, v_e, v_p, v_k),
      ARRAY['rows=1 check=3'],
      format($q$SELECT 1 WHERE (%s) = %L
              UNION ALL SELECT 1 WHERE (%s) = %L
              UNION ALL SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.quantity = 7 AND c.amount = 1050 AND c.sort_order = 70$q$,
        pg_temp.fp_sql(v_e), v_fp0, pg_temp.lines_sql(v_e), v_ln0, v_ux));
    PERFORM pg_temp.t('P2 owner saves the dish at 0.5: 0.5 on the line and its charge, 100 to the satang', owner_, 'owner',
      format($q$SELECT 1 WHERE (public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb) ->> 'lines') IS NOT NULL$q$, v_e, pg_temp.with_qty(v_p, v_ld, 0.5), v_k),
      ARRAY['rows=1 check=2'],
      format($q$SELECT 1 FROM public.catering_event_menus m WHERE m.id = %L AND m.quantity = 0.5
              UNION ALL SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.quantity = 0.5 AND c.unit_price = 200 AND c.amount = 100$q$,
        v_ld, v_ld));
    PERFORM pg_temp.t('P3 admin saves the set at 12 tables after the menu page set its price to 4,321: the STORED price is kept and the amount follows', admin_, 'admin',
      format($q$DO $d$ BEGIN
                 UPDATE public.catering_event_charges SET unit_price = 4321, amount = 43210 WHERE event_menu_id = %L;
                 PERFORM public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb);
               END $d$$q$, v_l1, v_e, pg_temp.with_qty(v_p, v_l1, 12), v_k),
      ARRAY['rows=0 check=2'],
      format($q$SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.unit_price = 4321 AND c.quantity = 12 AND c.amount = 51852
              UNION ALL SELECT 1 FROM public.catering_event_menus m WHERE m.id = %L AND m.quantity = 12$q$,
        v_l1, v_l1));
    PERFORM pg_temp.t('P4 sales saves unchanged a set whose stored amount was negotiated (44,000 for 10 × 4,500): the amount is kept', sales_, 'sales',
      format($q$DO $d$ BEGIN
                 UPDATE public.catering_event_charges SET amount = 44000 WHERE event_menu_id = %L;
                 PERFORM public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb);
               END $d$$q$, v_l1, v_e, v_p, v_k),
      ARRAY['rows=0 check=1'],
      format($q$SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.unit_price = 4500 AND c.quantity = 10 AND c.amount = 44000$q$, v_l1));

    -- ── P5–P7: removals, named in the history by their own name ──
    PERFORM pg_temp.t('P5 sales drops the custom set: it goes with its charge, the history names it, and no other charge is lost', sales_, 'sales',
      format($q$SELECT 1 WHERE (public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb) ->> 'removed') = '1'$q$, v_e, pg_temp.without(v_p, v_lc), v_k),
      ARRAY['rows=1 check=4'],
      format($q$SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.catering_event_menus WHERE id = %L)
              UNION ALL SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM public.catering_event_charges WHERE event_menu_id = %L)
              UNION ALL SELECT 1 FROM public.catering_event_activity_log l WHERE l.event_id = %L AND l.action_key = 'menu_removed' AND l.description = 'ลบเมนู: ชุดทดสอบลบ-probe' AND l.actor = %L
              UNION ALL SELECT 1 FROM (SELECT count(*) n FROM public.catering_event_charges WHERE event_id = %L) x WHERE x.n = 6$q$,
        v_lc, v_lc, v_e, sales_, v_e));
    PERFORM pg_temp.t('P6 owner drops the copied standard set: its copy goes with it and the history names the set', owner_, 'owner',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$, v_e, pg_temp.without(v_p, v_l1), v_k),
      ARRAY['rows=1 check=2'],
      format($q$SELECT 1 FROM public.catering_event_activity_log l WHERE l.event_id = %L AND l.action_key = 'menu_removed' AND l.description = %L AND l.actor = %L
              UNION ALL SELECT 1 FROM (SELECT count(*) n FROM public.catering_event_menu_items WHERE event_id = %L) x WHERE x.n = 0$q$,
        v_e, 'ลบเมนู: ' || v_set_name, owner_, v_e));
    PERFORM pg_temp.t('P7 sales drops the single dish: the history names the dish', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$, v_e, pg_temp.without(v_p, v_ld), v_k),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_activity_log l WHERE l.event_id = %L AND l.action_key = 'menu_removed' AND l.description = %L AND l.actor = %L$q$,
        v_e, 'ลบเมนู: ' || v_dish_name, sales_));

    -- ── P8–P9: additions ──
    PERFORM pg_temp.t('P8 sales adds a set at 5 tables: its line, its copy of two dishes, its charge at 2,500 × 5, and เพิ่มเมนู in the history', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_s_ok::text, 'eventMenuId', NULL, 'quantity', 5)), v_k),
      ARRAY['rows=1 check=4'],
      format($q$SELECT 1 FROM public.catering_event_menus m WHERE m.event_id = %L AND m.set_menu_id = %L AND m.quantity = 5 AND m.set_name = 'ชุดทดสอบเพิ่ม-probe'
              UNION ALL SELECT 1 FROM (SELECT count(*) n FROM public.catering_event_menu_items i JOIN public.catering_event_menus m ON m.id = i.event_menu_id
                                        WHERE m.event_id = %L AND m.set_menu_id = %L) x WHERE x.n = 2
              UNION ALL SELECT 1 FROM public.catering_event_charges c JOIN public.catering_event_menus m ON m.id = c.event_menu_id
                         WHERE m.event_id = %L AND m.set_menu_id = %L AND c.label = 'ชุดทดสอบเพิ่ม-probe' AND c.charge_type = 'food'
                           AND c.unit_price = 2500 AND c.quantity = 5 AND c.amount = 12500
              UNION ALL SELECT 1 FROM public.catering_event_activity_log l WHERE l.event_id = %L AND l.action_key = 'menu_added'
                           AND l.description = 'เพิ่มเมนู: ชุดทดสอบเพิ่ม-probe' AND l.actor = %L$q$,
        v_e, v_s_ok, v_e, v_s_ok, v_e, v_s_ok, v_e, sales_));
    PERFORM pg_temp.t('P9 sales adds the dish the booking gained elsewhere: the new line IS that line — no second row, its quantity and charge follow the screen', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || jsonb_build_array(jsonb_build_object('kind', 'dish', 'refId', v_dish2::text, 'eventMenuId', NULL, 'quantity', 4)), v_k),
      ARRAY['rows=1 check=3'],
      format($q$SELECT 1 FROM public.catering_event_menus m WHERE m.id = %L AND m.quantity = 4
              UNION ALL SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.quantity = 4 AND c.unit_price = 150 AND c.amount = 600
              UNION ALL SELECT 1 FROM (SELECT count(*) n FROM public.catering_event_menus m WHERE m.event_id = %L AND m.menu_id = %L) x WHERE x.n = 1$q$,
        v_ux, v_ux, v_e, v_dish2));

    -- ── P10: A FAILURE IN THE MIDDLE OF THE WRITE leaves nothing behind ──
    -- The new set's copy fails the courses table's CHECK (its one dish is at
    -- quantity 0) AFTER every charge of the booking was deleted and six were
    -- written back. The wrapper catches that failure inside the probe, so the
    -- check then reads the booking in the same sub-transaction: exactly as
    -- before. This is the price box that used to be left empty.
    PERFORM pg_temp.t('P10 a failure mid-write (a new set whose copy breaks a CHECK, after the charges were deleted and six rewritten): refused, every charge, line and copied course exactly as before', sales_, 'sales',
      format($q$DO $d$ BEGIN
                 PERFORM public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb);
                 RAISE EXCEPTION 'FAIL the save went through although the copy of its new set failed';
               EXCEPTION WHEN check_violation THEN NULL;
               END $d$$q$,
        v_e, v_p || jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_s_bad::text, 'eventMenuId', NULL, 'quantity', 1)), v_k),
      ARRAY['rows=0 check=3'],
      format($q$SELECT 1 WHERE (%s) = %L
              UNION ALL SELECT 1 WHERE (%s) = %L
              UNION ALL SELECT 1 FROM (SELECT count(*) n FROM public.catering_event_menu_items WHERE event_id = %L) x WHERE x.n = %s$q$,
        pg_temp.fp_sql(v_e), v_fp0, pg_temp.lines_sql(v_e), v_ln0, v_e, v_n_items));

    -- ── P11–P26: refusals, all before anything is written ──
    PERFORM pg_temp.t('P11 a line removed elsewhere since the screen opened', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || jsonb_build_array(jsonb_build_object('kind', 'dish', 'refId', v_dish::text, 'eventMenuId', '00000000-0000-4000-8000-000000000001', 'quantity', 1)), v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P12 a line of ANOTHER booking under this booking''s id', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', '', 'eventMenuId', v_u_line::text, 'quantity', 1)), v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P13 the set at 2.5 tables', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$, v_e, pg_temp.with_qty(v_p, v_l1, 2.5), v_k),
      ARRAY['refused']);
    IF current_setting('booking_prices.last_refusal', true) NOT LIKE '%จำนวนโต๊ะต้องเป็นจำนวนเต็ม%' THEN
      RAISE EXCEPTION 'FAIL    P13 the refusal does not name the booking''s unit (โต๊ะ): %. Nothing applied.', current_setting('booking_prices.last_refusal', true);
    END IF;
    PERFORM pg_temp.note('        (P13 read: ' || current_setting('booking_prices.last_refusal', true) || ')');
    PERFORM pg_temp.t('P14 the set at 2.5 on a BOX booking', sales_, 'sales',
      format($q$DO $d$ BEGIN
                 UPDATE public.catering_events SET food_format = 'box_set' WHERE id = %L;
                 PERFORM public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb);
               END $d$$q$, v_e, v_e, pg_temp.with_qty(v_p, v_l1, 2.5), v_k),
      ARRAY['refused']);
    IF current_setting('booking_prices.last_refusal', true) NOT LIKE '%จำนวนกล่องต้องเป็นจำนวนเต็ม%' THEN
      RAISE EXCEPTION 'FAIL    P14 the refusal does not name the booking''s unit (กล่อง): %. Nothing applied.', current_setting('booking_prices.last_refusal', true);
    END IF;
    PERFORM pg_temp.note('        (P14 read: ' || current_setting('booking_prices.last_refusal', true) || ')');
    PERFORM pg_temp.t('P15 the dish at 0.0005 (below 0.001, which would print blank)', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$, v_e, pg_temp.with_qty(v_p, v_ld, 0.0005), v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P16 the dish at 1.0005 (four decimals)', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$, v_e, pg_temp.with_qty(v_p, v_ld, 1.0005), v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P17 a charge with no name', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || '[{"kind":"charge","label":"  ","charge_type":"other","unit_price":100,"quantity":1,"amount":100,"note":null,"rate_id":null}]'::jsonb, v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P18 a typed line typed as food', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || '[{"kind":"charge","label":"อาหารพิมพ์เอง","charge_type":"food","unit_price":100,"quantity":1,"amount":100,"note":null,"rate_id":null}]'::jsonb, v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P19 a negative price on a line that is not a discount', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || '[{"kind":"charge","label":"ลดเอง","charge_type":"other","unit_price":-500,"quantity":1,"amount":-500,"note":null,"rate_id":null}]'::jsonb, v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P20 a discount with a positive amount', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || '[{"kind":"charge","label":"ส่วนลด","charge_type":"discount","unit_price":500,"quantity":1,"amount":500,"note":null,"rate_id":null}]'::jsonb, v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P21 an amount that is not a number', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || '[{"kind":"charge","label":"ค่าบริการ","charge_type":"service","unit_price":100,"quantity":1,"amount":"100","note":null,"rate_id":null}]'::jsonb, v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P22 a rate that does not exist', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || '[{"kind":"charge","label":"ห้อง","charge_type":"venue","unit_price":100,"quantity":1,"amount":100,"note":null,"rate_id":"00000000-0000-4000-8000-000000000002"}]'::jsonb, v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P23 a price over 100,000,000', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || '[{"kind":"charge","label":"พิมพ์ผิด","charge_type":"other","unit_price":100000001,"quantity":1,"amount":100000001,"note":null,"rate_id":null}]'::jsonb, v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P24 the same stored line twice', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || jsonb_build_array(jsonb_build_object('kind', 'dish', 'refId', v_dish::text, 'eventMenuId', v_ld::text, 'quantity', 1)), v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P25 a new set named like the custom set the booking keeps', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_s_clash::text, 'eventMenuId', NULL, 'quantity', 1)), v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P26 a line of a kind the screen never sends', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$,
        v_e, v_p || '[{"kind":"xyz","refId":"","eventMenuId":null,"quantity":1}]'::jsonb, v_k),
      ARRAY['refused']);

    -- ── P27–P30: the dry run ──
    PERFORM pg_temp.t('P27 a dry run of a real change (the dish at 0.5) writes nothing, the booking''s own row included', sales_, 'sales',
      format($q$SELECT 1 WHERE (public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb, true) ->> 'dry_run') = 'true'$q$,
        v_e, pg_temp.with_qty(v_p, v_ld, 0.5), v_k),
      ARRAY['rows=1 check=3'],
      format($q$SELECT 1 WHERE (%s) = %L UNION ALL SELECT 1 WHERE (%s) = %L
              UNION ALL SELECT 1 FROM public.catering_events e WHERE e.id = %L AND e.xmin::text = %L$q$,
        pg_temp.fp_sql(v_e), v_fp0, pg_temp.lines_sql(v_e), v_ln0, v_e, v_xmin0));
    PERFORM pg_temp.t('P28 a dry run refuses what the save refuses (a charge with no name)', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb, true)$q$,
        v_e, v_p || '[{"kind":"charge","label":"","charge_type":"other","unit_price":100,"quantity":1,"amount":100,"note":null,"rate_id":null}]'::jsonb, v_k),
      ARRAY['refused']);
    PERFORM pg_temp.t('P29 a dry run for a NEW booking (no row yet) checks its lines', sales_, 'sales',
      format($q$SELECT 1 WHERE (public.catering_save_booking_prices(NULL, %L::jsonb, NULL, true) ->> 'dry_run') = 'true'$q$,
        jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_s_ok::text, 'eventMenuId', NULL, 'quantity', 3),
                          jsonb_build_object('kind', 'charge', 'label', 'ค่าขนส่ง', 'charge_type', 'transport', 'unit_price', 500, 'quantity', 1, 'amount', 500, 'note', NULL, 'rate_id', NULL))),
      ARRAY['rows=1']);
    PERFORM pg_temp.t('P30 a real save naming no booking', sales_, 'sales',
      $q$SELECT public.catering_save_booking_prices(NULL, '[]'::jsonb, NULL, false)$q$,
      ARRAY['refused']);

    -- ── P31: a role the booking screen is not for ──
    IF other_ IS NULL THEN
      PERFORM pg_temp.note('skip    P31 no account with a role other than owner, admin and sales to test as');
    ELSE
      PERFORM pg_temp.t('P31 a role that is not owner, admin or sales', other_, other_role,
        format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb)$q$, v_e, v_p, v_k),
        ARRAY['refused']);
    END IF;

    -- ── P32–P33: the conflict token moves with the price box; a flag that must be given ──
    PERFORM pg_temp.t('P32 a real save writes the booking''s own row in the same transaction, so its updated_at (the booking screen''s conflict token) moves with the price box', sales_, 'sales',
      format($q$SELECT 1 WHERE (public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb) ->> 'lines') IS NOT NULL$q$, v_e, v_p, v_k),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_events e WHERE e.id = %L AND e.xmin::text <> %L$q$, v_e, v_xmin0));
    PERFORM pg_temp.t('P33 a dry-run flag that is NULL, neither a check nor a save', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb, NULL)$q$, v_e, v_p, v_k),
      ARRAY['refused']);

    -- ── E1–E2: EVERY REAL BOOKING, re-saved unchanged, rolled back ──
    -- As sales (who takes bookings) and as owner. A booking whose charges
    -- the new rules would refuse shows here, before any code depends on it.
    FOR v_u IN SELECT e.id FROM public.catering_events e
                WHERE e.cost_locked_at IS NULL AND e.id <> v_e ORDER BY e.id LOOP
      v_n := v_n + 1;
      v_res := pg_temp.save_unchanged(sales_, v_u);
      IF v_res <> 'same' THEN v_bad := v_bad || format(' [sales %s: %s]', v_u, v_res); END IF;
      v_res := pg_temp.save_unchanged(owner_, v_u);
      IF v_res <> 'same' THEN v_bad := v_bad || format(' [owner %s: %s]', v_u, v_res); END IF;
    END LOOP;
    IF v_bad <> '' THEN
      RAISE EXCEPTION 'FAIL    E1 a real booking does not save unchanged:%. Nothing applied. (CHANGED ANOTHER BOOKING alone can also mean someone saved a booking while this file ran: run it again when nobody is saving.)', v_bad;
    END IF;
    PERFORM pg_temp.note(format('ok      E1 every unlocked real booking (%s) saves unchanged through the function, as sales and as owner, and nothing outside it changes — dry run, then the real save, rolled back', v_n));

    -- ── L1–L2: the lock, last ──
    PERFORM pg_temp.t('L1 owner saves the booking after locking it', owner_, 'owner',
      format($q$DO $d$ BEGIN
                 UPDATE public.catering_events SET cost_locked_at = now() WHERE id = %L;
                 PERFORM public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb);
               END $d$$q$, v_e, v_e, v_p, v_k),
      ARRAY['refused']);
    UPDATE public.catering_events SET cost_locked_at = now() WHERE id = v_e;
    PERFORM pg_temp.t('L2 sales saves the LOCKED booking, dry run included', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, %L::jsonb, true)$q$, v_e, v_p, v_k),
      ARRAY['refused']);

    -- The last thing before the abort: take the results out of the setting
    -- and into memory, which the abort cannot reach.
    v_log := current_setting('booking_prices.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      -- The database is back where it was; the record of what was proved is not.
      PERFORM set_config('booking_prices.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (the clone, its lines, copies and charges, the test set menus, the lock, every re-save)');
  END;
END
$do$;

-- ── Step 3: nothing the tests did survived them, and the file reported ─────

DO $do$
DECLARE
  v_rows   bigint;
  -- Every row the file is supposed to emit, counted by hand and asserted
  -- below: 2 self-test, 3 survey, 33 P tests (P31 or its skip line), 2
  -- refusal texts, E1, 2 lock tests, the rollback line, and this step's
  -- count line. Change a test, change this.
  c_expected constant bigint := 45;
BEGIN
  -- One function of the name, so no older signature stays callable beside it.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'catering_save_booking_prices') <> 1 THEN
    RAISE EXCEPTION 'FAIL    more than one function is named catering_save_booking_prices: an older signature would stay callable. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_events WHERE detail_note = 'probe-booking-prices')
     OR EXISTS (SELECT 1 FROM public.catering_set_menus WHERE name LIKE '%-probe') THEN
    RAISE EXCEPTION 'FAIL    a test booking or test set menu remains. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM public.catering_events)::text <> current_setting('booking_prices.n_events')
     OR (SELECT count(*) FROM public.catering_event_menus)::text <> current_setting('booking_prices.n_lines')
     OR (SELECT count(*) FROM public.catering_event_charges)::text <> current_setting('booking_prices.n_charges')
     OR (SELECT count(*) FROM public.catering_event_menu_items)::text <> current_setting('booking_prices.n_items')
     OR (SELECT count(*) FROM public.catering_event_activity_log)::text <> current_setting('booking_prices.n_log')
     OR (SELECT count(*) FROM public.catering_set_menus)::text <> current_setting('booking_prices.n_sets')
     OR (SELECT count(*) FROM public.catering_set_menu_items)::text <> current_setting('booking_prices.n_set_items') THEN
    RAISE EXCEPTION 'FAIL    a row count changed. Nothing applied.';
  END IF;
  IF pg_temp.checksum() <> current_setting('booking_prices.checksum') THEN
    RAISE EXCEPTION 'FAIL    the checksum of every charge, menu line, copied course and booking row changed. Nothing applied.';
  END IF;
  PERFORM pg_temp.note(format('ok      one function of the name; counts unchanged (bookings %s, lines %s, charges %s, copies %s, history %s, set menus %s) and every charge, line, course and booking row byte for byte as before',
    current_setting('booking_prices.n_events'), current_setting('booking_prices.n_lines'), current_setting('booking_prices.n_charges'),
    current_setting('booking_prices.n_items'), current_setting('booking_prices.n_log'), current_setting('booking_prices.n_sets')));

  -- The file checks that its own checks reported (the 2026-09-19 lesson).
  v_rows := pg_temp.logged();
  IF v_rows <> c_expected THEN
    RAISE EXCEPTION
      'FAIL    the result table holds % rows, expected % — a block ran and reported nothing, or was skipped. Nothing applied.',
      v_rows, c_expected;
  END IF;
  PERFORM pg_temp.note(format('ok      row count verified: %s evidence rows emitted, as expected (this line makes %s)',
    v_rows, v_rows + 1));
END
$do$;

COMMIT;

-- ── The result: copy this table back whole ─────────────────────────────────

DROP FUNCTION IF EXISTS
  pg_temp.save_unchanged(uuid, uuid),
  pg_temp.checksum(),
  pg_temp.others_sql(uuid),
  pg_temp.lines_sql(uuid),
  pg_temp.fp_sql(uuid),
  pg_temp.without(jsonb, uuid),
  pg_temp.with_qty(jsonb, uuid, numeric),
  pg_temp.known_of(uuid),
  pg_temp.payload_of(uuid),
  pg_temp.t(text, uuid, text, text, text[], text),
  pg_temp.classify(text, text),
  pg_temp.sql_target(text),
  pg_temp.probe(uuid, text, text),
  pg_temp.logged(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs — in the app (once the code that calls it is deployed) ══
--
-- 1. Open a booking with a set, a dish, a rate and a typed line. Change
--    nothing and press บันทึกอย่างเดียว: every line reads as before.
-- 2. Type a price box line with no name but a price, or a negative price on
--    a typed line, and save: the screen names the line and nothing is saved.
-- 3. Remove a set copied or created on the menu page and save: the history
--    reads "ลบเมนู: <its name>", not "ลบเมนู: -".
-- 4. On a box booking (รูปแบบอาหาร: กล่อง), type 2.5 on a set line and save:
--    the message says จำนวนกล่อง.
-- 5. Open one booking in two tabs. Save in the first; then change something
--    in the second and save: it is refused as saved elsewhere, nothing is
--    written, and โหลดข้อมูลล่าสุด beside the message shows the first tab's
--    save.
