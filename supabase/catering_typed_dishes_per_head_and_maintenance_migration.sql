-- ============================================================================
-- Catering: typed dishes and per-head lines; แจ้งซ่อม: cancel instead of
-- delete, and every maintenance write through a database function
-- (Nik, 2026-09-25). ONE file, run once.
--
-- WHAT IT DOES
--   A. TYPED DISHES — a dish that is not in the menu list. A dish row of a
--      shared set (catering_set_menu_items) or of a booking's own menu
--      (catering_event_menu_items) is EITHER a menu dish (menu_id) OR a typed
--      name (dish_name), never both and never neither; a typed name is 1–120
--      characters with no spaces around it, and one name appears once per set
--      or per booking line. Owner and admin may LINK a typed dish to a real
--      menu (linked_menu_id, typed rows only): documents keep printing the
--      typed name, the cost follows the linked menu. The link is checked by
--      a trigger, NOT a foreign key: a second foreign key from these tables to
--      menus would make the live code's reads of menus(name) ambiguous.
--        catering_copy_set_menu      REPLACED: copies typed rows and links too.
--        catering_save_event_menus   REPLACED: owner/admin save typed rows and
--                                    links, and a per-head custom set.
--        catering_save_set_draft     REPLACED: a draft may hold typed rows.
--        catering_save_typed_dishes  NEW: the ONE way sales writes a booking's
--                                    menu — typed rows only, never a menu dish,
--                                    never a link, refused on a cancelled or
--                                    cost-locked booking (for everyone).
--      Each replaced function is checked first against the body it copied
--      (md5 of the live body); anything else stops the file, nothing changed.
--   B. PER HEAD — catering_set_menus.per_head and catering_event_menus.per_head.
--      A per-head line is price per guest × guests (quantity = guests). A
--      line takes its set's flag when it is created (trigger) and keeps it:
--      changing it later is refused. A custom set chooses it when made.
--      Per-table sets are exactly as before; no price, total or charge is
--      computed differently in SQL.
--   C. แจ้งซ่อม — status 'cancelled' with cancelled_by, cancelled_by_name,
--      cancelled_at and cancel_note. Five SECURITY DEFINER functions are the
--      ONLY writes: maint_create, maint_edit, maint_take, maint_done,
--      maint_cancel, each checking role, status and reporter. The direct
--      INSERT and UPDATE policies (maint_insert, and maint_update with its
--      missing WITH CHECK) are DROPPED and INSERT/UPDATE/DELETE on the table
--      are REVOKED from anon and authenticated. Reading stays as it is
--      (maint_read). Photos and storage are not touched.
--
-- CHANGES NO DATA. Every test write happens inside a block that always rolls
-- back; Step 5 checks every count and fingerprint afterwards.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: ALTER TABLE ALTER COLUMN
-- menu_id DROP NOT NULL ×2 (the two dish tables) and ALTER TABLE ADD COLUMN
-- ×10 (only when missing), six of them run by EXECUTE in a loop; ALTER TABLE DROP CONSTRAINT maintenance_reports_status_check
-- and ADD CONSTRAINT ×9 (only when missing, the status CHECK re-added with
-- 'cancelled'); CREATE UNIQUE INDEX ×2 (IF NOT EXISTS);
-- CREATE OR REPLACE FUNCTION ×13 in public (three of them replacements) and
-- the pg_temp helpers; CREATE TRIGGER ×4 (each dropped first if it exists,
-- one of them on menus: a menu deleted clears the links to it);
-- DROP POLICY IF EXISTS maint_insert and maint_update; REVOKE INSERT, UPDATE,
-- DELETE, TRUNCATE on maintenance_reports; GRANT and REVOKE EXECUTE on the
-- new functions; COMMENT ON the new columns and functions; after COMMIT,
-- DROP FUNCTION IF EXISTS on the pg_temp helpers; inside the always-aborting
-- test block, the test writes. Anything else is unexpected: stop and send
-- it. Never "Run and enable RLS".
--
-- WHAT SQL CANNOT TEST, AND IS LEFT TO THE APP AND THE CHECKS AFTER: how
-- the screens print a typed dish and a per-head line (the documents are the
-- app's), the totals, the discount and the deposit on a per-head line (the
-- charge rows are the same shape as today's; the app adds them up), the
-- cost page's flags, and a photo upload (storage is not touched).
--
-- RUN IT WHILE NOBODY IS SAVING A BOOKING'S MENU OR A SET MENU, OR FILING
-- A แจ้งซ่อม (Step 5 compares the counts).
--
-- DEPLOY ORDER: this file FIRST, then the code that uses it. The code live
-- when this runs keeps working (it writes แจ้งซ่อม with the service key,
-- which this file does not touch, and no second foreign key to menus is
-- added, so its reads of menus(name) stay unambiguous). The new code needs
-- these columns and functions. And once a typed dish or a per-head set
-- exists, do not roll the code back past it: fix forward.
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
    IF p_who IS NULL THEN
      -- No account: the anon role, as a visitor who is not signed in.
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('role', 'anon', true);
      v_role := CASE WHEN current_user::text = 'anon' THEN 'anon' ELSE 'not-anon' END;
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', p_who::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', p_who::text, true);
      PERFORM set_config('role', 'authenticated', true);
      v_role := CASE WHEN current_user::text = 'authenticated'
                     THEN COALESCE(public.current_role(), 'no-profile')
                     ELSE 'not-authenticated' END;
    END IF;
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
    WHEN unique_violation THEN
      RETURN COALESCE(v_role, '?') || ' dup-refused';
    WHEN insufficient_privilege THEN
      IF SQLERRM LIKE '%row-level security%' THEN
        RETURN COALESCE(v_role, '?') || ' denied:'
          || COALESCE(substring(SQLERRM from 'table "([^"]+)"'), '?');
      END IF;
      IF SQLERRM LIKE 'permission denied for table %' THEN
        RETURN COALESCE(v_role, '?') || ' denied:' || substring(SQLERRM from 'permission denied for table ([[:alnum:]_]+)');
      END IF;
      IF SQLERRM LIKE 'permission denied for function %' THEN
        RETURN COALESCE(v_role, '?') || ' no-execute';
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
    '(?:insert[[:space:]]+into|update|delete[[:space:]]+from|from)[[:space:]]+(?:[[:alnum:]_]+[.])?([[:alnum:]_]+)',
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
  v_got  text;
  v_role text;
  v_res  text;
BEGIN
  -- A refusal message belongs to the test that raised it, never the next.
  PERFORM set_config('orders.last_refusal', '', true);
  v_got  := pg_temp.probe(p_who, p_sql, p_check, p_keep);
  v_role := split_part(v_got, ' ', 1);
  v_res  := pg_temp.classify(substr(v_got, length(split_part(v_got, ' ', 1)) + 2), p_sql);
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

-- A refusal counts only when it was for the rule under test: the message
-- the function raised must name it. Emits no row; raises when it does not.
CREATE OR REPLACE FUNCTION pg_temp.said(p_label text, p_text text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF position(p_text IN COALESCE(current_setting('orders.last_refusal', true), '')) = 0 THEN
    RAISE EXCEPTION 'FAIL    % — refused, but not for the rule under test: "%". Nothing applied.',
      p_label, COALESCE(current_setting('orders.last_refusal', true), '-');
  END IF;
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
  IF pg_temp.sql_target('SELECT id FROM public.catering_detail_blocks WHERE id = NULL') IS DISTINCT FROM 'catering_detail_blocks' THEN
    RAISE EXCEPTION 'the harness cannot name the table a read comes from. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      X1 the harness names the table a write targets or a read comes from, reads a refusal from it as "denied", and one from another table as an error');
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
  v_def    text;
  t        text;
