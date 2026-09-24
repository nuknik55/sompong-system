-- ============================================================================
-- Catering: the menu card's hand-typed lines (README item 39)
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. ONE
-- transaction: it records what is live, adds one column, tests it AS REAL
-- ACCOUNTS with every test write rolled back, counts its own result rows, and
-- rolls the whole thing back if anything disagrees. Safe to re-run: the column
-- is ADD COLUMN IF NOT EXISTS and the constraint is added only when missing (a
-- re-run says the column was already there).
--
-- WHY (Nik, 2026-09-24). The menu card placed on each table at an event
-- (/owner/catering/[id]/menu-card) prints every food line the customer
-- ordered. On the print page a person may also type extra lines by hand, one
-- per line, for things that are not in the system (a dessert the customer
-- brings); they print after the ordered dishes, and they are saved with the
-- booking so a reprint keeps them. No existing column fits: detail_note is
-- the sales handover and prints on the service sheet, kitchen_note is for the
-- kitchen and prints on the kitchen sheet, music_note is about music. Those
-- are internal notes; the card must never print them.
--
-- WHAT IT CHANGES
--   catering_events.menu_card_lines text — the hand-typed lines, one per
--   line; NULL when there are none. CHECK: at most 3000 characters (the app
--   allows 20 lines of 100 characters; this is the backstop).
--   Nothing else. The column inherits the table's rules as they are:
--   catering_events_rw (owner, admin and sales read and write) and the cost
--   lock (catering_events_lock_update: on a cost-locked booking only owner and
--   admin may update the row). No new policy, no new grant. The app is
--   stricter than the database on a locked booking, as for every other field:
--   it refuses the save for everyone (assertCostNotLocked), owner and admin
--   included, until the booking is unlocked on the cost page.
--
-- CHANGES NO DATA. Every test write happens inside a block that always rolls
-- back (two test bookings, the writes the tests make); Step 3 checks every
-- count afterwards.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: ALTER TABLE ADD COLUMN ×1 and
-- ADD CONSTRAINT ×1 (only when missing) on catering_events; COMMENT ON COLUMN
-- ×1; CREATE OR REPLACE FUNCTION on the pg_temp helpers and, after COMMIT,
-- DROP FUNCTION IF EXISTS on them; inside the always-aborting test block, two
-- INSERTs of test bookings and the UPDATEs the tests make, all rolled back.
-- Anything else is unexpected: stop and send it. Never "Run and enable RLS".
--
-- THE RESULT is the table the last statement prints. Copy it back whole.
-- ============================================================================

BEGIN;