BEGIN
  FOREACH t IN ARRAY ARRAY['public.catering_events', 'public.catering_event_menus', 'public.catering_event_menu_items',
                           'public.catering_event_charges', 'public.catering_set_menus', 'public.catering_set_menu_items',
                           'public.menus', 'public.profiles', 'public.maintenance_reports'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '% is missing. Nothing changed.', t;
    END IF;
  END LOOP;
  BEGIN
    PERFORM 'public.catering_copy_set_menu(uuid)'::regprocedure;
    PERFORM 'public.catering_save_event_menus(uuid, jsonb)'::regprocedure;
    PERFORM 'public.catering_save_set_draft(uuid, timestamptz, text, numeric, jsonb)'::regprocedure;
    PERFORM 'public.catering_save_booking_prices(uuid, jsonb, jsonb, boolean)'::regprocedure;
    PERFORM 'public.catering_event_unlocked(uuid)'::regprocedure;
    PERFORM 'public.current_role()'::regprocedure;
    PERFORM 'public.touch_updated_at()'::regprocedure;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'a function this file needs or replaces is missing: %. Nothing changed.', SQLERRM;
  END;
  -- THE THREE FUNCTIONS THIS FILE REPLACES must be the bodies it copied (or
  -- this file's own, on a re-run). Anything else is a change this file would
  -- silently undo. Carriage returns are ignored, as the editor may send
  -- either line ending.
  IF md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.catering_copy_set_menu(uuid)'::regprocedure), chr(13), ''))
       NOT IN ('9f18d23339caa6a9c8703d03535dea10', 'b438fe7516ac752bdc77ff5ca3546b1f') THEN
    RAISE EXCEPTION 'the live catering_copy_set_menu is not the body this file copied (live md5 %). Nothing changed.',
      md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.catering_copy_set_menu(uuid)'::regprocedure), chr(13), ''));
  END IF;
  IF md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.catering_save_event_menus(uuid, jsonb)'::regprocedure), chr(13), ''))
       NOT IN ('f0729eb23f1a0efdb2a67fa69245a046', 'e778edbac45e5ca9f9800e7841b89be7') THEN
    RAISE EXCEPTION 'the live catering_save_event_menus is not the body this file copied (live md5 %). Nothing changed.',
      md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.catering_save_event_menus(uuid, jsonb)'::regprocedure), chr(13), ''));
  END IF;
  IF md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.catering_save_set_draft(uuid, timestamptz, text, numeric, jsonb)'::regprocedure), chr(13), ''))
       NOT IN ('820ba8c71572ccb40762642d544be6b6', '8f086fba394aaccb402f59b4013b2846') THEN
    RAISE EXCEPTION 'the live catering_save_set_draft is not the body this file copied (live md5 %). Nothing changed.',
      md5(replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.catering_save_set_draft(uuid, timestamptz, text, numeric, jsonb)'::regprocedure), chr(13), ''));
  END IF;
  -- maintenance_reports as the repo and a read-only look at the data
  -- (2026-09-25) have it: the columns this file writes, and the status CHECK
  -- as 012_two_stage_approval.sql added it (or as this file re-adds it).
  IF (SELECT count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'maintenance_reports'
         AND c.column_name IN ('id', 'reporter_id', 'reporter_name', 'category', 'location', 'description', 'is_urgent',
                               'photo_before', 'photo_after', 'status', 'resolved_at', 'resolver_id', 'resolver_note',
                               'resolver_name', 'updated_at')) <> 15 THEN
    RAISE EXCEPTION 'maintenance_reports does not have the columns this file writes. Nothing changed.';
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.maintenance_reports'::regclass AND c.conname = 'maintenance_reports_status_check';
  IF v_def IS NULL
     OR regexp_replace(v_def, '[[:space:]]', '', 'g') NOT IN (
          'CHECK((status=ANY(ARRAY[''new''::text,''in_progress''::text,''done''::text])))',
          'CHECK((status=ANY(ARRAY[''new''::text,''in_progress''::text,''done''::text,''cancelled''::text])))') THEN
    RAISE EXCEPTION 'maintenance_reports_status_check is not the CHECK this file expects (%). Nothing changed.', COALESCE(v_def, 'missing');
  END IF;

  SELECT id INTO v_owner  FROM public.profiles WHERE role = 'owner'  ORDER BY id LIMIT 1;
  SELECT id INTO v_admin  FROM public.profiles WHERE role = 'admin'  ORDER BY id LIMIT 1;
  SELECT id INTO v_sales  FROM public.profiles WHERE role = 'sales'  ORDER BY id LIMIT 1;
  SELECT id INTO v_editor FROM public.profiles WHERE role = 'editor' ORDER BY id LIMIT 1;
  SELECT id INTO v_staff  FROM public.profiles WHERE role = 'staff'  ORDER BY id LIMIT 1;
  SELECT id INTO v_hr     FROM public.profiles WHERE role = 'hr'     ORDER BY id LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL OR v_sales IS NULL OR v_editor IS NULL OR v_staff IS NULL OR v_hr IS NULL THEN
    RAISE EXCEPTION 'need an owner, admin, sales, editor, staff and hr profile to test as. Nothing changed.';
  END IF;
  IF (SELECT count(*) FROM public.menus WHERE selling_price > 0) < 2 THEN
    RAISE EXCEPTION 'need two dishes with a price to test with. Nothing changed.';
  END IF;
  PERFORM set_config('m62.owner',  v_owner::text,  false);
  PERFORM set_config('m62.admin',  v_admin::text,  false);
  PERFORM set_config('m62.sales',  v_sales::text,  false);
  PERFORM set_config('m62.editor', v_editor::text, false);
  PERFORM set_config('m62.staff',  v_staff::text,  false);
  PERFORM set_config('m62.hr',     v_hr::text,     false);

  PERFORM set_config('m62.n_events',   (SELECT count(*) FROM public.catering_events)::text, false);
  PERFORM set_config('m62.n_sets',     (SELECT count(*) FROM public.catering_set_menus)::text, false);
  PERFORM set_config('m62.n_setitems', (SELECT count(*) FROM public.catering_set_menu_items)::text, false);
  PERFORM set_config('m62.n_lines',    (SELECT count(*) FROM public.catering_event_menus)::text, false);
  PERFORM set_config('m62.n_copies',   (SELECT count(*) FROM public.catering_event_menu_items)::text, false);
  PERFORM set_config('m62.n_charges',  (SELECT count(*) FROM public.catering_event_charges)::text, false);
  PERFORM set_config('m62.n_maint',    (SELECT count(*) FROM public.maintenance_reports)::text, false);
  PERFORM set_config('m62.fp_events',
    (SELECT md5(COALESCE(string_agg(id::text || status || updated_at::text || COALESCE(cost_locked_at::text, ''), ',' ORDER BY id), ''))
       FROM public.catering_events), false);
  PERFORM set_config('m62.fp_charges',
    (SELECT md5(COALESCE(string_agg(id::text || label || unit_price::text || quantity::text || amount::text, ',' ORDER BY id), ''))
       FROM public.catering_event_charges), false);
  PERFORM set_config('m62.fp_lines',
    (SELECT md5(COALESCE(string_agg(id::text || quantity::text || COALESCE(set_name, '') || COALESCE(set_menu_id::text, ''), ',' ORDER BY id), ''))
       FROM public.catering_event_menus), false);
  PERFORM set_config('m62.fp_maint',
    (SELECT md5(COALESCE(string_agg(id::text || status || updated_at::text, ',' ORDER BY id), ''))
       FROM public.maintenance_reports), false);
  PERFORM pg_temp.note(format('before  bookings %s, sets %s (dish rows %s), booking lines %s (copied dishes %s), charges %s, แจ้งซ่อม %s (new %s, in progress %s, done %s); the three replaced functions are the bodies copied; the status CHECK as expected; typed dishes exist: %s, per_head exists: %s, cancelled status exists: %s (a re-run says true, true, true)',
    current_setting('m62.n_events'), current_setting('m62.n_sets'), current_setting('m62.n_setitems'),
    current_setting('m62.n_lines'), current_setting('m62.n_copies'), current_setting('m62.n_charges'),
    current_setting('m62.n_maint'),
    (SELECT count(*) FROM public.maintenance_reports WHERE status = 'new'),
    (SELECT count(*) FROM public.maintenance_reports WHERE status = 'in_progress'),
    (SELECT count(*) FROM public.maintenance_reports WHERE status = 'done'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'catering_event_menu_items' AND column_name = 'dish_name'),
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'catering_event_menus' AND column_name = 'per_head'),
    position('cancelled' IN v_def) > 0));
END
$do$;

-- ── Step 1: the columns, the CHECKs, the indexes ───────────────────────────

-- A. A dish row is a menu dish OR a typed name; B. per head. The same
-- columns on two tables each, so each is added by ONE statement in a loop.
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['catering_set_menu_items', 'catering_event_menu_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN menu_id DROP NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS dish_name text, ADD COLUMN IF NOT EXISTS linked_menu_id uuid', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['catering_set_menus', 'catering_event_menus'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS per_head boolean NOT NULL DEFAULT false', t);
  END LOOP;
END
$do$;
-- C. The cancel, recorded.
ALTER TABLE public.maintenance_reports ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id);
ALTER TABLE public.maintenance_reports ADD COLUMN IF NOT EXISTS cancelled_by_name text;
ALTER TABLE public.maintenance_reports ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.maintenance_reports ADD COLUMN IF NOT EXISTS cancel_note text;

-- A typed name: 1-120 characters, no space around it, and none of the
-- characters that print as nothing or break a line (a tab, a line break, a
-- no-break space, the zero-width ones): a name made of them printed blank,
-- and two names that differed only by one passed the one-name rule (review,
-- 2026-09-25). IMMUTABLE, so the CHECK below can use it.
CREATE OR REPLACE FUNCTION public.catering_dish_name_ok(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p_name IS NOT NULL AND char_length(p_name) BETWEEN 1 AND 120 AND p_name = btrim(p_name)
     AND p_name !~ ('[' || chr(9) || chr(10) || chr(13) || chr(160) || chr(8203) || chr(8204) || chr(8205) || chr(8288) || chr(65279) || ']');
$fn$;

DO $do$
DECLARE
  t text;
  v_added text[] := ARRAY[]::text[];
BEGIN
  FOREACH t IN ARRAY ARRAY['catering_set_menu_items', 'catering_event_menu_items'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_dish_one_kind') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((menu_id IS NULL) <> (dish_name IS NULL))', t, t || '_dish_one_kind');
      v_added := v_added || (t || ': a menu dish or a typed name, never both, never neither');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_dish_name_ok') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (dish_name IS NULL OR public.catering_dish_name_ok(dish_name))', t, t || '_dish_name_ok');
      v_added := v_added || (t || ': a typed name 1-120 characters, no space around, no character that prints as nothing');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass AND conname = t || '_link_only_typed') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (linked_menu_id IS NULL OR dish_name IS NOT NULL)', t, t || '_link_only_typed');
      v_added := v_added || (t || ': only a typed dish is linked');
    END IF;
  END LOOP;
  -- The status CHECK, with 'cancelled'. Dropped and re-added only while it
  -- lacks it, so a re-run leaves it alone.
  IF position('cancelled' IN pg_get_constraintdef((SELECT c.oid FROM pg_constraint c
        WHERE c.conrelid = 'public.maintenance_reports'::regclass AND c.conname = 'maintenance_reports_status_check'))) = 0 THEN
    ALTER TABLE public.maintenance_reports DROP CONSTRAINT maintenance_reports_status_check;
    ALTER TABLE public.maintenance_reports ADD CONSTRAINT maintenance_reports_status_check
      CHECK (status IN ('new', 'in_progress', 'done', 'cancelled'));
    v_added := v_added || 'maintenance status: new, in_progress, done, cancelled'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.maintenance_reports'::regclass AND conname = 'maintenance_reports_cancel_recorded') THEN
    ALTER TABLE public.maintenance_reports ADD CONSTRAINT maintenance_reports_cancel_recorded
      CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL));
    v_added := v_added || 'a cancelled report says who and when, and only a cancelled one'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.maintenance_reports'::regclass AND conname = 'maintenance_reports_cancel_note_len') THEN
    ALTER TABLE public.maintenance_reports ADD CONSTRAINT maintenance_reports_cancel_note_len
      CHECK (cancel_note IS NULL OR char_length(cancel_note) <= 500);
    v_added := v_added || 'a cancel note at most 500 characters'::text;
  END IF;
  PERFORM pg_temp.note(format('ok      checks added: %s', CASE WHEN cardinality(v_added) = 0 THEN 'none (a re-run: all present)' ELSE array_to_string(v_added, '; ') END));
END
$do$;

-- One typed name once per set, and once per booking line (case-folded).
CREATE UNIQUE INDEX IF NOT EXISTS uq_catering_set_menu_items_dish_name
  ON public.catering_set_menu_items (set_menu_id, lower(dish_name)) WHERE dish_name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_catering_event_menu_items_dish_name
  ON public.catering_event_menu_items (event_menu_id, lower(dish_name)) WHERE dish_name IS NOT NULL;

COMMENT ON COLUMN public.catering_set_menu_items.dish_name IS
  'A dish that is not in the menu list, typed by name (Nik, 2026-09-25). Exactly one of menu_id and dish_name. Printed as typed.';
COMMENT ON COLUMN public.catering_set_menu_items.linked_menu_id IS
  'A typed dish linked to a real menu for its COST only; the typed name still prints. Typed rows only.';
COMMENT ON COLUMN public.catering_event_menu_items.dish_name IS
  'A dish that is not in the menu list, typed by name (Nik, 2026-09-25). Exactly one of menu_id and dish_name. Printed as typed. Sales may add, edit and remove these (catering_save_typed_dishes) and nothing else here.';
COMMENT ON COLUMN public.catering_event_menu_items.linked_menu_id IS
  'A typed dish linked to a real menu for its COST only (owner, admin); the typed name still prints. Typed rows only.';
COMMENT ON COLUMN public.catering_set_menus.per_head IS
  'price_per_set is a price PER GUEST and a line''s quantity is the number of guests (Nik, 2026-09-25). A booking line takes this when it is created and keeps it.';
COMMENT ON COLUMN public.catering_event_menus.per_head IS
  'This line is priced per guest: its charge is price per guest × guests (quantity). Fixed when the line is created (trigger).';
COMMENT ON COLUMN public.maintenance_reports.cancelled_by IS
  'Who cancelled the report (maint_cancel). A report is cancelled instead of deleted (Nik, 2026-09-25).';

-- ── Step 2: the functions and the trigger ──────────────────────────────────

-- A. THE SET COPY, REPLACED: as catering_event_sheet_and_set_drafts_migration.sql
-- wrote it, with a typed row's name and link copied too.
CREATE OR REPLACE FUNCTION public.catering_copy_set_menu(p_event_menu_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role     text := public.current_role();
  v_event    uuid;
  v_set      uuid;
  v_set_name text;
  v_n        integer;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์คัดลอกชุดเมนู';
  END IF;

  SELECT m.event_id, m.set_menu_id INTO v_event, v_set
    FROM public.catering_event_menus m WHERE m.id = p_event_menu_id;
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'ไม่พบรายการชุดเมนูของงาน';
  END IF;
  IF v_set IS NULL THEN
    RAISE EXCEPTION 'รายการนี้ไม่ได้อ้างอิงชุดเมนูกลาง จึงไม่มีอะไรให้คัดลอก';
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_set_menus s WHERE s.id = v_set AND s.is_draft) THEN
    RAISE EXCEPTION 'ชุดเมนูนี้ยังเป็นฉบับร่าง ใช้กับงานไม่ได้';
  END IF;
  IF NOT public.catering_event_unlocked(v_event) THEN
    RAISE EXCEPTION 'ต้นทุนของงานนี้ถูกล็อกแล้ว รายการอาหารถูกตรึงไว้';
  END IF;
  -- A copy that was MADE is the record, however many rows it holds now — an
  -- owner may empty a set to rebuild it, and that must not read as "never
  -- copied". The marker is set_name, stamped below; rows without it (a
  -- direct insert) count too. Never overwritten from here.
  IF (SELECT m.set_name FROM public.catering_event_menus m WHERE m.id = p_event_menu_id) IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.catering_event_menu_items i WHERE i.event_menu_id = p_event_menu_id) THEN
    RETURN 0;
  END IF;

  SELECT s.name INTO v_set_name FROM public.catering_set_menus s WHERE s.id = v_set;

  INSERT INTO public.catering_event_menu_items
    (event_id, event_menu_id, menu_id, dish_name, linked_menu_id, quantity, section, sort_order, note, source_set_menu_id)
  SELECT v_event, p_event_menu_id, i.menu_id, i.dish_name, i.linked_menu_id, i.quantity, i.section, i.sort_order, i.note, v_set
    FROM public.catering_set_menu_items i
   WHERE i.set_menu_id = v_set
   ORDER BY i.sort_order, i.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.catering_event_menus SET set_name = COALESCE(set_name, v_set_name, 'ชุดเมนู') WHERE id = p_event_menu_id;
  RETURN v_n;
END
$fn$;