-- ── Test scaffolding: notes in a session setting, never a table ────────────

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  PERFORM set_config('orders.log',
    COALESCE(current_setting('orders.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('orders.log', true), '');
BEGIN
  PERFORM set_config('orders.log', '', false);
  RETURN QUERY
    SELECT r.i, r.l
      FROM regexp_split_to_table(v_log, chr(30)) WITH ORDINALITY AS r(l, i)
     WHERE r.l <> ''
     ORDER BY r.i;
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.logged()
RETURNS bigint
LANGUAGE sql
STABLE
AS $fn$
  SELECT count(*)
    FROM regexp_split_to_table(COALESCE(current_setting('orders.log', true), ''), chr(30)) AS l
   WHERE l <> '';
$fn$;

-- Runs one statement as one account. By default it ALWAYS rolls the
-- statement back (a private SQLSTATE, caught); with p_keep the statement's
-- writes stay, so a later test can build on them (all of it still inside the
-- always-aborting block of Step 3). Returns the identity it actually ran as,
-- first. With p_check, a SELECT run right after the statement as the same
-- account, whose row count is appended as "check=N".
CREATE OR REPLACE FUNCTION pg_temp.probe(p_who uuid, p_sql text, p_check text DEFAULT NULL, p_keep boolean DEFAULT false)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_me   text := current_user::text;
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
    IF NOT p_keep THEN
      RAISE EXCEPTION USING ERRCODE = 'U0001';
    END IF;
    -- Kept: back to the file's own role by hand (a sub-block that completes
    -- keeps its LOCAL settings).
    PERFORM set_config('role', v_me, true);
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN v_role || ' rows=' || v_n || CASE WHEN p_check IS NULL THEN '' ELSE ' check=' || v_c END;
  EXCEPTION
    WHEN SQLSTATE 'U0001' THEN
      RETURN v_role || ' rows=' || v_n || CASE WHEN p_check IS NULL THEN '' ELSE ' check=' || v_c END;
    WHEN check_violation THEN
      RETURN COALESCE(v_role, '?') || ' check-refused';
    WHEN foreign_key_violation OR restrict_violation THEN
      RETURN COALESCE(v_role, '?') || ' fk-refused';
    WHEN insufficient_privilege THEN
      IF SQLERRM LIKE '%row-level security%' THEN
        RETURN COALESCE(v_role, '?') || ' denied:'
          || COALESCE(substring(SQLERRM from 'table "([^"]+)"'), '?');
      END IF;
      IF SQLERRM LIKE 'permission denied for table %' THEN
        RETURN COALESCE(v_role, '?') || ' denied:' || substring(SQLERRM from 'permission denied for table ([[:alnum:]_]+)');
      END IF;
      RETURN COALESCE(v_role, '?') || ' error 42501 ' || SQLERRM;
    WHEN raise_exception THEN
      -- The functions' own refusals (P0001). The message is kept aside so
      -- the table stays one word per outcome, and printed where it matters.
      PERFORM set_config('orders.last_refusal', SQLERRM, true);
      RETURN COALESCE(v_role, '?') || ' refused';
    WHEN undefined_function THEN
      -- A function that does not exist (42883): the dropped ones.
      RETURN COALESCE(v_role, '?') || ' no-such-function';
    WHEN OTHERS THEN
      RETURN COALESCE(v_role, '?') || ' error ' || SQLSTATE || ' ' || SQLERRM;
  END;
END
$fn$;

-- The table a write statement names. NO BACKSLASH APPEARS IN THIS PATTERN.
CREATE OR REPLACE FUNCTION pg_temp.sql_target(p_sql text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT lower((regexp_match(p_sql,
    '(?:insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(?:[[:alnum:]_]+[.])?([[:alnum:]_]+)',
    'i'))[1]);
$fn$;

-- A refusal counts as 'denied' ONLY when it came from the table the
-- statement writes to; one that cannot be attributed RAISES.
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

CREATE OR REPLACE FUNCTION pg_temp.t(p_label text, p_who uuid, p_role text, p_sql text, p_want text[], p_check text DEFAULT NULL, p_keep boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_got  text := pg_temp.probe(p_who, p_sql, p_check, p_keep);
  v_role text := split_part(v_got, ' ', 1);
  v_res  text := pg_temp.classify(substr(v_got, length(split_part(v_got, ' ', 1)) + 2), p_sql);
BEGIN
  IF v_role IS DISTINCT FROM p_role THEN
    RAISE EXCEPTION '% — ran as %, expected %: the impersonation did not take, so the result means nothing. Nothing applied.',
      p_label, v_role, p_role;
  END IF;
  IF NOT (v_res = ANY (p_want)) THEN
    RAISE EXCEPTION 'FAIL    % — as %, got "%" (%), expected one of %. Nothing applied.',
      p_label, v_role, v_res, COALESCE(current_setting('orders.last_refusal', true), '-'), array_to_string(p_want, ' / ');
  END IF;
  PERFORM pg_temp.note(format('ok      %s — as %s, %s', p_label, v_role, v_res));
END
$fn$;

-- ── The harness tests ITSELF, before it tests anything else ────────────────

DO $do$
DECLARE
  v_here text := 'UPDATE public.catering_events SET detail_note = NULL WHERE id = NULL';
BEGIN
  IF pg_temp.sql_target(v_here) IS DISTINCT FROM 'catering_events'
     OR pg_temp.sql_target('insert into catering_event_menus (event_id) values (NULL)') IS DISTINCT FROM 'catering_event_menus'
     OR pg_temp.sql_target('DELETE FROM public.profiles WHERE id = NULL') IS DISTINCT FROM 'profiles' THEN
    RAISE EXCEPTION 'the harness cannot name the table a write statement targets. Nothing applied.';
  END IF;
  IF pg_temp.classify('denied:catering_events', v_here) IS DISTINCT FROM 'denied'
     OR pg_temp.classify('denied:profiles', v_here) NOT LIKE 'error (a policy on another table)%'
     OR pg_temp.classify('rows=1', v_here) IS DISTINCT FROM 'rows=1' THEN
    RAISE EXCEPTION 'the harness misreads a refusal. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      X1 the harness names the table a write targets, reads a refusal from it as "denied", and one from another table as an error');
END
$do$;

-- ── Step 0: what is live, and the accounts the tests need ──────────────────

DO $do$
DECLARE
  v_owner  uuid;
  v_admin  uuid;
  v_sales  uuid;
  v_editor uuid;
  v_staff  uuid;
  v_hr     uuid;
BEGIN
  IF to_regclass('public.catering_events') IS NULL THEN
    RAISE EXCEPTION 'catering_events is missing. Nothing changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'catering_events' AND column_name = 'cost_locked_at') THEN
    RAISE EXCEPTION 'catering_events.cost_locked_at is missing: the cost lock has not been installed. Nothing changed.';
  END IF;
  BEGIN
    PERFORM 'public.current_role()'::regprocedure;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'public.current_role() is missing. Nothing changed.';
  END;

  SELECT id INTO v_owner  FROM public.profiles WHERE role = 'owner'  ORDER BY id LIMIT 1;
  SELECT id INTO v_admin  FROM public.profiles WHERE role = 'admin'  ORDER BY id LIMIT 1;
  SELECT id INTO v_sales  FROM public.profiles WHERE role = 'sales'  ORDER BY id LIMIT 1;
  SELECT id INTO v_editor FROM public.profiles WHERE role = 'editor' ORDER BY id LIMIT 1;
  SELECT id INTO v_staff  FROM public.profiles WHERE role = 'staff'  ORDER BY id LIMIT 1;
  SELECT id INTO v_hr     FROM public.profiles WHERE role = 'hr'     ORDER BY id LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL OR v_sales IS NULL OR v_editor IS NULL OR v_staff IS NULL OR v_hr IS NULL THEN
    RAISE EXCEPTION 'need an owner, admin, sales, editor, staff and hr profile to test as. Nothing changed.';
  END IF;
  PERFORM set_config('card.owner',  v_owner::text,  false);
  PERFORM set_config('card.admin',  v_admin::text,  false);
  PERFORM set_config('card.sales',  v_sales::text,  false);
  PERFORM set_config('card.editor', v_editor::text, false);
  PERFORM set_config('card.staff',  v_staff::text,  false);
  PERFORM set_config('card.hr',     v_hr::text,     false);
  PERFORM set_config('card.n_events', (SELECT count(*) FROM public.catering_events)::text, false);
  PERFORM set_config('card.fingerprint',
    (SELECT md5(COALESCE(string_agg(id::text || status || updated_at::text || COALESCE(cost_locked_at::text, ''), ',' ORDER BY id), ''))
       FROM public.catering_events), false);
  PERFORM pg_temp.note(format('before  bookings %s (%s), cost-locked %s; menu_card_lines exists: %s (a re-run says true)',
    current_setting('card.n_events'),
    COALESCE((SELECT string_agg(status || ' ' || n, ', ' ORDER BY status)
                FROM (SELECT status, count(*) AS n FROM public.catering_events GROUP BY status) s), 'none'),
    (SELECT count(*) FROM public.catering_events WHERE cost_locked_at IS NOT NULL),
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'catering_events' AND column_name = 'menu_card_lines')));
END
$do$;

-- ── Step 1: the column ─────────────────────────────────────────────────────

ALTER TABLE public.catering_events ADD COLUMN IF NOT EXISTS menu_card_lines text;

DO $do$
DECLARE
  v_added boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.catering_events'::regclass
                    AND conname = 'catering_events_menu_card_lines_length') THEN
    ALTER TABLE public.catering_events ADD CONSTRAINT catering_events_menu_card_lines_length
      CHECK (menu_card_lines IS NULL OR char_length(menu_card_lines) <= 3000);
    v_added := true;
  END IF;
  PERFORM pg_temp.note(format('ok      the column menu_card_lines (text) is there, and its length check (at most 3000 characters) %s',
    CASE WHEN v_added THEN 'was added' ELSE 'was already there (a re-run)' END));
END
$do$;

COMMENT ON COLUMN public.catering_events.menu_card_lines IS
  'The menu card''s hand-typed lines (/owner/catering/[id]/menu-card), one per line, printed after the ordered dishes; NULL when none. Customer-facing: never an internal note. Nik, 2026-09-24.';

-- ── Step 2: tests, as real accounts, every write rolled back ───────────────

DO $do$
DECLARE
  owner_  uuid := current_setting('card.owner')::uuid;
  admin_  uuid := current_setting('card.admin')::uuid;
  sales_  uuid := current_setting('card.sales')::uuid;
  editor_ uuid := current_setting('card.editor')::uuid;
  staff_  uuid := current_setting('card.staff')::uuid;
  hr_     uuid := current_setting('card.hr')::uuid;
  v_open   uuid;
  v_locked uuid;
  v_lines  text := 'ขนมเค้กวันเกิด (ลูกค้านำมาเอง)' || chr(10) || 'ผลไม้รวม';
  v_log    text;
BEGIN
  BEGIN
    -- Two test bookings, written as the file's own role; the block always
    -- rolls back, so neither survives.
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note)
    VALUES (DATE '2099-01-01', 'in_house', 'air_shared', 'catering', 'confirmed', 'probe-menu-card')
    RETURNING id INTO v_open;
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note, cost_locked_at)
    VALUES (DATE '2099-01-02', 'in_house', 'air_shared', 'catering', 'confirmed', 'probe-menu-card', now())
    RETURNING id INTO v_locked;
    PERFORM pg_temp.note('ok      two test bookings made (one open, one cost-locked), to be rolled back');

    -- ── Who may write the lines on an open booking ──
    PERFORM pg_temp.t('W1 sales writes two lines on the open booking', sales_, 'sales',
      format($q$UPDATE public.catering_events SET menu_card_lines = %L WHERE id = %L$q$, v_lines, v_open),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_events WHERE id = %L AND menu_card_lines = %L$q$, v_open, v_lines));
    PERFORM pg_temp.t('W2 admin writes the lines on the open booking', admin_, 'admin',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_open), ARRAY['rows=1']);
    PERFORM pg_temp.t('W3 owner writes the lines on the open booking', owner_, 'owner',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_open), ARRAY['rows=1']);
    PERFORM pg_temp.t('W4 sales clears the lines (NULL) on the open booking', sales_, 'sales',
      format($q$UPDATE public.catering_events SET menu_card_lines = NULL WHERE id = %L$q$, v_open), ARRAY['rows=1']);
    PERFORM pg_temp.t('R1 sales reads the lines of the open booking', sales_, 'sales',
      format($q$SELECT menu_card_lines FROM public.catering_events WHERE id = %L$q$, v_open), ARRAY['rows=1']);

    -- ── A cost-locked booking: the database admits owner and admin only ──
    PERFORM pg_temp.t('L1 sales writes the lines on the cost-locked booking', sales_, 'sales',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_locked), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('L2 admin writes the lines on the cost-locked booking (the database allows it; the app refuses it)', admin_, 'admin',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_locked), ARRAY['rows=1']);
    PERFORM pg_temp.t('L3 owner writes the lines on the cost-locked booking (the database allows it; the app refuses it)', owner_, 'owner',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_locked), ARRAY['rows=1']);

    -- ── Roles with no catering access write nothing ──
    PERFORM pg_temp.t('N1 editor writes the lines on the open booking', editor_, 'editor',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_open), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('N2 staff writes the lines on the open booking', staff_, 'staff',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_open), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('N3 hr writes the lines on the open booking', hr_, 'hr',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_open), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('N4 a login with no profile writes the lines on the open booking', gen_random_uuid(), 'no-profile',
      format($q$UPDATE public.catering_events SET menu_card_lines = 'probe' WHERE id = %L$q$, v_open), ARRAY['rows=0', 'denied']);

    -- ── The length check ──
    PERFORM pg_temp.t('C1 owner writes 3000 characters (the limit)', owner_, 'owner',
      format($q$UPDATE public.catering_events SET menu_card_lines = repeat('ก', 3000) WHERE id = %L$q$, v_open), ARRAY['rows=1']);
    PERFORM pg_temp.t('C2 owner writes 3001 characters', owner_, 'owner',
      format($q$UPDATE public.catering_events SET menu_card_lines = repeat('ก', 3001) WHERE id = %L$q$, v_open), ARRAY['check-refused']);

    IF (SELECT menu_card_lines FROM public.catering_events WHERE id = v_open) IS NOT NULL
       OR (SELECT menu_card_lines FROM public.catering_events WHERE id = v_locked) IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL    a test write survived its own rollback. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      read back: after every test both test bookings still have no lines (each test rolled its own write back)');

    v_log := current_setting('orders.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('orders.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (the two test bookings and every write the tests made)');
  END;
END
$do$;

-- ── Step 3: nothing the tests did survived them, and the file reported ─────

DO $do$
DECLARE
  v_rows bigint;
  -- Every row the file is supposed to emit, counted by the checker's rule
  -- (a t() or a note() is one row). Change a test, change this.
  c_expected constant bigint := 21;
BEGIN
  IF (SELECT count(*) FROM public.catering_events)::text <> current_setting('card.n_events')
     OR (SELECT md5(COALESCE(string_agg(id::text || status || updated_at::text || COALESCE(cost_locked_at::text, ''), ',' ORDER BY id), ''))
           FROM public.catering_events) <> current_setting('card.fingerprint') THEN
    RAISE EXCEPTION 'FAIL    a booking was added or removed, or a booking''s status, updated_at or lock changed. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'catering_events' AND column_name = 'menu_card_lines' AND data_type = 'text') <> 1 THEN
    RAISE EXCEPTION 'FAIL    catering_events.menu_card_lines is not one text column. Nothing applied.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.catering_events', 'menu_card_lines', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.catering_events', 'menu_card_lines', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL    signed-in accounts cannot read or write the new column (the table''s grants did not reach it). Nothing applied.';
  END IF;
  PERFORM pg_temp.note(format('ok      bookings as before (%s), every booking''s status, updated_at and lock byte for byte; one text column; signed-in accounts may read and write it, under the table''s policies',
    current_setting('card.n_events')));

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
  pg_temp.t(text, uuid, text, text, text[], text, boolean),
  pg_temp.classify(text, text),
  pg_temp.sql_target(text),
  pg_temp.probe(uuid, text, text, boolean),
  pg_temp.logged(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs ════════════════════════════════════════════════════════
--
-- Nothing changes on screen until the menu card's code is pushed (it waits
-- for this file). Then: open a booking → พิมพ์ → การ์ดเมนูบนโต๊ะ, type a line,
-- save, reload: the line is still there and prints after the dishes.