-- A + B. THE BOOKING MENU SAVE (owner, admin), REPLACED: as
-- catering_event_menu_save_migration.sql wrote it, with a course that is a
-- menu dish OR a typed name (and, for owner and admin, a typed name's link
-- to a real menu), and a new custom set that may be priced per head.
CREATE OR REPLACE FUNCTION public.catering_save_event_menus(p_event_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_role   text := public.current_role();
  v_line   jsonb;
  v_item   jsonb;
  v_id     uuid;
  v_menu   uuid;
  v_dish   text;
  v_link   uuid;
  v_name   text;
  v_price  numeric;
  v_tables numeric;
  v_head   boolean;
  v_qty    numeric;
  v_sort   integer;
  v_n      integer;
  v_live   text[];
  v_known  text[];
  v_out    jsonb := '[]'::jsonb;
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่แก้ไขรายการอาหารของงานได้';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catering_events e WHERE e.id = p_event_id) THEN
    RAISE EXCEPTION 'ไม่พบข้อมูลงาน';
  END IF;
  IF NOT public.catering_event_unlocked(p_event_id) THEN
    RAISE EXCEPTION 'ต้นทุนของงานนี้ถูกล็อกแล้ว ปลดล็อกก่อนจึงจะแก้ไขได้';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'ไม่มีรายการที่เปลี่ยนแปลง';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_price := (v_line->>'price_per_table')::numeric;
    IF v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'ราคาต้องเป็นตัวเลข 0 หรือมากกว่า';
    END IF;
    IF jsonb_typeof(v_line->'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (items)';
    END IF;

    IF (v_line->>'event_menu_id') IS NULL THEN
      -- A NEW custom set: the set line and its food charge. Per head when the
      -- screen says so: then its count is guests and its price is per guest.
      v_name   := nullif(btrim(v_line->>'set_name'), '');
      v_tables := (v_line->>'tables')::numeric;
      IF COALESCE(jsonb_typeof(v_line->'per_head'), 'null') NOT IN ('null', 'boolean') THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (per_head)';
      END IF;
      v_head := COALESCE((v_line->>'per_head')::boolean, false);
      IF v_name IS NULL THEN
        RAISE EXCEPTION 'ชุดเมนูของงานต้องมีชื่อ';
      END IF;
      IF v_tables IS NULL OR v_tables <= 0 THEN
        RAISE EXCEPTION 'จำนวนต้องมากกว่า 0';
      END IF;
      -- A5 (Nik, 2026-09-19): a NEW set may not take a name another set line
      -- of this booking already goes by. Existing lines are never refused.
      IF EXISTS (SELECT 1
                   FROM public.catering_event_menus m
                   LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
                   LEFT JOIN public.catering_event_charges c ON c.event_menu_id = m.id
                  WHERE m.event_id = p_event_id AND m.menu_id IS NULL
                    AND lower(btrim(COALESCE(m.set_name, s.name, c.label))) = lower(v_name)) THEN
        RAISE EXCEPTION 'มีชุดชื่อ "%" อยู่ในงานนี้แล้ว — ตั้งชื่อชุดใหม่ให้ต่างกัน', v_name;
      END IF;
      SELECT COALESCE(max(m.sort_order), 0) + 10 INTO v_sort FROM public.catering_event_menus m WHERE m.event_id = p_event_id;
      INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, set_name, quantity, sort_order, per_head)
        VALUES (p_event_id, NULL, NULL, v_name, v_tables, v_sort, v_head)
        RETURNING id INTO v_id;
      SELECT COALESCE(max(c.sort_order), 0) + 10 INTO v_sort FROM public.catering_event_charges c WHERE c.event_id = p_event_id;
      INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, sort_order)
        VALUES (p_event_id, v_name, 'food', v_price, v_tables, v_price * v_tables, NULL, v_id, v_sort);
    ELSE
      -- An EXISTING set line of THIS booking. A single dish is not a set.
      v_id := (v_line->>'event_menu_id')::uuid;
      SELECT m.set_name INTO v_name
        FROM public.catering_event_menus m
       WHERE m.id = v_id AND m.event_id = p_event_id AND m.menu_id IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ไม่พบรายการชุดเมนูของงานนี้';
      END IF;
      -- THE CONFLICT TOKEN: the row ids and the price the screen opened with.
      IF jsonb_typeof(v_line->'known_item_ids') = 'array' THEN
        SELECT COALESCE(array_agg(i.id::text ORDER BY i.id::text), ARRAY[]::text[]) INTO v_live
          FROM public.catering_event_menu_items i WHERE i.event_menu_id = v_id;
        SELECT COALESCE(array_agg(k.x ORDER BY k.x), ARRAY[]::text[]) INTO v_known
          FROM jsonb_array_elements_text(v_line->'known_item_ids') AS k(x);
        IF v_live <> v_known THEN
          RAISE EXCEPTION 'รายการอาหารของชุดนี้ถูกแก้ไขจากที่อื่นหลังจากเปิดหน้านี้ — กดยกเลิกเพื่อโหลดข้อมูลล่าสุด แล้วทำใหม่';
        END IF;
      END IF;
      IF (v_line->>'known_price') IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.catering_event_charges c
                      WHERE c.event_menu_id = v_id AND c.event_id = p_event_id
                        AND c.unit_price <> (v_line->>'known_price')::numeric) THEN
        RAISE EXCEPTION 'ราคาของชุดนี้ถูกแก้ไขจากที่อื่นหลังจากเปิดหน้านี้ — กดยกเลิกเพื่อโหลดข้อมูลล่าสุด แล้วทำใหม่';
      END IF;
      IF v_name IS NULL THEN
        UPDATE public.catering_event_menus m
           SET set_name = COALESCE((SELECT s.name FROM public.catering_set_menus s WHERE s.id = m.set_menu_id), 'ชุดเมนู')
         WHERE m.id = v_id;
      END IF;
      UPDATE public.catering_event_charges c
         SET unit_price = v_price, amount = v_price * c.quantity
       WHERE c.event_menu_id = v_id AND c.event_id = p_event_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 0 THEN
        SELECT COALESCE(max(c.sort_order), 0) + 10 INTO v_sort FROM public.catering_event_charges c WHERE c.event_id = p_event_id;
        INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, sort_order)
          SELECT p_event_id, COALESCE(m.set_name, s.name, 'ชุดเมนู'), 'food', v_price, m.quantity, v_price * m.quantity, NULL, v_id, v_sort
            FROM public.catering_event_menus m
            LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
           WHERE m.id = v_id;
      END IF;
      DELETE FROM public.catering_event_menu_items i WHERE i.event_menu_id = v_id;
    END IF;

    -- The courses, whole, in the order sent. Each is a menu dish OR a typed
    -- name; only a typed name may carry a link. Provenance is copied as given.
    v_sort := 0;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_line->'items') LOOP
      v_sort := v_sort + 10;
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (items)';
      END IF;
      v_menu := (v_item->>'menu_id')::uuid;
      v_dish := nullif(btrim(v_item->>'dish_name'), '');
      v_link := (v_item->>'linked_menu_id')::uuid;
      v_qty  := (v_item->>'quantity')::numeric;
      IF (v_menu IS NULL) = (v_dish IS NULL) THEN
        RAISE EXCEPTION 'รายการอาหารหนึ่งรายการต้องเป็นอย่างใดอย่างหนึ่ง: เมนูในระบบ หรือชื่อเมนูที่พิมพ์เอง';
      END IF;
      IF v_link IS NOT NULL AND v_dish IS NULL THEN
        RAISE EXCEPTION 'ผูกกับเมนูในระบบได้เฉพาะเมนูที่พิมพ์เอง';
      END IF;
      IF v_dish IS NOT NULL AND NOT public.catering_dish_name_ok(v_dish) THEN
        RAISE EXCEPTION 'ชื่อเมนูที่พิมพ์เองต้องมี 1–120 ตัวอักษร และไม่มีอักขระที่พิมพ์ไม่ออก';
      END IF;
      IF v_qty IS NULL THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (menu_id, quantity)';
      END IF;
      IF v_menu IS NOT NULL AND EXISTS (SELECT 1 FROM public.catering_event_menu_items i WHERE i.event_menu_id = v_id AND i.menu_id = v_menu) THEN
        RAISE EXCEPTION 'เมนูเดียวกันอยู่ในชุดเดียวกันสองครั้ง';
      END IF;
      IF v_dish IS NOT NULL AND EXISTS (SELECT 1 FROM public.catering_event_menu_items i WHERE i.event_menu_id = v_id AND lower(i.dish_name) = lower(v_dish)) THEN
        RAISE EXCEPTION 'เมนู "%" อยู่ในชุดเดียวกันสองครั้ง', v_dish;
      END IF;
      INSERT INTO public.catering_event_menu_items
        (event_id, event_menu_id, menu_id, dish_name, linked_menu_id, quantity, section, sort_order, note, source_set_menu_id, source_event_menu_id)
      VALUES
        (p_event_id, v_id, v_menu, v_dish, v_link, v_qty, COALESCE(v_item->>'section', 'dish'), v_sort,
         nullif(btrim(v_item->>'note'), ''),
         (v_item->>'source_set_menu_id')::uuid, (v_item->>'source_event_menu_id')::uuid);
    END LOOP;

    v_out := v_out || jsonb_build_object('key', v_line->>'key', 'event_menu_id', v_id);
  END LOOP;

  RETURN v_out;
END
$fn$;

COMMENT ON FUNCTION public.catering_save_event_menus(uuid, jsonb) IS
  'ONE save of a booking''s own menu: every changed set line whole — its courses (each a menu dish OR a typed '
  'name, a typed name optionally linked to a real menu for its cost), THE price on the linked charge, and for a '
  'new custom set the line (per table or per head) and its food charge. Owner and admin only; refuses a locked '
  'booking, a line of another booking, a single dish, a nameless new set, a negative price, a course that is '
  'both or neither, a link on a menu dish, and the same dish twice. SECURITY INVOKER. 2026-09-19, typed dishes '
  'and per head 2026-09-25.';

-- A. A DRAFT'S SAVE, REPLACED: as catering_event_sheet_and_set_drafts_migration.sql
-- wrote it, with a course that is a menu dish OR a typed name (and its link).
CREATE OR REPLACE FUNCTION public.catering_save_set_draft(p_id uuid, p_seen timestamptz, p_name text, p_price numeric, p_items jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_role     text := public.current_role();
  v_is_draft boolean;
  v_version  timestamptz;
  v_item     jsonb;
  v_qty      numeric;
  v_dish     text;
  v_i        integer := 0;
  c_uuid     constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่แก้ชุดทดลองได้';
  END IF;
  SELECT s.is_draft, s.updated_at INTO v_is_draft, v_version
    FROM public.catering_set_menus s WHERE s.id = p_id FOR UPDATE;
  IF NOT FOUND OR NOT v_is_draft THEN
    RAISE EXCEPTION 'ไม่พบชุดเมนูฉบับร่างนี้ — อาจถูกทำเป็นชุดจริงหรือลบไปแล้ว';
  END IF;
  IF p_seen IS NULL OR v_version IS DISTINCT FROM p_seen THEN
    RAISE EXCEPTION 'ชุดทดลองนี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง' USING HINT = 'conflict';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'ใส่ชื่อชุดเมนู (ไม่เกิน 200 ตัวอักษร)';
  END IF;
  IF p_price IS NULL OR p_price < 0 OR p_price > 10000000 OR p_price <> round(p_price, 2) THEN
    RAISE EXCEPTION 'ราคาต่อโต๊ะไม่ถูกต้อง';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'รายการอาหารไม่ถูกต้อง';
  END IF;

  UPDATE public.catering_set_menus s SET name = btrim(p_name), price_per_set = p_price
   WHERE s.id = p_id
  RETURNING s.updated_at INTO v_version;
  DELETE FROM public.catering_set_menu_items i WHERE i.set_menu_id = p_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_i := v_i + 1;
    -- A menu dish (a menu_id, nothing else) OR a typed name (a dish_name,
    -- optionally a linked_menu_id); a section, a quantity, a short note.
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR NOT (
            (jsonb_typeof(v_item->'menu_id') = 'string' AND (v_item->>'menu_id') ~ c_uuid
              AND COALESCE(jsonb_typeof(v_item->'dish_name'), 'null') = 'null'
              AND COALESCE(jsonb_typeof(v_item->'linked_menu_id'), 'null') = 'null')
         OR (COALESCE(jsonb_typeof(v_item->'menu_id'), 'null') = 'null'
              AND jsonb_typeof(v_item->'dish_name') = 'string'
              AND public.catering_dish_name_ok(btrim(v_item->>'dish_name'))
              AND (COALESCE(jsonb_typeof(v_item->'linked_menu_id'), 'null') = 'null'
                   OR (jsonb_typeof(v_item->'linked_menu_id') = 'string' AND (v_item->>'linked_menu_id') ~ c_uuid))))
       OR jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number'
       OR NOT ((v_item->>'section') = ANY (ARRAY['dish', 'dessert', 'drink', 'free']))
       OR COALESCE(jsonb_typeof(v_item->'note'), 'null') NOT IN ('null', 'string')
       OR char_length(COALESCE(v_item->>'note', '')) > 300 THEN
      RAISE EXCEPTION 'รายการอาหารที่ % ไม่ถูกต้อง', v_i;
    END IF;
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty <= 0 OR v_qty > 100000 OR v_qty <> round(v_qty, 3) THEN
      RAISE EXCEPTION 'รายการอาหารที่ %: จำนวนต่อชุดต้องมากกว่า 0 ไม่เกิน 100,000 และมีทศนิยมไม่เกิน 3 ตำแหน่ง', v_i;
    END IF;
    v_dish := nullif(btrim(v_item->>'dish_name'), '');
    IF v_dish IS NOT NULL AND EXISTS (SELECT 1 FROM public.catering_set_menu_items i
                                       WHERE i.set_menu_id = p_id AND lower(i.dish_name) = lower(v_dish)) THEN
      RAISE EXCEPTION 'รายการอาหารที่ %: เมนู "%" อยู่ในชุดนี้แล้ว', v_i, v_dish;
    END IF;
    INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, dish_name, linked_menu_id, quantity, section, note, sort_order)
    VALUES (p_id, (v_item->>'menu_id')::uuid, v_dish, (v_item->>'linked_menu_id')::uuid, v_qty, v_item->>'section',
            nullif(btrim(v_item->>'note'), ''), v_i * 10);
  END LOOP;
  RETURN v_version;
END
$fn$;

-- A. THE ONE WAY SALES WRITES A BOOKING'S MENU (Nik, 2026-09-25, Q1): the
-- TYPED dishes of one set line — add, edit, remove — and nothing else. The
-- line's menu dishes are never touched; a typed dish's link (owner and
-- admin's) is kept as it is and can be neither set nor cleared from here.
-- Refused on a cancelled booking and on a cost-locked one, for everyone.
-- The booking is locked first, so a lock or a cancellation cannot land
-- between the checks and the writes. A line never copied is copied first,
-- so the shared set's dishes stay with it. SECURITY DEFINER: sales has no
-- write policy on the table; the checks below stand in for one.
CREATE OR REPLACE FUNCTION public.catering_save_typed_dishes(p_event_menu_id uuid, p_known_item_ids jsonb, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_role    text := public.current_role();
  v_event   uuid;
  v_set     uuid;
  v_setname text;
  v_dishln  uuid;
  v_status  text;
  v_locked  timestamptz;
  v_live    text[];
  v_known   text[];
  v_item    jsonb;
  v_id      uuid;
  v_name    text;
  v_qty     numeric;
  v_keep    uuid[] := ARRAY[]::uuid[];
  v_ids     uuid[] := ARRAY[]::uuid[];
  v_old     record;
  v_link    uuid;
  v_osort   integer;
  v_knames  text[] := ARRAY[]::text[];
  v_klinks  uuid[] := ARRAY[]::uuid[];
  v_ksorts  integer[] := ARRAY[]::integer[];
  v_names   text[] := ARRAY[]::text[];
  v_sort    integer;
  v_i       integer := 0;
  c_uuid    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'sales') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้รายการอาหารของงาน';
  END IF;
  SELECT m.event_id, m.set_menu_id, m.set_name, m.menu_id INTO v_event, v_set, v_setname, v_dishln
    FROM public.catering_event_menus m WHERE m.id = p_event_menu_id;
  IF v_event IS NULL THEN
    RAISE EXCEPTION 'ไม่พบรายการชุดเมนูของงาน';
  END IF;
  IF v_dishln IS NOT NULL THEN
    RAISE EXCEPTION 'รายการนี้เป็นอาหารจานเดียว ไม่ใช่ชุดเมนู';
  END IF;
  SELECT e.status, e.cost_locked_at INTO v_status, v_locked
    FROM public.catering_events e WHERE e.id = v_event FOR UPDATE;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'งานนี้ถูกยกเลิกแล้ว แก้รายการอาหารไม่ได้';
  END IF;
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'ต้นทุนของงานนี้ถูกล็อกแล้ว รายการอาหารถูกตรึงไว้';
  END IF;

  -- THE CONFLICT TOKEN: every row of the line as the screen opened it.
  IF jsonb_typeof(p_known_item_ids) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง';
  END IF;
  SELECT COALESCE(array_agg(i.id::text ORDER BY i.id::text), ARRAY[]::text[]) INTO v_live
    FROM public.catering_event_menu_items i WHERE i.event_menu_id = p_event_menu_id;
  SELECT COALESCE(array_agg(k.x ORDER BY k.x), ARRAY[]::text[]) INTO v_known
    FROM jsonb_array_elements_text(p_known_item_ids) AS k(x);
  IF v_live <> v_known THEN
    RAISE EXCEPTION 'รายการอาหารของชุดนี้ถูกแก้ไขจากที่อื่นหลังจากเปิดหน้านี้ — กดยกเลิกเพื่อโหลดข้อมูลล่าสุด แล้วทำใหม่' USING HINT = 'conflict';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) > 60 THEN
    RAISE EXCEPTION 'รายการอาหารไม่ถูกต้อง';
  END IF;

  -- Every item checked before anything is written.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_item) AS k(x)
                   WHERE k.x NOT IN ('id', 'dish_name', 'section', 'quantity', 'note')) THEN
      RAISE EXCEPTION 'รายการที่ %: แก้ได้เฉพาะเมนูที่พิมพ์เอง (ชื่อ หมวด จำนวน หมายเหตุ)', v_i;
    END IF;
    IF jsonb_typeof(v_item->'dish_name') IS DISTINCT FROM 'string'
       OR NOT public.catering_dish_name_ok(btrim(v_item->>'dish_name')) THEN
      RAISE EXCEPTION 'รายการที่ %: ชื่อเมนูต้องมี 1–120 ตัวอักษร และไม่มีอักขระที่พิมพ์ไม่ออก', v_i;
    END IF;
    IF NOT ((v_item->>'section') = ANY (ARRAY['dish', 'dessert', 'drink', 'free'])) THEN
      RAISE EXCEPTION 'รายการที่ %: หมวดไม่ถูกต้อง', v_i;
    END IF;
    IF jsonb_typeof(v_item->'quantity') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'รายการที่ %: จำนวนไม่ถูกต้อง', v_i;
    END IF;
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty <= 0 OR v_qty > 100000 OR v_qty <> round(v_qty, 3) THEN
      RAISE EXCEPTION 'รายการที่ %: จำนวนต้องมากกว่า 0 ไม่เกิน 100,000 และมีทศนิยมไม่เกิน 3 ตำแหน่ง', v_i;
    END IF;
    IF COALESCE(jsonb_typeof(v_item->'note'), 'null') NOT IN ('null', 'string') OR char_length(COALESCE(v_item->>'note', '')) > 300 THEN
      RAISE EXCEPTION 'รายการที่ %: หมายเหตุไม่ถูกต้อง', v_i;
    END IF;
    v_name := lower(btrim(v_item->>'dish_name'));
    IF v_name = ANY (v_names) THEN
      RAISE EXCEPTION 'เมนู "%" อยู่ในชุดเดียวกันสองครั้ง', btrim(v_item->>'dish_name');
    END IF;
    v_names := v_names || v_name;
    IF COALESCE(jsonb_typeof(v_item->'id'), 'null') <> 'null' THEN
      IF jsonb_typeof(v_item->'id') <> 'string' OR NOT ((v_item->>'id') ~ c_uuid) THEN
        RAISE EXCEPTION 'รายการที่ %: รูปแบบข้อมูลไม่ถูกต้อง', v_i;
      END IF;
      v_id := (v_item->>'id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.catering_event_menu_items i
                      WHERE i.id = v_id AND i.event_menu_id = p_event_menu_id AND i.dish_name IS NOT NULL) THEN
        RAISE EXCEPTION 'รายการที่ %: ไม่ใช่เมนูที่พิมพ์เองของชุดนี้', v_i;
      END IF;
      IF v_id = ANY (v_keep) THEN
        RAISE EXCEPTION 'รายการที่ %: รูปแบบข้อมูลไม่ถูกต้อง', v_i;
      END IF;
      v_keep := v_keep || v_id;
    END IF;
  END LOOP;

  -- A line never copied gets its copy now, before any row of its own exists.
  IF v_set IS NOT NULL AND v_setname IS NULL AND cardinality(v_live) = 0 THEN
    PERFORM public.catering_copy_set_menu(p_event_menu_id);
  END IF;

  -- Which row each item is. An item with an id is that row; an item without
  -- one that has the name of a typed row nobody claimed by id IS that row
  -- (the shared set's typed dishes, just copied, keep their link); any other
  -- is new.
  v_i := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_i := v_i + 1;
    v_id := NULL;
    IF COALESCE(jsonb_typeof(v_item->'id'), 'null') <> 'null' THEN
      v_id := (v_item->>'id')::uuid;
    ELSE
      SELECT i.id INTO v_id FROM public.catering_event_menu_items i
       WHERE i.event_menu_id = p_event_menu_id AND i.dish_name IS NOT NULL
         AND lower(i.dish_name) = lower(btrim(v_item->>'dish_name')) AND NOT (i.id = ANY (v_keep));
      IF v_id IS NOT NULL THEN
        v_keep := v_keep || v_id;
      END IF;
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;

  -- THE TYPED ROWS ARE WRITTEN AFRESH, as the owner's save writes a line:
  -- every save gives them new ids, so any screen opened before it — sales or
  -- owner — is refused by the id token instead of silently undoing it
  -- (review, 2026-09-25). A kept row keeps its place and, while its name is
  -- unchanged, its link: a renamed dish is another dish, and its link (owner
  -- and admin's) goes, so the cost page flags it until they link it again.
  -- Menu rows are never touched.
  SELECT COALESCE(max(i.sort_order), 0) INTO v_sort FROM public.catering_event_menu_items i WHERE i.event_menu_id = p_event_menu_id;
  v_i := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_i := v_i + 1;
    IF v_ids[v_i] IS NOT NULL THEN
      SELECT i.dish_name, i.linked_menu_id, i.sort_order INTO v_old
        FROM public.catering_event_menu_items i WHERE i.id = v_ids[v_i];
      v_knames[v_i] := v_old.dish_name;
      v_klinks[v_i] := v_old.linked_menu_id;
      v_ksorts[v_i] := v_old.sort_order;
    END IF;
  END LOOP;
  DELETE FROM public.catering_event_menu_items i
   WHERE i.event_menu_id = p_event_menu_id AND i.dish_name IS NOT NULL;
  v_i := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_i := v_i + 1;
    v_link := NULL;
    v_osort := NULL;
    IF v_ids[v_i] IS NOT NULL AND lower(v_knames[v_i]) = lower(btrim(v_item->>'dish_name')) THEN
      v_link := v_klinks[v_i];
    END IF;
    IF v_ids[v_i] IS NOT NULL THEN
      v_osort := v_ksorts[v_i];
    END IF;
    IF v_osort IS NULL THEN
      v_sort := v_sort + 10;
      v_osort := v_sort;
    END IF;
    INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, dish_name, linked_menu_id, quantity, section, sort_order, note)
    VALUES (v_event, p_event_menu_id, btrim(v_item->>'dish_name'), v_link, (v_item->>'quantity')::numeric, v_item->>'section',
            v_osort, nullif(btrim(v_item->>'note'), ''));
  END LOOP;
  -- From this save on the line is the booking's own list (the copy marker).
  UPDATE public.catering_event_menus m SET set_name = COALESCE(m.set_name,
           (SELECT s.name FROM public.catering_set_menus s WHERE s.id = m.set_menu_id), 'ชุดเมนู')
   WHERE m.id = p_event_menu_id AND m.set_name IS NULL;
  RETURN (SELECT count(*) FROM public.catering_event_menu_items i WHERE i.event_menu_id = p_event_menu_id AND i.dish_name IS NOT NULL);
END
$fn$;

COMMENT ON FUNCTION public.catering_save_typed_dishes(uuid, jsonb, jsonb) IS
  'The TYPED dishes of one set line of a booking, whole: add, edit (name, section, quantity, note), remove. Owner, '
  'admin and sales; never a menu dish, never a link (a typed dish''s link is kept as it is). Refuses a cancelled '
  'or cost-locked booking for everyone and a stale screen (HINT conflict). SECURITY DEFINER. 2026-09-25.';

-- A. A LINK NAMES A REAL MENU. Not a foreign key on purpose: a second
-- foreign key from these tables to menus would make every read that embeds
-- menus(name) from them ambiguous (PostgREST refuses it), and the code live
-- when this file runs reads exactly that. So this trigger checks it instead,
-- with the foreign-key error code. A menu deleted later leaves the link
-- pointing at nothing; its cost then reads as unknown, as any typed dish's.
CREATE OR REPLACE FUNCTION public.catering_dish_link_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.linked_menu_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.menus m WHERE m.id = NEW.linked_menu_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'foreign_key_violation', MESSAGE = 'ผูกกับเมนูที่ไม่มีในระบบไม่ได้';
  END IF;
  RETURN NEW;
END
$fn$;

-- A MENU DELETED CLEARS THE LINKS TO IT (review, 2026-09-25): a link left
-- pointing at nothing refused every later copy of its set (the check above
-- runs on insert), the cost lock's copy included. The typed name stays; its
-- cost reads as unknown again. SECURITY DEFINER: the links may sit on a
-- cost-locked booking, whose rows the lock policies keep from everyone.
CREATE OR REPLACE FUNCTION public.catering_dish_links_clear()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.catering_set_menu_items SET linked_menu_id = NULL WHERE linked_menu_id = OLD.id;
  UPDATE public.catering_event_menu_items SET linked_menu_id = NULL WHERE linked_menu_id = OLD.id;
  RETURN OLD;
END
$fn$;

DROP TRIGGER IF EXISTS trg_menus_clear_dish_links ON public.menus;
CREATE TRIGGER trg_menus_clear_dish_links AFTER DELETE ON public.menus
  FOR EACH ROW EXECUTE FUNCTION public.catering_dish_links_clear();

DROP TRIGGER IF EXISTS trg_catering_set_menu_items_link_check ON public.catering_set_menu_items;
CREATE TRIGGER trg_catering_set_menu_items_link_check BEFORE INSERT OR UPDATE OF linked_menu_id ON public.catering_set_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.catering_dish_link_check();
DROP TRIGGER IF EXISTS trg_catering_event_menu_items_link_check ON public.catering_event_menu_items;
CREATE TRIGGER trg_catering_event_menu_items_link_check BEFORE INSERT OR UPDATE OF linked_menu_id ON public.catering_event_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.catering_dish_link_check();

-- B. A LINE'S PRICE BASIS: taken from its set when the line is created, and
-- kept. A single dish is never per head; a custom set keeps what its save
-- chose. SECURITY DEFINER so the set's flag is read whoever inserts.
CREATE OR REPLACE FUNCTION public.catering_event_menus_per_head()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.menu_id IS NOT NULL THEN
      NEW.per_head := false;
    ELSIF NEW.set_menu_id IS NOT NULL THEN
      NEW.per_head := COALESCE((SELECT s.per_head FROM public.catering_set_menus s WHERE s.id = NEW.set_menu_id), false);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.per_head IS DISTINCT FROM OLD.per_head THEN
    RAISE EXCEPTION 'ราคาต่อท่านหรือต่อชุดของรายการกำหนดตอนเพิ่มรายการ เปลี่ยนภายหลังไม่ได้ — ลบรายการแล้วเพิ่มใหม่';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_catering_event_menus_per_head ON public.catering_event_menus;
CREATE TRIGGER trg_catering_event_menus_per_head BEFORE INSERT OR UPDATE OF per_head ON public.catering_event_menus
  FOR EACH ROW EXECUTE FUNCTION public.catering_event_menus_per_head();

-- C. แจ้งซ่อม. Five functions are the only writes. Each is SECURITY DEFINER,
-- takes the caller from auth.uid(), locks the report before reading its
-- status, and refuses with the Thai message the screen shows as it is.
-- A photo is the public URL of a file the app uploaded to sop-photos, on a
-- Supabase project host: maint-<digits>-<letters>.jpg before, maint-after-…
-- after (the upload rule's own names, permissions_batch_2026_09_17.sql). No
-- other site and no user info in the address (review, 2026-09-25).
CREATE OR REPLACE FUNCTION public.maint_create(p_category text, p_location text, p_description text, p_is_urgent boolean, p_photo_before text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text := public.current_role();
  v_cat  text := COALESCE(nullif(btrim(p_category), ''), 'อื่นๆ');
  v_loc  text := COALESCE(btrim(p_location), '');
  v_desc text := COALESCE(btrim(p_description), '');
  v_id   uuid;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อนแจ้งซ่อม';
  END IF;
  IF v_loc = '' AND v_desc = '' THEN
    RAISE EXCEPTION 'กรุณาระบุจุดที่เสียหาย หรือรายละเอียด อย่างน้อยหนึ่งอย่าง';
  END IF;
  IF char_length(v_cat) > 50 OR char_length(v_loc) > 300 OR char_length(v_desc) > 3000 THEN
    RAISE EXCEPTION 'ข้อความยาวเกินไป';
  END IF;
  IF p_photo_before IS NOT NULL
     AND p_photo_before !~ '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/sop-photos/maint-[0-9]+-[0-9a-z]*[.]jpg$' THEN
    RAISE EXCEPTION 'รูปไม่ถูกต้อง — ถ่ายหรือเลือกรูปใหม่';
  END IF;
  INSERT INTO public.maintenance_reports (reporter_id, reporter_name, category, location, description, is_urgent, photo_before, status)
  VALUES (v_uid, COALESCE((SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid), ''), v_cat, v_loc, v_desc,
          COALESCE(p_is_urgent, false), p_photo_before, 'new')
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.maint_edit(p_id uuid, p_category text, p_location text, p_description text, p_is_urgent boolean, p_photo_before text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text := public.current_role();
  v_rep    uuid;
  v_status text;
  v_photo  text;
  v_cat    text := COALESCE(nullif(btrim(p_category), ''), 'อื่นๆ');
  v_loc    text := COALESCE(btrim(p_location), '');
  v_desc   text := COALESCE(btrim(p_description), '');
BEGIN
  IF v_uid IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน';
  END IF;
  SELECT r.reporter_id, r.status, r.photo_before INTO v_rep, v_status, v_photo
    FROM public.maintenance_reports r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการ';
  END IF;
  IF v_rep IS DISTINCT FROM v_uid AND v_role NOT IN ('owner', 'admin', 'editor') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์แก้ไข';
  END IF;
  IF v_status <> 'new' THEN
    RAISE EXCEPTION 'แก้ไขได้เฉพาะรายการที่ยังไม่รับเรื่อง';
  END IF;
  IF v_loc = '' AND v_desc = '' THEN
    RAISE EXCEPTION 'กรุณาระบุจุดที่เสียหาย หรือรายละเอียด อย่างน้อยหนึ่งอย่าง';
  END IF;
  IF char_length(v_cat) > 50 OR char_length(v_loc) > 300 OR char_length(v_desc) > 3000 THEN
    RAISE EXCEPTION 'ข้อความยาวเกินไป';
  END IF;
  -- The photo already there may stay as it is; a new one must be the app's.
  IF p_photo_before IS NOT NULL AND p_photo_before IS DISTINCT FROM v_photo
     AND p_photo_before !~ '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/sop-photos/maint-[0-9]+-[0-9a-z]*[.]jpg$' THEN
    RAISE EXCEPTION 'รูปไม่ถูกต้อง — ถ่ายหรือเลือกรูปใหม่';
  END IF;
  UPDATE public.maintenance_reports r
     SET category = v_cat, location = v_loc, description = v_desc, is_urgent = COALESCE(p_is_urgent, false), photo_before = p_photo_before
   WHERE r.id = p_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.maint_take(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text := public.current_role();
  v_status text;
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'editor') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
  END IF;
  SELECT r.status INTO v_status FROM public.maintenance_reports r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการ';
  END IF;
  IF v_status <> 'new' THEN
    RAISE EXCEPTION 'รับเรื่องได้เฉพาะรายการที่เพิ่งแจ้ง';
  END IF;
  UPDATE public.maintenance_reports r
     SET status = 'in_progress', resolver_id = v_uid,
         resolver_name = COALESCE((SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid), '')
   WHERE r.id = p_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.maint_done(p_id uuid, p_note text, p_photo_after text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text := public.current_role();
  v_status text;
  v_note   text := nullif(btrim(p_note), '');
BEGIN
  IF v_uid IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'editor') THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์เปลี่ยนสถานะ';
  END IF;
  SELECT r.status INTO v_status FROM public.maintenance_reports r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการ';
  END IF;
  IF v_status NOT IN ('new', 'in_progress') THEN
    RAISE EXCEPTION 'รายการนี้ปิดไปแล้ว (ซ่อมเสร็จหรือยกเลิก)';
  END IF;
  IF char_length(COALESCE(v_note, '')) > 1000 THEN
    RAISE EXCEPTION 'หมายเหตุยาวเกินไป';
  END IF;
  IF p_photo_after IS NOT NULL
     AND p_photo_after !~ '^https://[a-z0-9]+[.]supabase[.]co/storage/v1/object/public/sop-photos/maint-after-[0-9]+-[0-9a-z]*[.]jpg$' THEN
    RAISE EXCEPTION 'รูปไม่ถูกต้อง — ถ่ายหรือเลือกรูปใหม่';
  END IF;
  UPDATE public.maintenance_reports r
     SET status = 'done', resolved_at = now(), resolver_id = v_uid,
         resolver_name = COALESCE((SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid), ''),
         photo_after = COALESCE(p_photo_after, r.photo_after), resolver_note = COALESCE(v_note, r.resolver_note)
   WHERE r.id = p_id;
END
$fn$;

-- CANCEL INSTEAD OF DELETE (Nik, 2026-09-25, Q7): the reporter while the
-- report is new; owner, admin and editor while it is new or in progress;
-- nobody once it is done. Who, when and the note are kept on the row.
CREATE OR REPLACE FUNCTION public.maint_cancel(p_id uuid, p_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text := public.current_role();
  v_rep    uuid;
  v_status text;
  v_note   text := nullif(btrim(p_note), '');
BEGIN
  IF v_uid IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน';
  END IF;
  SELECT r.reporter_id, r.status INTO v_rep, v_status FROM public.maintenance_reports r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบรายการ';
  END IF;
  IF v_status = 'done' THEN
    RAISE EXCEPTION 'รายการที่ซ่อมเสร็จแล้วยกเลิกไม่ได้';
  END IF;
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'รายการนี้ถูกยกเลิกไปแล้ว';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'editor') THEN
    IF v_rep IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'ยกเลิกได้เฉพาะคนที่แจ้ง หรือหัวหน้า';
    END IF;
    IF v_status <> 'new' THEN
      RAISE EXCEPTION 'รับเรื่องแล้ว — ยกเลิกได้เฉพาะหัวหน้า';
    END IF;
  END IF;
  IF char_length(COALESCE(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'หมายเหตุยาวเกินไป (ไม่เกิน 500 ตัวอักษร)';
  END IF;
  UPDATE public.maintenance_reports r
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_note = v_note,
         cancelled_by_name = COALESCE((SELECT p.full_name FROM public.profiles p WHERE p.id = v_uid), '')
   WHERE r.id = p_id;
END
$fn$;

COMMENT ON FUNCTION public.maint_cancel(uuid, text) IS
  'Cancel a แจ้งซ่อม instead of deleting it: the reporter while new; owner, admin, editor while new or in progress; '
  'nobody once done. Records cancelled_by, cancelled_by_name, cancelled_at, cancel_note. 2026-09-25.';

REVOKE EXECUTE ON FUNCTION public.catering_save_typed_dishes(uuid, jsonb, jsonb),
  public.maint_create(text, text, text, boolean, text), public.maint_edit(uuid, text, text, text, boolean, text),
  public.maint_take(uuid), public.maint_done(uuid, text, text), public.maint_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catering_save_typed_dishes(uuid, jsonb, jsonb),
  public.maint_create(text, text, text, boolean, text), public.maint_edit(uuid, text, text, text, boolean, text),
  public.maint_take(uuid), public.maint_done(uuid, text, text), public.maint_cancel(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.catering_event_menus_per_head(), public.catering_dish_link_check(), public.catering_dish_links_clear() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  PERFORM pg_temp.note('ok      functions: the set copy, the booking-menu save and the draft save replaced (typed dishes, links, per head); the typed-dish save for sales; the link check; the per-head trigger; the five แจ้งซ่อม functions');
END
$do$;

-- ── Step 3: who may write แจ้งซ่อม directly: nobody ────────────────────────
--
-- The five functions above are the only writes. The two write policies go;
-- the table privileges go with them, so no policy anyone adds later can open
-- a direct write by itself. maint_read (every signed-in account reads) stays.

DROP POLICY IF EXISTS maint_insert ON public.maintenance_reports;
DROP POLICY IF EXISTS maint_update ON public.maintenance_reports;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.maintenance_reports FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  PERFORM pg_temp.note('ok      แจ้งซ่อม: the direct write policies dropped (maint_insert; maint_update and its missing WITH CHECK) and INSERT, UPDATE, DELETE revoked; reading unchanged');
END
$do$;

-- ── Step 4: tests, as real accounts, every write rolled back ───────────────

DO $do$
DECLARE
  owner_  uuid := current_setting('m62.owner')::uuid;
  admin_  uuid := current_setting('m62.admin')::uuid;
  sales_  uuid := current_setting('m62.sales')::uuid;
  editor_ uuid := current_setting('m62.editor')::uuid;
  staff_  uuid := current_setting('m62.staff')::uuid;
  hr_     uuid := current_setting('m62.hr')::uuid;
  v_open   uuid;   -- an open booking
  v_locked uuid;   -- a cost-locked booking
  v_cancel uuid;   -- a cancelled booking
  v_dish   uuid;   -- a dish with a price
  v_dish2  uuid;   -- another, to link a typed dish to
  v_real   uuid;   -- a shared set: one menu dish and one typed dish
  v_head   uuid;   -- a shared set priced per head
  v_draft  uuid;   -- a draft set
  v_line   uuid;   -- the booking's line of v_real (copied)
  v_old    uuid;   -- a line of v_real never copied (a booking from before)
  v_lockln uuid;   -- a custom set line on the locked booking
  v_canln  uuid;   -- a custom set line on the cancelled booking
  v_dishln uuid;   -- a single-dish line
  v_hline  uuid;   -- the per-head line H1 makes
  v_menurow uuid;  -- the menu-dish row of v_line
  v_typed  uuid;   -- the typed row D1 adds
  v_rep1   uuid;   -- a report filed by staff
  v_rep2   uuid;   -- a report filed by sales
  v_known  jsonb;  -- a line's rows as a screen opened them
  v_stale  jsonb;  -- the same, from before sales edited
  v_menu3  uuid;   -- a menu made here, to delete
  v_draftv timestamptz;
  v_url    text := 'https://probe.supabase.co/storage/v1/object/public/sop-photos/maint-1700000000000-abcd.jpg';
  v_log    text;
BEGIN
  BEGIN
    -- ── Setup, as the file's own role; the block always rolls back ──
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note)
    VALUES (DATE '2099-03-01', 'in_house', 'air_shared', 'catering', 'confirmed', 'probe-m62') RETURNING id INTO v_open;
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note, cost_locked_at)
    VALUES (DATE '2099-03-02', 'in_house', 'air_shared', 'catering', 'confirmed', 'probe-m62', now()) RETURNING id INTO v_locked;
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note)
    VALUES (DATE '2099-03-03', 'in_house', 'air_shared', 'catering', 'cancelled', 'probe-m62') RETURNING id INTO v_cancel;
    SELECT id INTO v_dish  FROM public.menus WHERE selling_price > 0 ORDER BY id LIMIT 1;
    SELECT id INTO v_dish2 FROM public.menus WHERE selling_price > 0 AND id <> v_dish ORDER BY id LIMIT 1;
    INSERT INTO public.catering_set_menus (name, price_per_set) VALUES ('probe-m62-set', 1000) RETURNING id INTO v_real;
    INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, section) VALUES (v_real, v_dish, 1, 'dish');
    INSERT INTO public.catering_set_menu_items (set_menu_id, dish_name, quantity, section) VALUES (v_real, 'probe-typed', 1, 'dish');
    INSERT INTO public.catering_set_menus (name, price_per_set, per_head) VALUES ('probe-m62-buffet', 380, true) RETURNING id INTO v_head;
    INSERT INTO public.catering_set_menus (name, price_per_set, is_draft) VALUES ('probe-m62-draft', 1500, true) RETURNING id INTO v_draft;
    SELECT updated_at INTO v_draftv FROM public.catering_set_menus WHERE id = v_draft;
    INSERT INTO public.catering_event_menus (event_id, set_name, quantity) VALUES (v_locked, 'probe-locked', 1) RETURNING id INTO v_lockln;
    INSERT INTO public.catering_event_menus (event_id, set_name, quantity) VALUES (v_cancel, 'probe-cancelled', 1) RETURNING id INTO v_canln;
    INSERT INTO public.catering_event_menus (event_id, menu_id, quantity, per_head) VALUES (v_open, v_dish, 1, true) RETURNING id INTO v_dishln;
    PERFORM pg_temp.note('ok      test data made: three bookings (open, cost-locked, cancelled), a set with a menu dish and a typed dish, a per-head set, a draft, a line never copied, a single-dish line; all rolled back');

    -- ── T. The CHECKs on a dish row ──
    PERFORM pg_temp.t('T1 owner adds a typed dish to a shared set', owner_, 'owner',
      format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, dish_name, quantity) VALUES (%L, 'แกงเขียวหวานไก่', 1)$q$, v_real), ARRAY['rows=1']);
    PERFORM pg_temp.t('T2 owner adds a row that is both a menu dish and a typed name', owner_, 'owner',
      format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, dish_name, quantity) VALUES (%L, %L, 'x', 1)$q$, v_real, v_dish2), ARRAY['check-refused']);
    PERFORM pg_temp.t('T3 owner adds a row that is neither', owner_, 'owner',
      format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, quantity) VALUES (%L, 1)$q$, v_real), ARRAY['check-refused']);
    PERFORM pg_temp.t('T4 owner adds a typed name with a space around it', owner_, 'owner',
      format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, dish_name, quantity) VALUES (%L, ' ต้มยำ', 1)$q$, v_real), ARRAY['check-refused']);
    PERFORM pg_temp.t('T5 owner adds a typed name of 121 characters', owner_, 'owner',
      format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, dish_name, quantity) VALUES (%L, %L, 1)$q$, v_real, repeat('ก', 121)), ARRAY['check-refused']);
    PERFORM pg_temp.t('T6 owner adds a typed name the set already has, in other letters case', owner_, 'owner',
      format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, dish_name, quantity) VALUES (%L, 'PROBE-TYPED', 1)$q$, v_real), ARRAY['dup-refused']);
    PERFORM pg_temp.t('T7 owner links a MENU dish row to a menu', owner_, 'owner',
      format($q$UPDATE public.catering_set_menu_items SET linked_menu_id = %L WHERE set_menu_id = %L AND menu_id = %L$q$, v_dish2, v_real, v_dish), ARRAY['check-refused']);
    PERFORM pg_temp.t('T8 owner links the typed dish to a real menu (kept)', owner_, 'owner',
      format($q$UPDATE public.catering_set_menu_items SET linked_menu_id = %L WHERE set_menu_id = %L AND dish_name = 'probe-typed'$q$, v_dish2, v_real),
      ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('T11 owner links the typed dish to a menu that does not exist', owner_, 'owner',
      format($q$UPDATE public.catering_set_menu_items SET linked_menu_id = gen_random_uuid() WHERE set_menu_id = %L AND dish_name = 'probe-typed'$q$, v_real), ARRAY['fk-refused']);
    PERFORM pg_temp.t('T9 sales adds a typed dish to a shared set', sales_, 'sales',
      format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, dish_name, quantity) VALUES (%L, 'x', 1)$q$, v_real), ARRAY['denied']);
    PERFORM pg_temp.t('T10 sales writes a typed row into a booking''s menu directly', sales_, 'sales',
      format($q$INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, dish_name, quantity) VALUES (%L, %L, 'x', 1)$q$, v_open, v_old), ARRAY['denied']);

    -- ── A. The copy carries typed dishes and their links ──
    PERFORM pg_temp.t('A1 owner puts the set on a booking through the price box: its typed dish and link copied (kept)', owner_, 'owner',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, '[]'::jsonb, false)$q$, v_open,
        jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_real, 'quantity', 2))::text),
      ARRAY['rows=1'], NULL, true);
    SELECT id INTO v_line FROM public.catering_event_menus WHERE event_id = v_open AND set_menu_id = v_real;
    -- A line of the same set never copied, as a booking from before the copy has.
    INSERT INTO public.catering_event_menus (event_id, set_menu_id, quantity) VALUES (v_open, v_real, 1) RETURNING id INTO v_old;
    SELECT id INTO v_menurow FROM public.catering_event_menu_items WHERE event_menu_id = v_line AND menu_id = v_dish;
    IF v_line IS NULL OR v_menurow IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.catering_event_menu_items
                       WHERE event_menu_id = v_line AND dish_name = 'probe-typed' AND menu_id IS NULL AND linked_menu_id = v_dish2) THEN
      RAISE EXCEPTION 'FAIL    A1 the set reached the booking without its typed dish and link. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      A1 read back: the menu dish, the typed dish and its link are the booking''s own copy');
    PERFORM pg_temp.t('T12 owner adds a booking dish row that is both a menu dish and a typed name', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id, dish_name, quantity) VALUES (%L, %L, %L, 'x', 1)$q$, v_open, v_line, v_dish2), ARRAY['check-refused']);
    PERFORM pg_temp.t('T13 owner adds a typed name the booking line already has, in other letters case', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, dish_name, quantity) VALUES (%L, %L, 'PROBE-TYPED', 1)$q$, v_open, v_line), ARRAY['dup-refused']);
    PERFORM pg_temp.t('T14 owner adds a booking typed dish linked to a menu that does not exist', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, dish_name, linked_menu_id, quantity) VALUES (%L, %L, 'x', gen_random_uuid(), 1)$q$, v_open, v_line), ARRAY['fk-refused']);
    PERFORM pg_temp.t('T4b owner adds a typed name ending in a no-break space', owner_, 'owner',
      format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, dish_name, quantity) VALUES (%L, 'ต้มยำ' || chr(160), 1)$q$, v_real), ARRAY['check-refused']);

    -- ── D. Sales: typed dishes, and nothing else ──
    SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_known FROM public.catering_event_menu_items WHERE event_menu_id = v_line;
    PERFORM pg_temp.t('D1 sales adds a typed dish to the booking''s set, keeping the copied one (kept)', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, %L::jsonb)$q$, v_line, v_known::text,
        jsonb_build_array(
          jsonb_build_object('id', (SELECT id FROM public.catering_event_menu_items WHERE event_menu_id = v_line AND dish_name = 'probe-typed'),
                             'dish_name', 'probe-typed', 'section', 'dish', 'quantity', 1, 'note', NULL),
          jsonb_build_object('dish_name', 'ห่อหมกปลา', 'section', 'dish', 'quantity', 2, 'note', 'ถ้วยเล็ก'))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 WHERE (SELECT count(*) FROM public.catering_event_menu_items WHERE event_menu_id = %L) = 3
                           AND EXISTS (SELECT 1 FROM public.catering_event_menu_items WHERE id = %L AND menu_id IS NOT NULL)$q$, v_line, v_menurow),
      true);
    SELECT id INTO v_typed FROM public.catering_event_menu_items WHERE event_menu_id = v_line AND dish_name = 'ห่อหมกปลา';
    SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_known FROM public.catering_event_menu_items WHERE event_menu_id = v_line;
    v_stale := v_known;
    PERFORM pg_temp.t('D2 sales moves the typed dish owner linked to desserts, 1.5 a table: the link stays (kept)', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, %L::jsonb)$q$, v_line, v_known::text,
        jsonb_build_array(
          jsonb_build_object('id', (SELECT id FROM public.catering_event_menu_items WHERE event_menu_id = v_line AND dish_name = 'probe-typed'),
                             'dish_name', 'probe-typed', 'section', 'dessert', 'quantity', 1.5, 'note', NULL),
          jsonb_build_object('id', v_typed, 'dish_name', 'ห่อหมกปลา', 'section', 'dish', 'quantity', 2, 'note', 'ถ้วยเล็ก'))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_menu_items WHERE event_menu_id = %L AND dish_name = 'probe-typed' AND section = 'dessert' AND quantity = 1.5 AND linked_menu_id = %L$q$, v_line, v_dish2),
      true);
    PERFORM pg_temp.t('D2b owner saves from the screen opened before sales edited: refused, not silently undone', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$, v_open,
        jsonb_build_array(jsonb_build_object('event_menu_id', v_line, 'price_per_table', 1000, 'known_item_ids', v_stale, 'known_price', NULL,
          'items', jsonb_build_array(jsonb_build_object('menu_id', v_dish, 'quantity', 1, 'section', 'dish'))))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D2b', 'ถูกแก้ไขจากที่อื่น');
    SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_known FROM public.catering_event_menu_items WHERE event_menu_id = v_line;
    PERFORM pg_temp.t('D2c sales renames the linked typed dish: a new name is another dish, the link goes', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, %L::jsonb)$q$, v_line, v_known::text,
        jsonb_build_array(
          jsonb_build_object('id', (SELECT id FROM public.catering_event_menu_items WHERE event_menu_id = v_line AND dish_name = 'probe-typed'),
                             'dish_name', 'probe-typed-2', 'section', 'dessert', 'quantity', 1.5, 'note', NULL))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_menu_items WHERE event_menu_id = %L AND dish_name = 'probe-typed-2' AND linked_menu_id IS NULL$q$, v_line));
    PERFORM pg_temp.t('D2d sales saves a name with a no-break space in it', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, %L::jsonb)$q$, v_line, v_known::text,
        jsonb_build_array(jsonb_build_object('dish_name', 'กุ้งเผา' || chr(160), 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D2d', 'อักขระที่พิมพ์ไม่ออก');
    SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_known FROM public.catering_event_menu_items WHERE event_menu_id = v_line;
    PERFORM pg_temp.t('D3 sales sends a menu dish', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, %L::jsonb)$q$, v_line, v_known::text,
        jsonb_build_array(jsonb_build_object('menu_id', v_dish2, 'dish_name', 'x', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D3', 'แก้ได้เฉพาะเมนูที่พิมพ์เอง');
    PERFORM pg_temp.t('D4 sales sends a link to a real menu', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, %L::jsonb)$q$, v_line, v_known::text,
        jsonb_build_array(jsonb_build_object('dish_name', 'x', 'linked_menu_id', v_dish2, 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D4', 'แก้ได้เฉพาะเมนูที่พิมพ์เอง');
    PERFORM pg_temp.t('D5 sales sends the id of the set''s MENU dish as a typed dish', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, %L::jsonb)$q$, v_line, v_known::text,
        jsonb_build_array(jsonb_build_object('id', v_menurow, 'dish_name', 'x', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D5', 'ไม่ใช่เมนูที่พิมพ์เองของชุดนี้');
    PERFORM pg_temp.t('D6 sales saves from a stale screen', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, '[]'::jsonb, %L::jsonb)$q$, v_line,
        jsonb_build_array(jsonb_build_object('dish_name', 'x', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D6', 'ถูกแก้ไขจากที่อื่น');
    PERFORM pg_temp.t('D7 sales adds a typed dish on the cost-locked booking', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, '[]'::jsonb, %L::jsonb)$q$, v_lockln,
        jsonb_build_array(jsonb_build_object('dish_name', 'x', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D7', 'ถูกล็อกแล้ว');
    PERFORM pg_temp.t('D8 owner adds a typed dish on the cost-locked booking (locked for everyone)', owner_, 'owner',
      format($q$SELECT public.catering_save_typed_dishes(%L, '[]'::jsonb, %L::jsonb)$q$, v_lockln,
        jsonb_build_array(jsonb_build_object('dish_name', 'x', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D8', 'ถูกล็อกแล้ว');
    PERFORM pg_temp.t('D9 sales adds a typed dish on the cancelled booking', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, '[]'::jsonb, %L::jsonb)$q$, v_canln,
        jsonb_build_array(jsonb_build_object('dish_name', 'x', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D9', 'ถูกยกเลิกแล้ว');
    PERFORM pg_temp.t('D10 sales sends one typed name twice', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, %L::jsonb)$q$, v_line, v_known::text,
        jsonb_build_array(jsonb_build_object('dish_name', 'ต้มข่า', 'section', 'dish', 'quantity', 1),
                          jsonb_build_object('dish_name', ' ต้มข่า ', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D10', 'สองครั้ง');
    PERFORM pg_temp.t('D11 sales adds a typed dish to a line never copied: the set is copied first, then the dish', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, '[]'::jsonb, %L::jsonb)$q$, v_old,
        jsonb_build_array(jsonb_build_object('dish_name', 'probe-typed', 'section', 'dish', 'quantity', 1),
                          jsonb_build_object('dish_name', 'ต้มข่า', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 WHERE (SELECT count(*) FROM public.catering_event_menu_items WHERE event_menu_id = %L) = 3
                           AND EXISTS (SELECT 1 FROM public.catering_event_menu_items WHERE event_menu_id = %L AND menu_id = %L)
                           AND EXISTS (SELECT 1 FROM public.catering_event_menu_items WHERE event_menu_id = %L AND dish_name = 'probe-typed' AND linked_menu_id = %L)$q$,
        v_old, v_old, v_dish, v_old, v_dish2));
    PERFORM pg_temp.t('D12 sales removes every typed dish: the menu dish stays', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, '[]'::jsonb)$q$, v_line, v_known::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 WHERE (SELECT count(*) FROM public.catering_event_menu_items WHERE event_menu_id = %L) = 1
                           AND EXISTS (SELECT 1 FROM public.catering_event_menu_items WHERE id = %L)$q$, v_line, v_menurow));
    PERFORM pg_temp.t('D13 sales adds a typed dish to a single-dish line', sales_, 'sales',
      format($q$SELECT public.catering_save_typed_dishes(%L, '[]'::jsonb, %L::jsonb)$q$, v_dishln,
        jsonb_build_array(jsonb_build_object('dish_name', 'x', 'section', 'dish', 'quantity', 1))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D13', 'อาหารจานเดียว');
    PERFORM pg_temp.t('D14 editor adds a typed dish', editor_, 'editor',
      format($q$SELECT public.catering_save_typed_dishes(%L, %L::jsonb, '[]'::jsonb)$q$, v_line, v_known::text), ARRAY['refused']);
    PERFORM pg_temp.said('D14', 'ไม่มีสิทธิ์');
    PERFORM pg_temp.t('D15 an anonymous visitor calls the typed-dish save', NULL, 'anon',
      format($q$SELECT public.catering_save_typed_dishes(%L, '[]'::jsonb, '[]'::jsonb)$q$, v_line), ARRAY['no-execute']);
    PERFORM pg_temp.t('D16 sales saves the booking menu the owner''s way', sales_, 'sales',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$, v_open,
        jsonb_build_array(jsonb_build_object('event_menu_id', v_line, 'price_per_table', 0, 'known_item_ids', v_known, 'known_price', NULL, 'items', '[]'::jsonb))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('D16', 'เฉพาะเจ้าของร้านและผู้จัดการ');
    PERFORM pg_temp.t('D17 sales updates the menu dish row directly', sales_, 'sales',
      format($q$UPDATE public.catering_event_menu_items SET quantity = 9 WHERE id = %L$q$, v_menurow), ARRAY['rows=0', 'denied']);

    -- ── O. Owner and admin: the booking menu save with typed dishes and links ──
    PERFORM pg_temp.t('O1 owner saves the set with a typed dish linked to a real menu', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$, v_open,
        jsonb_build_array(jsonb_build_object('event_menu_id', v_line, 'price_per_table', 1000, 'known_item_ids', v_known, 'known_price', NULL,
          'items', jsonb_build_array(jsonb_build_object('menu_id', v_dish, 'quantity', 1, 'section', 'dish'),
                                     jsonb_build_object('dish_name', 'ปลาทอด', 'linked_menu_id', v_dish2, 'quantity', 2, 'section', 'dish'))))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_menu_items WHERE event_menu_id = %L AND dish_name = 'ปลาทอด' AND menu_id IS NULL AND linked_menu_id = %L$q$, v_line, v_dish2));
    PERFORM pg_temp.t('O2 owner saves a course that is both a menu dish and a typed name', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$, v_open,
        jsonb_build_array(jsonb_build_object('event_menu_id', v_line, 'price_per_table', 1000, 'known_item_ids', v_known, 'known_price', NULL,
          'items', jsonb_build_array(jsonb_build_object('menu_id', v_dish, 'dish_name', 'x', 'quantity', 1, 'section', 'dish'))))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('O2', 'อย่างใดอย่างหนึ่ง');
    PERFORM pg_temp.t('O3 owner saves a link on a menu dish', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$, v_open,
        jsonb_build_array(jsonb_build_object('event_menu_id', v_line, 'price_per_table', 1000, 'known_item_ids', v_known, 'known_price', NULL,
          'items', jsonb_build_array(jsonb_build_object('menu_id', v_dish, 'linked_menu_id', v_dish2, 'quantity', 1, 'section', 'dish'))))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('O3', 'เฉพาะเมนูที่พิมพ์เอง');
    PERFORM pg_temp.t('O4 admin makes a per-head custom set: 380 a guest for 30 guests', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$, v_open,
        jsonb_build_array(jsonb_build_object('key', 'k1', 'event_menu_id', NULL, 'set_name', 'probe-buffet-own', 'tables', 30, 'per_head', true,
          'price_per_table', 380, 'known_item_ids', '[]'::jsonb, 'known_price', NULL,
          'items', jsonb_build_array(jsonb_build_object('dish_name', 'ข้าวผัด', 'quantity', 1, 'section', 'dish'))))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_menus m JOIN public.catering_event_charges c ON c.event_menu_id = m.id
                 WHERE m.event_id = %L AND m.set_name = 'probe-buffet-own' AND m.per_head AND m.quantity = 30
                   AND c.unit_price = 380 AND c.quantity = 30 AND c.amount = 11400$q$, v_open));

    -- ── G. A draft may hold typed dishes ──
    PERFORM pg_temp.t('G1 admin saves a draft with a menu dish and a typed dish', admin_, 'admin',
      format($q$SELECT public.catering_save_set_draft(%L, %L::timestamptz, 'probe-m62-draft', 1500, %L::jsonb)$q$, v_draft, v_draftv,
        jsonb_build_array(jsonb_build_object('menu_id', v_dish, 'quantity', 1, 'section', 'dish', 'note', NULL),
                          jsonb_build_object('dish_name', 'น้ำพริกลงเรือ', 'linked_menu_id', NULL, 'quantity', 1, 'section', 'dish', 'note', NULL))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_set_menu_items WHERE set_menu_id = %L AND dish_name = 'น้ำพริกลงเรือ' AND menu_id IS NULL$q$, v_draft));
    PERFORM pg_temp.t('G2 admin saves a draft course that is both', admin_, 'admin',
      format($q$SELECT public.catering_save_set_draft(%L, %L::timestamptz, 'probe-m62-draft', 1500, %L::jsonb)$q$, v_draft, v_draftv,
        jsonb_build_array(jsonb_build_object('menu_id', v_dish, 'dish_name', 'x', 'quantity', 1, 'section', 'dish'))::text),
      ARRAY['refused']);
    PERFORM pg_temp.said('G2', 'รายการอาหารที่ 1 ไม่ถูกต้อง');

    -- ── H. Per head ──
    PERFORM pg_temp.t('H1 sales puts the per-head set on a booking for 30 guests: the line is per head, 380 × 30 (kept)', sales_, 'sales',
      format($q$SELECT public.catering_save_booking_prices(%L, %L::jsonb, '[]'::jsonb, false)$q$, v_open,
        jsonb_build_array(jsonb_build_object('kind', 'set', 'refId', v_head, 'quantity', 30))::text),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_menus m JOIN public.catering_event_charges c ON c.event_menu_id = m.id
                 WHERE m.event_id = %L AND m.set_menu_id = %L AND m.per_head AND m.quantity = 30
                   AND c.unit_price = 380 AND c.quantity = 30 AND c.amount = 11400$q$, v_open, v_head),
      true);
    SELECT id INTO v_hline FROM public.catering_event_menus WHERE event_id = v_open AND set_menu_id = v_head;
    PERFORM pg_temp.t('H2 owner turns the per-head line into a per-table one', owner_, 'owner',
      format($q$UPDATE public.catering_event_menus SET per_head = false WHERE id = %L$q$, v_hline), ARRAY['refused']);
    PERFORM pg_temp.said('H2', 'เปลี่ยนภายหลังไม่ได้');
    PERFORM pg_temp.t('H3 a single-dish line inserted as per head is stamped per table', owner_, 'owner',
      format($q$SELECT 1 FROM public.catering_event_menus WHERE id = %L AND NOT per_head$q$, v_dishln), ARRAY['rows=1']);
    PERFORM pg_temp.t('H4 a per-table set line stays per table', owner_, 'owner',
      format($q$SELECT 1 FROM public.catering_event_menus WHERE id = %L AND NOT per_head$q$, v_line), ARRAY['rows=1']);

    -- ── M. แจ้งซ่อม: every write through the functions ──
    PERFORM pg_temp.t('M1 staff files a report with a photo (kept)', staff_, 'staff',
      format($q$SELECT public.maint_create('ไฟฟ้า', 'probe-m62-a', 'probe', false, %L)$q$, v_url),
      ARRAY['rows=1 check=1'], $q$SELECT 1 FROM public.maintenance_reports WHERE location = 'probe-m62-a' AND status = 'new' AND reporter_id = auth.uid()$q$, true);
    SELECT id INTO v_rep1 FROM public.maintenance_reports WHERE location = 'probe-m62-a';
    PERFORM pg_temp.t('M2 staff files a report with neither place nor details', staff_, 'staff',
      $q$SELECT public.maint_create('ไฟฟ้า', '  ', '', false, NULL)$q$, ARRAY['refused']);
    PERFORM pg_temp.said('M2', 'อย่างน้อยหนึ่งอย่าง');
    PERFORM pg_temp.t('M3 staff files a report whose photo is not an app upload', staff_, 'staff',
      $q$SELECT public.maint_create('ไฟฟ้า', 'x', 'x', false, 'https://example.com/a.jpg')$q$, ARRAY['refused']);
    PERFORM pg_temp.said('M3', 'รูปไม่ถูกต้อง');
    PERFORM pg_temp.t('M3b staff files a report whose photo sits on another site, in the app''s own path', staff_, 'staff',
      $q$SELECT public.maint_create('ไฟฟ้า', 'x', 'x', false, 'https://evil.example/storage/v1/object/public/sop-photos/maint-1-a.jpg')$q$, ARRAY['refused']);
    PERFORM pg_temp.said('M3b', 'รูปไม่ถูกต้อง');
    PERFORM pg_temp.t('M4 hr edits staff''s report', hr_, 'hr',
      format($q$SELECT public.maint_edit(%L, 'ไฟฟ้า', 'x', 'x', false, NULL)$q$, v_rep1), ARRAY['refused']);
    PERFORM pg_temp.said('M4', 'ไม่มีสิทธิ์แก้ไข');
    PERFORM pg_temp.t('M5 staff edits its own new report, keeping the photo', staff_, 'staff',
      format($q$SELECT public.maint_edit(%L, 'เครื่องครัว', 'probe-m62-a', 'แก้แล้ว', true, %L)$q$, v_rep1, v_url),
      ARRAY['rows=1 check=1'], format($q$SELECT 1 FROM public.maintenance_reports WHERE id = %L AND description = 'แก้แล้ว' AND is_urgent$q$, v_rep1));
    PERFORM pg_temp.t('M6 hr cancels staff''s new report', hr_, 'hr',
      format($q$SELECT public.maint_cancel(%L, 'x')$q$, v_rep1), ARRAY['refused']);
    PERFORM pg_temp.said('M6', 'เฉพาะคนที่แจ้ง หรือหัวหน้า');
    PERFORM pg_temp.t('M7 staff takes its own report', staff_, 'staff',
      format($q$SELECT public.maint_take(%L)$q$, v_rep1), ARRAY['refused']);
    PERFORM pg_temp.said('M7', 'ไม่มีสิทธิ์เปลี่ยนสถานะ');
    PERFORM pg_temp.t('M8 editor takes it (kept)', editor_, 'editor',
      format($q$SELECT public.maint_take(%L)$q$, v_rep1),
      ARRAY['rows=1 check=1'], format($q$SELECT 1 FROM public.maintenance_reports WHERE id = %L AND status = 'in_progress' AND resolver_id = auth.uid()$q$, v_rep1), true);
    PERFORM pg_temp.t('M9 staff edits it once taken', staff_, 'staff',
      format($q$SELECT public.maint_edit(%L, 'ไฟฟ้า', 'x', 'x', false, NULL)$q$, v_rep1), ARRAY['refused']);
    PERFORM pg_temp.said('M9', 'ยังไม่รับเรื่อง');
    PERFORM pg_temp.t('M10 staff (the reporter) cancels it once taken', staff_, 'staff',
      format($q$SELECT public.maint_cancel(%L, 'ไม่ต้องแล้ว')$q$, v_rep1), ARRAY['refused']);
    PERFORM pg_temp.said('M10', 'ยกเลิกได้เฉพาะหัวหน้า');
    PERFORM pg_temp.t('M11 editor cancels it in progress, with a note', editor_, 'editor',
      format($q$SELECT public.maint_cancel(%L, ' แจ้งซ้ำ ')$q$, v_rep1),
      ARRAY['rows=1 check=1'], format($q$SELECT 1 FROM public.maintenance_reports WHERE id = %L AND status = 'cancelled' AND cancelled_by = auth.uid() AND cancel_note = 'แจ้งซ้ำ' AND cancelled_at IS NOT NULL$q$, v_rep1));
    PERFORM pg_temp.t('M12 editor marks it done with a photo of another shape', editor_, 'editor',
      format($q$SELECT public.maint_done(%L, 'x', %L)$q$, v_rep1, v_url), ARRAY['refused']);
    PERFORM pg_temp.said('M12', 'รูปไม่ถูกต้อง');
    PERFORM pg_temp.t('M13 editor marks it done (kept)', editor_, 'editor',
      format($q$SELECT public.maint_done(%L, 'เปลี่ยนหลอดแล้ว', NULL)$q$, v_rep1),
      ARRAY['rows=1 check=1'], format($q$SELECT 1 FROM public.maintenance_reports WHERE id = %L AND status = 'done' AND resolved_at IS NOT NULL AND resolver_note = 'เปลี่ยนหลอดแล้ว'$q$, v_rep1), true);
    PERFORM pg_temp.t('M14 owner cancels the done report', owner_, 'owner',
      format($q$SELECT public.maint_cancel(%L, NULL)$q$, v_rep1), ARRAY['refused']);
    PERFORM pg_temp.said('M14', 'ซ่อมเสร็จแล้วยกเลิกไม่ได้');
    PERFORM pg_temp.t('M15 owner marks the done report done again', owner_, 'owner',
      format($q$SELECT public.maint_done(%L, NULL, NULL)$q$, v_rep1), ARRAY['refused']);
    PERFORM pg_temp.said('M15', 'ปิดไปแล้ว');
    PERFORM pg_temp.t('M16 sales files a report (kept)', sales_, 'sales',
      $q$SELECT public.maint_create(NULL, 'probe-m62-b', '', false, NULL)$q$,
      ARRAY['rows=1 check=1'], $q$SELECT 1 FROM public.maintenance_reports WHERE location = 'probe-m62-b' AND category = 'อื่นๆ'$q$, true);
    SELECT id INTO v_rep2 FROM public.maintenance_reports WHERE location = 'probe-m62-b';
    PERFORM pg_temp.t('M17 sales (the reporter) cancels its new report (kept)', sales_, 'sales',
      format($q$SELECT public.maint_cancel(%L, 'แจ้งผิด')$q$, v_rep2),
      ARRAY['rows=1 check=1'], format($q$SELECT 1 FROM public.maintenance_reports WHERE id = %L AND status = 'cancelled' AND cancelled_by = auth.uid()$q$, v_rep2), true);
    PERFORM pg_temp.t('M18 sales cancels it again', sales_, 'sales',
      format($q$SELECT public.maint_cancel(%L, NULL)$q$, v_rep2), ARRAY['refused']);
    PERFORM pg_temp.said('M18', 'ถูกยกเลิกไปแล้ว');
    PERFORM pg_temp.t('M19 editor takes the cancelled report', editor_, 'editor',
      format($q$SELECT public.maint_take(%L)$q$, v_rep2), ARRAY['refused']);
    PERFORM pg_temp.said('M19', 'เฉพาะรายการที่เพิ่งแจ้ง');
    PERFORM pg_temp.t('M20 staff inserts a report directly', staff_, 'staff',
      format($q$INSERT INTO public.maintenance_reports (reporter_id, location) VALUES (%L, 'x')$q$, staff_), ARRAY['denied']);
    PERFORM pg_temp.t('M21 owner changes a report''s status directly', owner_, 'owner',
      format($q$UPDATE public.maintenance_reports SET status = 'new' WHERE id = %L$q$, v_rep2), ARRAY['denied']);
    PERFORM pg_temp.t('M22 owner deletes a report directly', owner_, 'owner',
      format($q$DELETE FROM public.maintenance_reports WHERE id = %L$q$, v_rep2), ARRAY['denied']);
    PERFORM pg_temp.t('M23 an anonymous visitor files a report', NULL, 'anon',
      $q$SELECT public.maint_create('x', 'x', 'x', false, NULL)$q$, ARRAY['no-execute']);
    PERFORM pg_temp.t('M24 staff reads every report (reading unchanged)', staff_, 'staff',
      format($q$SELECT id FROM public.maintenance_reports WHERE id IN (%L, %L)$q$, v_rep1, v_rep2), ARRAY['rows=2']);

    -- ── T15. A menu deleted takes its links with it (as the file's own role) ──
    INSERT INTO public.menus (name, selling_price) VALUES ('probe-m62-menu-' || gen_random_uuid(), 1) RETURNING id INTO v_menu3;
    UPDATE public.catering_set_menu_items SET linked_menu_id = v_menu3 WHERE set_menu_id = v_real AND dish_name IS NOT NULL;
    UPDATE public.catering_event_menu_items SET linked_menu_id = v_menu3 WHERE event_menu_id = v_line AND dish_name IS NOT NULL;
    IF (SELECT count(*) FROM public.catering_set_menu_items WHERE linked_menu_id = v_menu3) < 1
       OR (SELECT count(*) FROM public.catering_event_menu_items WHERE linked_menu_id = v_menu3) < 1 THEN
      RAISE EXCEPTION 'FAIL    T15 setup: no typed dish was linked to the probe menu, so the test would prove nothing. Nothing applied.';
    END IF;
    DELETE FROM public.menus WHERE id = v_menu3;
    IF EXISTS (SELECT 1 FROM public.catering_set_menu_items WHERE linked_menu_id = v_menu3)
       OR EXISTS (SELECT 1 FROM public.catering_event_menu_items WHERE linked_menu_id = v_menu3) THEN
      RAISE EXCEPTION 'FAIL    T15 a deleted menu left links pointing at nothing. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      T15 a menu deleted clears every link to it, on a set and on a booking (the typed name stays, its cost unknown again)');

    v_log := current_setting('orders.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('orders.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (the bookings, the sets, the lines, the copies, the charges, the reports)');
  END;
END
$do$;

-- ── Step 5: nothing the tests did survived them, and the file reported ─────

DO $do$
DECLARE
  v_rows bigint;
  v_missing text[];
  -- Every row the file is supposed to emit, counted by the checker's rule
  -- (a t() or a note() is one row). Change a test, change this.
  c_expected constant bigint := 82;
BEGIN
  IF (SELECT count(*) FROM public.catering_events)::text <> current_setting('m62.n_events')
     OR (SELECT count(*) FROM public.catering_set_menus)::text <> current_setting('m62.n_sets')
     OR (SELECT count(*) FROM public.catering_set_menu_items)::text <> current_setting('m62.n_setitems')
     OR (SELECT count(*) FROM public.catering_event_menus)::text <> current_setting('m62.n_lines')
     OR (SELECT count(*) FROM public.catering_event_menu_items)::text <> current_setting('m62.n_copies')
     OR (SELECT count(*) FROM public.catering_event_charges)::text <> current_setting('m62.n_charges')
     OR (SELECT count(*) FROM public.maintenance_reports)::text <> current_setting('m62.n_maint')
     OR (SELECT md5(COALESCE(string_agg(id::text || status || updated_at::text || COALESCE(cost_locked_at::text, ''), ',' ORDER BY id), ''))
           FROM public.catering_events) <> current_setting('m62.fp_events')
     OR (SELECT md5(COALESCE(string_agg(id::text || label || unit_price::text || quantity::text || amount::text, ',' ORDER BY id), ''))
           FROM public.catering_event_charges) <> current_setting('m62.fp_charges')
     OR (SELECT md5(COALESCE(string_agg(id::text || quantity::text || COALESCE(set_name, '') || COALESCE(set_menu_id::text, ''), ',' ORDER BY id), ''))
           FROM public.catering_event_menus) <> current_setting('m62.fp_lines')
     OR (SELECT md5(COALESCE(string_agg(id::text || status || updated_at::text, ',' ORDER BY id), ''))
           FROM public.maintenance_reports) <> current_setting('m62.fp_maint') THEN
    RAISE EXCEPTION 'FAIL    a count or a fingerprint changed: a test write survived. Nothing applied.';
  END IF;
  SELECT array_agg(c) INTO v_missing FROM unnest(ARRAY[
    'catering_set_menu_items_dish_one_kind', 'catering_set_menu_items_dish_name_ok', 'catering_set_menu_items_link_only_typed',
    'catering_event_menu_items_dish_one_kind', 'catering_event_menu_items_dish_name_ok', 'catering_event_menu_items_link_only_typed',
    'maintenance_reports_status_check', 'maintenance_reports_cancel_recorded', 'maintenance_reports_cancel_note_len']) AS c
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c);
  IF v_missing IS NOT NULL
     OR to_regclass('public.uq_catering_set_menu_items_dish_name') IS NULL
     OR to_regclass('public.uq_catering_event_menu_items_dish_name') IS NULL
     OR (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('trg_catering_event_menus_per_head',
           'trg_catering_set_menu_items_link_check', 'trg_catering_event_menu_items_link_check', 'trg_menus_clear_dish_links')) <> 4 THEN
    RAISE EXCEPTION 'FAIL    a check, index or trigger is missing: %. Nothing applied.', v_missing;
  END IF;
  -- K. แจ้งซ่อม, read from the catalog: no permissive write policy of any
  -- name, no write privilege for an app role, the read policy in place, and
  -- the functions callable by signed-in accounts only.
  IF EXISTS (SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = 'maintenance_reports' AND p.permissive = 'PERMISSIVE'
                AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
     OR NOT EXISTS (SELECT 1 FROM pg_policies p
                     WHERE p.schemaname = 'public' AND p.tablename = 'maintenance_reports' AND p.policyname = 'maint_read' AND p.cmd = 'SELECT')
     OR has_table_privilege('authenticated', 'public.maintenance_reports', 'INSERT')
     OR has_table_privilege('authenticated', 'public.maintenance_reports', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.maintenance_reports', 'DELETE')
     OR has_table_privilege('anon', 'public.maintenance_reports', 'INSERT')
     OR has_table_privilege('anon', 'public.maintenance_reports', 'UPDATE')
     OR has_table_privilege('anon', 'public.maintenance_reports', 'DELETE')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.maintenance_reports'::regclass)
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['public.maint_create(text, text, text, boolean, text)', 'public.maint_edit(uuid, text, text, text, boolean, text)',
                                          'public.maint_take(uuid)', 'public.maint_done(uuid, text, text)', 'public.maint_cancel(uuid, text)',
                                          'public.catering_save_typed_dishes(uuid, jsonb, jsonb)']) AS f
                 WHERE has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE'))
     -- The code live when this runs writes แจ้งซ่อม with the service key: it must keep that.
     OR NOT has_table_privilege('service_role', 'public.maintenance_reports', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.maintenance_reports', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL    แจ้งซ่อม is not closed to direct writes, or its read or functions are not as written. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K1 maintenance_reports, read from the catalog: no permissive INSERT, UPDATE, DELETE or ALL policy of any name; no write privilege for anon or authenticated; row security on; maint_read in place; the six functions for signed-in accounts only; the service key keeps its writes (the code live when this runs uses it)');
  PERFORM pg_temp.note(format('ok      counts and fingerprints as before (bookings %s, sets %s, dish rows %s, lines %s, copies %s, charges %s, แจ้งซ่อม %s); 9 checks, 2 unique indexes, the per-head trigger, the two link checks and the menu-delete link clear in place',
    current_setting('m62.n_events'), current_setting('m62.n_sets'), current_setting('m62.n_setitems'),
    current_setting('m62.n_lines'), current_setting('m62.n_copies'), current_setting('m62.n_charges'), current_setting('m62.n_maint')));

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
  pg_temp.said(text, text),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs ════════════════════════════════════════════════════════
--
-- Nothing changes on screen until the code that uses it is pushed (it waits
-- for this file). The แจ้งซ่อม screens of the code live NOW keep reading as
-- before, but their writes go through the service key, which the revoke does
-- not touch; the new code moves them to the functions.
