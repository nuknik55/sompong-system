-- ============================================================================
-- Supply orders: the approval flow (README item 35), 2026-09-23
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. ONE
-- transaction: it records what is live, changes the two order tables and the
-- two template tables, creates the functions the app will call, closes every
-- direct write, cancels the 22 orders left open from the trial, tests all of
-- it AS REAL ACCOUNTS with every test write rolled back, counts its own
-- result rows, and rolls the whole thing back if anything disagrees.
-- Re-runnable while no order is open: it asserts the 22 open orders only on
-- a first run (a re-run finds 0 open and 22 cancelled and says so), every
-- DROP is IF EXISTS and every CREATE is OR REPLACE / IF NOT EXISTS; once the
-- flow is in use and an order is open, Step 4 refuses and nothing changes.
--
-- WHY (Nik, 2026-09-23). Ordering has been on paper: staff write the stock
-- left and the quantity to order, a head checks it, and the purchaser (อู๋)
-- orders from each supplier by LINE or phone. The app's flow never went live
-- because duties and permissions were never defined; everything in it so far
-- was trial. Nik's decisions, numbered as in the 2026-09-23 report, are the
-- rules below.
--
-- WHO MAY DO WHAT (the functions refuse everything else; direct table writes
-- are closed for every app role)
--   "a head"      is_order_head(): editor, admin or owner — ONE replaceable
--                 function, so heads can be narrowed later without touching
--                 the order code. A staff login is never a head. (1)
--   "may order"   can_order(): staff, editor, admin, owner. hr and sales
--                 cannot order, receive or cancel. (9)
--   create        anyone who may order; the creator is auth.uid() (15)
--   edit lines    the creator, while the order waits for review or was
--                 returned; refused once a head approved (6). Every quantity
--                 change is logged with who, old, new, when (3).
--   head quantity a head, while the order waits for review (before
--                 approving); locked after (3). Logged the same way.
--   approve       any head, any order, own order included (2, 4); refused if
--                 the order changed after the head opened it — the head
--                 passes the order version it read, and every edit counts
--                 the version up (3).
--   return        a head, until the order is marked sent (7); the head's
--                 note is its own column, the staff note stays; the head's
--                 quantities are cleared (logged), so the creator's fix is
--                 what the next head sees.
--   mark sent     owner or admin (5). The purchaser-quantity stage is gone
--                 from the server; its column and 3 stored values stay.
--   receive       anyone who may order, line by line; who received and when
--                 is stored PER LINE; the order closes itself when every line
--                 has a quantity. The direct sent→received move is closed (8).
--   cancel        instead of delete, status ยกเลิก: the creator while it
--                 waits for review; a head before it is sent; owner and admin
--                 after it is sent too. Who and when are recorded. Deletes are
--                 closed for every app role (10).
--   station       optional, and no part of approval (2). stations and
--                 station_ingredients are untouched.
--
-- WHAT IT CHANGES
--   templates, template_items   definitions in the repo (created outside it;
--     CREATE TABLE IF NOT EXISTS is a no-op live); the open auth_write_* and
--     duplicate auth_read_* policies dropped; anon's table grants revoked.
--     The role-checked policies stay. The screen writes through the service
--     role and is unaffected.
--   order_sessions   status may be 'cancelled'; version (the conflict
--     token); return_note, returned_by, returned_at, cancelled_by,
--     cancelled_at, cancel_note; created_by must
--     be present on every order created from today (the 13 July orders that
--     lost theirs stay as they are); created_by, reviewed_by, sent_by and
--     approved_by now refuse the deletion of an account with order history
--     (ON DELETE RESTRICT instead of SET NULL). station_id keeps SET NULL.
--   order_items      received_by, received_at.
--   order_item_changes   NEW: one row per quantity change (creator, head,
--     receiver), written only by the functions; readable by anyone signed in.
--   functions   is_order_head(), can_order(), order_create, order_edit,
--     order_set_head_qty, order_approve, order_return, order_mark_sent,
--     receive_order_item (rewritten: 'approved' is a retired status),
--     order_cancel. SECURITY DEFINER, each checking role, status and creator
--     itself (the receive_order_item pattern). order_log_change is their
--     private helper, not callable by app roles.
--   policies   the eight permissive write policies on order_sessions and
--     order_items are dropped; RESTRICTIVE deny policies close INSERT,
--     UPDATE and DELETE on both and on order_item_changes; INSERT, UPDATE and
--     DELETE privileges are revoked from anon and authenticated on all three.
--     Reads stay as they were: any signed-in account.
--   data   the 22 orders left open from the trial (5 submitted, 5 reviewed,
--     12 sent, none touched since 2026-08-04) become ยกเลิก with the note
--     "ปิดโดยระบบก่อนเริ่มใช้ขั้นตอนอนุมัติใหม่". Nothing is deleted. The
--     counts are asserted first; a different count stops the file.
--
-- NOTHING ELSE IS CHANGED. Every test write happens inside a block that is
-- rolled back before the file goes on. Results are kept in a setting of this
-- session, never a table, and the last statement prints and clears them.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE, all of them expected:
--   - DROP POLICY IF EXISTS: the eight write policies on the two order tables
--     by name, the nine RESTRICTIVE policies this file creates (so it can
--     run again), the two template SELECT policies it re-creates, and every
--     auth_write_* / auth_read_* policy on templates
--     and template_items (found by name pattern).
--   - ALTER TABLE order_sessions DROP CONSTRAINT: its status CHECK (re-added
--     with 'cancelled'), the created_by CHECK this file adds (dropped IF
--     EXISTS first, so it can run again), and the four foreign keys to
--     profiles (re-added as ON DELETE RESTRICT). The constraint names are
--     read from the catalog.
--   - REVOKE INSERT, UPDATE, DELETE on order_sessions, order_items and
--     order_item_changes from anon and authenticated; REVOKE ALL on templates
--     and template_items from anon; REVOKE EXECUTE on every function this
--     file creates from PUBLIC (then GRANT to authenticated, except the two
--     private helpers).
--   - UPDATE order_sessions: the 22 open trial orders to 'cancelled' (Step 2).
--   - CREATE OR REPLACE FUNCTION ×12 in public and the pg_temp helpers; after
--     COMMIT, DROP FUNCTION IF EXISTS on the pg_temp helpers.
--   - Inside the always-aborting test block: the INSERT/UPDATE/DELETE the
--     tests make through the functions and by direct call, one DELETE FROM
--     profiles that is expected to be refused — all rolled back.
-- Anything else it calls destructive is NOT expected: stop and send it.
-- Never "Run and enable RLS": every policy here is written out.
--
-- THE TESTS DO NOT KEEP TO "EACH TEST WRITE TOUCHES ONE ROW" where a function
-- writes an order whole (one order row and its lines), on purpose; Step 4
-- checks every count afterwards.
--
-- RUN IT WHILE NOBODY IS ORDERING (nobody is: the flow is not in use).
--
-- WHAT THE TESTS CANNOT SHOW: two sessions at once. order_set_head_qty and
-- receive_order_item lock the order row as well as the line (FOR UPDATE OF
-- i, s), so they queue behind an approval or a cancellation in flight, and
-- two receivers closing the last two lines at once see each other; a
-- single-connection test cannot exercise that, so it is stated here.
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

-- The lines the tests order with: two lines, no ingredient link (the column
-- allows it), names that no real order uses.
CREATE OR REPLACE FUNCTION pg_temp.lines(p_qty1 numeric, p_qty2 numeric)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_array(
    jsonb_build_object('ingredient_id', NULL, 'ingredient_name', 'probe-item-1', 'remaining_kitchen_qty', 1,
      'remaining_kitchen_unit', 'โล', 'remaining_freezer_qty', NULL, 'remaining_freezer_unit', NULL,
      'pack_count', NULL, 'qty_per_pack', NULL, 'qty_ordered', p_qty1, 'order_unit', 'โล', 'note', NULL),
    jsonb_build_object('ingredient_id', NULL, 'ingredient_name', 'probe-item-2', 'remaining_kitchen_qty', NULL,
      'remaining_kitchen_unit', NULL, 'remaining_freezer_qty', 2, 'remaining_freezer_unit', 'ถุง',
      'pack_count', NULL, 'qty_per_pack', NULL, 'qty_ordered', p_qty2, 'order_unit', 'ถุง', 'note', 'probe'));
$fn$;

-- ── The harness tests ITSELF, before it tests anything else ────────────────

DO $do$
DECLARE
  v_here text := 'UPDATE public.order_sessions SET note = NULL WHERE id = NULL';
BEGIN
  IF pg_temp.sql_target(v_here) IS DISTINCT FROM 'order_sessions'
     OR pg_temp.sql_target('insert into order_items (session_id) values (NULL)') IS DISTINCT FROM 'order_items'
     OR pg_temp.sql_target('DELETE FROM public.profiles WHERE id = NULL') IS DISTINCT FROM 'profiles' THEN
    RAISE EXCEPTION 'the harness cannot name the table a write statement targets. Nothing applied.';
  END IF;
  IF pg_temp.classify('denied:order_sessions', v_here) IS DISTINCT FROM 'denied'
     OR pg_temp.classify('denied:profiles', v_here) NOT LIKE 'error (a policy on another table)%'
     OR pg_temp.classify('rows=1', v_here) IS DISTINCT FROM 'rows=1' THEN
    RAISE EXCEPTION 'the harness misreads a refusal. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      X1 the harness names the table a write targets, reads a refusal from it as "denied", and one from another table as an error');
  IF pg_temp.lines(3, 2) -> 1 ->> 'qty_ordered' <> '2' OR jsonb_array_length(pg_temp.lines(3, 2)) <> 2 THEN
    RAISE EXCEPTION 'the harness cannot build its own test lines. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      X2 the harness builds the two test lines it orders with');
END
$do$;

-- ── Step 0: what is live, and the accounts the tests need ──────────────────

DO $do$
DECLARE
  v_owner  uuid;
  v_admin  uuid;
  v_editor uuid;
  v_staff  uuid;
  v_hr     uuid;
  v_sales  uuid;
  v_txt    text;
  v_fk     text;
  v_n_sub  bigint;
  v_n_ret  bigint;
  v_n_rev  bigint;
  v_n_sent bigint;
  v_n_rcv  bigint;
  v_n_can  bigint;
BEGIN
  PERFORM 'public.current_role()'::regprocedure;
  PERFORM 'public.is_editor_or_above()'::regprocedure;
  IF to_regclass('public.order_sessions') IS NULL OR to_regclass('public.order_items') IS NULL THEN
    RAISE EXCEPTION 'the order tables are missing (migration 008 has not run). Nothing changed.';
  END IF;
  IF to_regclass('public.templates') IS NULL OR to_regclass('public.template_items') IS NULL THEN
    RAISE EXCEPTION 'templates / template_items are missing: this file expected the live tables created outside the repo. Nothing changed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'reviewer_qty_ordered') THEN
    RAISE EXCEPTION 'order_items.reviewer_qty_ordered is missing (migration 012 has not run). Nothing changed.';
  END IF;

  SELECT id INTO v_owner  FROM public.profiles WHERE role = 'owner'  ORDER BY id LIMIT 1;
  SELECT id INTO v_admin  FROM public.profiles WHERE role = 'admin'  ORDER BY id LIMIT 1;
  SELECT id INTO v_editor FROM public.profiles WHERE role = 'editor' ORDER BY id LIMIT 1;
  SELECT id INTO v_staff  FROM public.profiles WHERE role = 'staff'  ORDER BY id LIMIT 1;
  SELECT id INTO v_hr     FROM public.profiles WHERE role = 'hr'     ORDER BY id LIMIT 1;
  SELECT id INTO v_sales  FROM public.profiles WHERE role = 'sales'  ORDER BY id LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL OR v_editor IS NULL OR v_staff IS NULL OR v_hr IS NULL OR v_sales IS NULL THEN
    RAISE EXCEPTION 'need one profile of each role to test as (owner, admin, editor, staff, hr, sales); found owner %, admin %, editor %, staff %, hr %, sales %. Nothing changed.',
      v_owner, v_admin, v_editor, v_staff, v_hr, v_sales;
  END IF;
  PERFORM set_config('orders.owner',  v_owner::text,  false);
  PERFORM set_config('orders.admin',  v_admin::text,  false);
  PERFORM set_config('orders.editor', v_editor::text, false);
  PERFORM set_config('orders.staff',  v_staff::text,  false);
  PERFORM set_config('orders.hr',     v_hr::text,     false);
  PERFORM set_config('orders.sales',  v_sales::text,  false);

  SELECT count(*) FILTER (WHERE status = 'submitted'), count(*) FILTER (WHERE status = 'returned'),
         count(*) FILTER (WHERE status = 'reviewed'),  count(*) FILTER (WHERE status = 'sent'),
         count(*) FILTER (WHERE status = 'received'),  count(*) FILTER (WHERE status = 'cancelled')
    INTO v_n_sub, v_n_ret, v_n_rev, v_n_sent, v_n_rcv, v_n_can
    FROM public.order_sessions;
  PERFORM pg_temp.note(format('before  orders %s: submitted %s, returned %s, reviewed %s, sent %s, received %s, cancelled %s (a re-run says 0 open and 22 cancelled)',
    v_n_sub + v_n_ret + v_n_rev + v_n_sent + v_n_rcv + v_n_can, v_n_sub, v_n_ret, v_n_rev, v_n_sent, v_n_rcv, v_n_can));
  PERFORM set_config('orders.n_sessions', (v_n_sub + v_n_ret + v_n_rev + v_n_sent + v_n_rcv + v_n_can)::text, false);
  PERFORM set_config('orders.n_open', (v_n_sub + v_n_ret + v_n_rev + v_n_sent)::text, false);
  PERFORM set_config('orders.n_received', v_n_rcv::text, false);
  PERFORM set_config('orders.n_cancelled', v_n_can::text, false);
  PERFORM set_config('orders.n_items', (SELECT count(*) FROM public.order_items)::text, false);
  PERFORM pg_temp.note(format('before  no creator %s, self-reviewed %s of %s reviewed, no station %s; lines %s, head quantity set on %s, purchaser quantity on %s, received on %s',
    (SELECT count(*) FROM public.order_sessions WHERE created_by IS NULL),
    (SELECT count(*) FROM public.order_sessions WHERE reviewed_by IS NOT NULL AND reviewed_by = created_by),
    (SELECT count(*) FROM public.order_sessions WHERE reviewed_by IS NOT NULL),
    (SELECT count(*) FROM public.order_sessions WHERE station_id IS NULL),
    (SELECT count(*) FROM public.order_items),
    (SELECT count(*) FROM public.order_items WHERE reviewer_qty_ordered IS NOT NULL),
    (SELECT count(*) FROM public.order_items WHERE editor_qty_ordered IS NOT NULL),
    (SELECT count(*) FROM public.order_items WHERE qty_received IS NOT NULL)));

  -- The foreign keys from order_sessions to profiles, with their ON DELETE
  -- action, and whether created_by allows NULL: the drift found 2026-09-23.
  SELECT string_agg(a.attname || ':' || CASE c.confdeltype WHEN 'n' THEN 'set null' WHEN 'r' THEN 'restrict'
                                                            WHEN 'a' THEN 'no action' WHEN 'c' THEN 'cascade' ELSE c.confdeltype::text END,
                    ', ' ORDER BY a.attname)
    INTO v_fk
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.conrelid = 'public.order_sessions'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.profiles'::regclass;
  PERFORM pg_temp.note(format('before  order_sessions -> profiles: %s; created_by nullable: %s (the repo says NOT NULL and no ON DELETE action; a re-run says restrict)',
    COALESCE(v_fk, 'none'),
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_sessions' AND column_name = 'created_by')));

  -- Decision 15: every OTHER table whose foreign key to profiles is ON DELETE
  -- SET NULL, listed and left alone.
  SELECT string_agg(c.conrelid::regclass::text || '.' || a.attname, ', ' ORDER BY c.conrelid::regclass::text, a.attname)
    INTO v_txt
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.contype = 'f' AND c.confrelid = 'public.profiles'::regclass AND c.confdeltype = 'n'
     AND c.conrelid <> 'public.order_sessions'::regclass;
  PERFORM pg_temp.note('before  other columns referencing profiles ON DELETE SET NULL (listed, not changed): ' || COALESCE(v_txt, 'none'));

  -- The write policies on the two order tables, by name: the eight the repo
  -- knows are dropped below; anything else is reported here.
  SELECT string_agg(tablename || '.' || policyname || ' (' || cmd || CASE WHEN permissive = 'PERMISSIVE' THEN '' ELSE ', restrictive' END || ')', ', ' ORDER BY tablename, policyname)
    INTO v_txt
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('order_sessions', 'order_items') AND cmd <> 'SELECT';
  PERFORM pg_temp.note('before  write policies on the order tables: ' || COALESCE(v_txt, 'none'));

  -- templates / template_items: their live definitions, so the repo's copy
  -- can be corrected if a type differs, and their policies by name.
  SELECT string_agg(table_name || '.' || column_name || ' ' || data_type
                    || CASE WHEN is_nullable = 'NO' THEN ' not null' ELSE '' END, ', ' ORDER BY table_name, ordinal_position)
    INTO v_txt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('templates', 'template_items');
  PERFORM pg_temp.note('before  templates live columns: ' || COALESCE(v_txt, 'none'));
  SELECT string_agg(tablename || '.' || policyname || ' (' || cmd || ', ' || array_to_string(roles, '/') || ')', ', ' ORDER BY tablename, policyname)
    INTO v_txt
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('templates', 'template_items');
  PERFORM pg_temp.note('before  templates policies: ' || COALESCE(v_txt, 'none'));

  -- The objects this file creates, looked up by NAME AS TEXT: never named in
  -- executable SQL before their own CREATE.
  PERFORM pg_temp.note(format('before  order_item_changes exists: %s; order_approve exists: %s (a re-run says true, true)',
    to_regclass('public.order_item_changes') IS NOT NULL,
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'order_approve')));
END
$do$;

-- ── Step 1a: the template tables, in the repo at last ──────────────────────
-- Created outside the repo (no file made them); live they exist, so these
-- are no-ops. The types are read from the app's use of the columns; Step 0
-- printed the live definitions to compare. The open auth_write_* policies
-- (ALL, authenticated, USING true, CHECK true) OR-ed with the role-checked
-- ones and let any signed-in account write or delete templates; the
-- duplicate auth_read_* policies added nothing. Both kinds go. The
-- role-checked *_insert / *_update / *_delete policies stay as they are.

-- Corrected on 2026-09-23 AFTER the file ran, to the live columns it
-- printed (the CREATEs were no-ops live, so the run is unaffected):
-- templates has created_by (ON DELETE SET NULL live); template_items has no
-- created_at; default_qty printed only as "numeric", which information_schema
-- shows for any precision, so none is claimed; defaults were not printed.
CREATE TABLE IF NOT EXISTS public.templates (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  created_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.template_items (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid          NOT NULL REFERENCES public.templates(id) ON DELETE CASCADE,
  ingredient_id uuid          NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  order_unit    text,
  default_qty   numeric,
  kitchen_unit  text,
  freezer_unit  text,
  custom_group  text,
  sort_order    int           NOT NULL DEFAULT 0
);

ALTER TABLE public.templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_items ENABLE ROW LEVEL SECURITY;

DO $do$
DECLARE
  r record;
  v_n int := 0;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename IN ('templates', 'template_items')
              AND (policyname LIKE 'auth_write_%' OR policyname LIKE 'auth_read_%') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    v_n := v_n + 1;
  END LOOP;
  PERFORM set_config('orders.tpl_dropped', v_n::text, false);
END
$do$;

REVOKE ALL ON public.templates, public.template_items FROM anon;

-- Reads for every signed-in account, so a template can be picked; the
-- writes stay with the role-checked policies that already exist.
DROP POLICY IF EXISTS templates_select      ON public.templates;
DROP POLICY IF EXISTS template_items_select ON public.template_items;
CREATE POLICY templates_select      ON public.templates      FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY template_items_select ON public.template_items FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Step 1b: the order tables ──────────────────────────────────────────────

ALTER TABLE public.order_sessions DROP CONSTRAINT IF EXISTS order_sessions_status_check;
ALTER TABLE public.order_sessions
  ADD CONSTRAINT order_sessions_status_check
  CHECK (status IN ('submitted', 'returned', 'reviewed', 'sent', 'received', 'cancelled'));

ALTER TABLE public.order_sessions
  ADD COLUMN IF NOT EXISTS return_note  text,
  ADD COLUMN IF NOT EXISTS returned_by  uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS returned_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_note  text,
  ADD COLUMN IF NOT EXISTS version      int  NOT NULL DEFAULT 0;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

-- Every order created from today has a creator (decision 15). The 13 July
-- orders that lost theirs when accounts were deleted stay as they are, so the
-- rule starts at the date the flow starts rather than at NOT NULL.
ALTER TABLE public.order_sessions DROP CONSTRAINT IF EXISTS order_sessions_created_by_present;
ALTER TABLE public.order_sessions
  ADD CONSTRAINT order_sessions_created_by_present
  CHECK (created_by IS NOT NULL OR created_at < '2026-09-23 00:00:00+07');

-- created_by, reviewed_by, sent_by and approved_by: ON DELETE RESTRICT, so
-- deleting an account with order history is refused (the team page offers
-- disabling instead). The live constraint names are read from the catalog:
-- they were changed outside the repo. station_id keeps its SET NULL.
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT c.conname, a.attname
             FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE c.conrelid = 'public.order_sessions'::regclass AND c.contype = 'f'
              AND c.confrelid = 'public.profiles'::regclass
              AND a.attname IN ('created_by', 'reviewed_by', 'sent_by', 'approved_by') LOOP
    EXECUTE format('ALTER TABLE public.order_sessions DROP CONSTRAINT %I', r.conname);
    EXECUTE format('ALTER TABLE public.order_sessions ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.profiles(id) ON DELETE RESTRICT',
                   'order_sessions_' || r.attname || '_fkey', r.attname);
  END LOOP;
END
$do$;

-- ── Step 1c: the change log ────────────────────────────────────────────────
-- One row per quantity change, by the creator (qty_ordered), a head
-- (reviewer_qty_ordered) or a receiver (qty_received): who, old, new, when.
-- Written only by the functions below; readable by anyone signed in.

CREATE TABLE IF NOT EXISTS public.order_item_changes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid        NOT NULL REFERENCES public.order_sessions(id) ON DELETE CASCADE,
  item_id    uuid        NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  field      text        NOT NULL CHECK (field IN ('qty_ordered', 'reviewer_qty_ordered', 'qty_received')),
  old_value  numeric(12,4),
  new_value  numeric(12,4),
  changed_by uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_item_changes_session_idx ON public.order_item_changes (session_id, changed_at);

ALTER TABLE public.order_item_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_item_changes_select ON public.order_item_changes;
CREATE POLICY order_item_changes_select ON public.order_item_changes FOR SELECT USING (auth.uid() IS NOT NULL);

-- ── Step 1d: who is who ────────────────────────────────────────────────────

-- THE ONE definition of a head (decision 1). Narrowing heads later means
-- changing this function alone; every order function asks it.
CREATE OR REPLACE FUNCTION public.is_order_head()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_role() IN ('editor', 'admin', 'owner');
$$;
COMMENT ON FUNCTION public.is_order_head() IS
  'Who may approve, return, change the head quantity of, and cancel a supply order: editor, admin, owner (Nik, 2026-09-23). A staff login is never a head. Change this to narrow heads.';

-- Who may take part in ordering at all: place, edit, receive, cancel their
-- own (decision 9: hr and sales cannot).
CREATE OR REPLACE FUNCTION public.can_order()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.current_role() IN ('staff', 'editor', 'admin', 'owner');
$$;
COMMENT ON FUNCTION public.can_order() IS
  'Who may place, edit, receive and cancel supply orders: staff, editor, admin, owner (Nik, 2026-09-23). hr and sales may not.';

-- ── Step 1e: the functions the app calls ───────────────────────────────────
-- Each one: needs a login; checks the role, the status and (where it
-- matters) the creator; refuses with a message the screen shows as it is;
-- writes with WHERE id AND status, and RAISES when nothing was written, so a
-- status move never reports success for a change it did not make.

-- Private: the change log. Not callable by app roles (EXECUTE revoked
-- below); the functions run as the file's owner and may.
CREATE OR REPLACE FUNCTION public.order_log_change(p_session uuid, p_item uuid, p_field text, p_old numeric, p_new numeric, p_who uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF p_old IS DISTINCT FROM p_new THEN
    INSERT INTO public.order_item_changes (session_id, item_id, field, old_value, new_value, changed_by)
    VALUES (p_session, p_item, p_field, p_old, p_new, p_who);
  END IF;
END
$fn$;

-- The head's conflict token is the order's version: every edit to the order
-- or its lines counts it up (updated_at cannot serve: the touch trigger
-- stamps now(), which is the same for a whole transaction).
CREATE OR REPLACE FUNCTION public.order_touch(p_session uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE public.order_sessions SET version = version + 1 WHERE id = p_session;
END
$fn$;

-- Create: the caller is the creator. p_items is the order form's lines
-- (OrderItemInput in src/app/staff/inventory/actions.ts), in order.
CREATE OR REPLACE FUNCTION public.order_create(p_station_id uuid, p_note text, p_items jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_id    uuid;
  v_line  jsonb;
  v_i     int := 0;
  v_qty   numeric;
  v_kq    numeric;
  v_fq    numeric;
  v_pk    numeric;
  v_pp    numeric;
  v_ing   uuid;
  v_kept  int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน'; END IF;
  IF NOT COALESCE(public.can_order(), false) THEN RAISE EXCEPTION 'สิทธิ์นี้สั่งของไม่ได้'; END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'กรุณากรอกข้อมูลอย่างน้อย 1 รายการ (คงเหลือ หรือ จำนวนสั่ง)';
  END IF;
  IF jsonb_array_length(p_items) > 500 THEN RAISE EXCEPTION 'รายการมากเกินไป (สูงสุด 500 บรรทัด)'; END IF;
  IF p_station_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.stations WHERE id = p_station_id) THEN
    RAISE EXCEPTION 'ไม่พบแผนกที่เลือก';
  END IF;

  -- Every line is checked before anything is written.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_line) <> 'object' OR COALESCE(v_line ->> 'ingredient_name', '') = '' THEN
      RAISE EXCEPTION 'บรรทัดที่ % ไม่มีชื่อวัตถุดิบ', v_i;
    END IF;
    BEGIN
      v_qty := COALESCE((v_line ->> 'qty_ordered')::numeric, 0);
      v_kq  := (v_line ->> 'remaining_kitchen_qty')::numeric;
      v_fq  := (v_line ->> 'remaining_freezer_qty')::numeric;
      v_pk  := (v_line ->> 'pack_count')::numeric;
      v_pp  := (v_line ->> 'qty_per_pack')::numeric;
      v_ing := NULLIF(v_line ->> 'ingredient_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'บรรทัดที่ % (%): จำนวนหรือรหัสวัตถุดิบไม่ถูกต้อง', v_i, v_line ->> 'ingredient_name';
    END;
    IF v_qty < 0 OR v_qty > 1000000 OR COALESCE(v_kq, 0) < 0 OR COALESCE(v_fq, 0) < 0
       OR COALESCE(v_pk, 0) < 0 OR COALESCE(v_pp, 0) < 0 THEN
      RAISE EXCEPTION 'บรรทัดที่ % (%): จำนวนต้องเป็น 0 ขึ้นไป', v_i, v_line ->> 'ingredient_name';
    END IF;
    IF v_ing IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ingredients WHERE id = v_ing) THEN
      RAISE EXCEPTION 'บรรทัดที่ % (%): ไม่พบวัตถุดิบ', v_i, v_line ->> 'ingredient_name';
    END IF;
    IF v_qty > 0 OR v_kq IS NOT NULL OR v_fq IS NOT NULL THEN v_kept := v_kept + 1; END IF;
  END LOOP;
  IF v_kept = 0 THEN
    RAISE EXCEPTION 'กรุณากรอกข้อมูลอย่างน้อย 1 รายการ (คงเหลือ หรือ จำนวนสั่ง)';
  END IF;

  INSERT INTO public.order_sessions (station_id, note, created_by, submitted_at)
  VALUES (p_station_id, NULLIF(p_note, ''), v_uid, now())
  RETURNING id INTO v_id;

  -- Lines with nothing on them are left out, as the order form leaves them out.
  INSERT INTO public.order_items (session_id, ingredient_id, ingredient_name, remaining_kitchen_qty, remaining_kitchen_unit,
                                  remaining_freezer_qty, remaining_freezer_unit, pack_count, qty_per_pack, qty_ordered,
                                  order_unit, note, sort_order)
  SELECT v_id,
         NULLIF(l.value ->> 'ingredient_id', '')::uuid,
         l.value ->> 'ingredient_name',
         (l.value ->> 'remaining_kitchen_qty')::numeric,
         NULLIF(l.value ->> 'remaining_kitchen_unit', ''),
         (l.value ->> 'remaining_freezer_qty')::numeric,
         NULLIF(l.value ->> 'remaining_freezer_unit', ''),
         (l.value ->> 'pack_count')::numeric,
         (l.value ->> 'qty_per_pack')::numeric,
         COALESCE((l.value ->> 'qty_ordered')::numeric, 0),
         NULLIF(l.value ->> 'order_unit', ''),
         NULLIF(l.value ->> 'note', ''),
         (l.ordinality - 1)::int
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS l(value, ordinality)
   WHERE COALESCE((l.value ->> 'qty_ordered')::numeric, 0) > 0
      OR (l.value ->> 'remaining_kitchen_qty') IS NOT NULL
      OR (l.value ->> 'remaining_freezer_qty') IS NOT NULL;
  RETURN v_id;
END
$fn$;

-- Edit lines: the creator, while the order waits for review or was returned
-- (decision 6). p_items: [{id, remaining_kitchen_qty, remaining_kitchen_unit,
-- remaining_freezer_qty, remaining_freezer_unit, qty_ordered, order_unit}],
-- each a line of THIS order. With p_resubmit a returned order goes back to
-- waiting. Returns the number of lines written.
CREATE OR REPLACE FUNCTION public.order_edit(p_session uuid, p_items jsonb, p_resubmit boolean DEFAULT false)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_status text;
  v_by     uuid;
  v_line   jsonb;
  v_item   uuid;
  v_old    numeric;
  v_new    numeric;
  v_kq     numeric;
  v_fq     numeric;
  v_n      int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน'; END IF;
  IF NOT COALESCE(public.can_order(), false) THEN RAISE EXCEPTION 'สิทธิ์นี้สั่งของไม่ได้'; END IF;
  SELECT status, created_by INTO v_status, v_by FROM public.order_sessions WHERE id = p_session FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'ไม่พบใบสั่งของ'; END IF;
  IF v_by IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'เฉพาะผู้สร้างใบสั่งของเท่านั้นที่แก้ไขได้'; END IF;
  IF v_status NOT IN ('submitted', 'returned') THEN
    RAISE EXCEPTION 'แก้ไขไม่ได้แล้ว: ใบสั่งของอยู่ในสถานะ %', v_status;
  END IF;
  IF COALESCE(p_resubmit, false) AND v_status <> 'returned' THEN
    RAISE EXCEPTION 'ส่งใหม่ได้เฉพาะใบสั่งของที่ถูกตีกลับ';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'ไม่มีรายการที่จะแก้ไข'; END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_item := (v_line ->> 'id')::uuid;
      v_new  := COALESCE((v_line ->> 'qty_ordered')::numeric, 0);
      v_kq   := (v_line ->> 'remaining_kitchen_qty')::numeric;
      v_fq   := (v_line ->> 'remaining_freezer_qty')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'รายการไม่ถูกต้อง: จำนวนไม่ใช่ตัวเลข';
    END;
    IF v_new < 0 OR v_new > 1000000 OR COALESCE(v_kq, 0) < 0 OR COALESCE(v_fq, 0) < 0 THEN
      RAISE EXCEPTION 'จำนวนต้องเป็น 0 ขึ้นไป';
    END IF;
    SELECT qty_ordered INTO v_old FROM public.order_items WHERE id = v_item AND session_id = p_session FOR UPDATE;
    IF v_old IS NULL THEN RAISE EXCEPTION 'รายการ % ไม่ใช่ของใบสั่งของนี้', v_item; END IF;
    UPDATE public.order_items
       SET remaining_kitchen_qty  = (v_line ->> 'remaining_kitchen_qty')::numeric,
           remaining_kitchen_unit = NULLIF(v_line ->> 'remaining_kitchen_unit', ''),
           remaining_freezer_qty  = (v_line ->> 'remaining_freezer_qty')::numeric,
           remaining_freezer_unit = NULLIF(v_line ->> 'remaining_freezer_unit', ''),
           qty_ordered            = v_new,
           order_unit             = NULLIF(v_line ->> 'order_unit', '')
     WHERE id = v_item AND session_id = p_session;
    PERFORM public.order_log_change(p_session, v_item, 'qty_ordered', v_old, v_new, v_uid);
    v_n := v_n + 1;
  END LOOP;

  IF COALESCE(p_resubmit, false) THEN
    UPDATE public.order_sessions
       SET status = 'submitted', submitted_at = now(), version = version + 1
     WHERE id = p_session AND status = 'returned';
    IF NOT FOUND THEN RAISE EXCEPTION 'ส่งใหม่ไม่สำเร็จ: สถานะเปลี่ยนไปแล้ว'; END IF;
  ELSE
    PERFORM public.order_touch(p_session);
  END IF;
  RETURN v_n;
END
$fn$;

-- The head's quantity, while the order waits for review (decision 3). NULL
-- clears it (the creator's quantity stands again).
CREATE OR REPLACE FUNCTION public.order_set_head_qty(p_item uuid, p_qty numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_session uuid;
  v_status  text;
  v_old     numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน'; END IF;
  IF NOT COALESCE(public.is_order_head(), false) THEN RAISE EXCEPTION 'เฉพาะหัวหน้า (editor, admin, owner) เท่านั้นที่แก้จำนวนตอนตรวจได้'; END IF;
  IF p_qty IS NOT NULL AND (p_qty < 0 OR p_qty > 1000000) THEN RAISE EXCEPTION 'จำนวนต้องเป็น 0 ขึ้นไป'; END IF;
  SELECT i.session_id, s.status, i.reviewer_qty_ordered INTO v_session, v_status, v_old
    FROM public.order_items i JOIN public.order_sessions s ON s.id = i.session_id
   WHERE i.id = p_item FOR UPDATE OF i, s;
  IF v_session IS NULL THEN RAISE EXCEPTION 'ไม่พบรายการ'; END IF;
  IF v_status <> 'submitted' THEN
    RAISE EXCEPTION 'แก้จำนวนได้เฉพาะตอนรอตรวจสอบ: ใบสั่งของอยู่ในสถานะ %', v_status;
  END IF;
  UPDATE public.order_items SET reviewer_qty_ordered = p_qty WHERE id = p_item;
  PERFORM public.order_log_change(v_session, p_item, 'reviewer_qty_ordered', v_old, p_qty, v_uid);
  PERFORM public.order_touch(v_session);
END
$fn$;

-- Approve (decisions 2, 3, 4): any head, any order, own order included.
-- p_seen_version is the order's version as the head's screen read it; an
-- edit since then (by the creator, or a head's quantity) has counted it up,
-- and the approval is refused so the head reloads and approves what is
-- there now.
CREATE OR REPLACE FUNCTION public.order_approve(p_session uuid, p_seen_version int)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_status text;
  v_ver    int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน'; END IF;
  IF NOT COALESCE(public.is_order_head(), false) THEN RAISE EXCEPTION 'เฉพาะหัวหน้า (editor, admin, owner) เท่านั้นที่อนุมัติได้'; END IF;
  IF p_seen_version IS NULL THEN RAISE EXCEPTION 'หน้าจอไม่ได้ส่งรุ่นของใบสั่งของมา กรุณาโหลดหน้าใหม่'; END IF;
  SELECT status, version INTO v_status, v_ver FROM public.order_sessions WHERE id = p_session FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'ไม่พบใบสั่งของ'; END IF;
  IF v_status <> 'submitted' THEN RAISE EXCEPTION 'อนุมัติไม่ได้: ใบสั่งของอยู่ในสถานะ %', v_status; END IF;
  IF v_ver IS DISTINCT FROM p_seen_version THEN
    RAISE EXCEPTION 'ใบสั่งของถูกแก้ไขหลังจากเปิดหน้านี้ กรุณาโหลดใหม่แล้วอนุมัติอีกครั้ง';
  END IF;
  UPDATE public.order_sessions
     SET status = 'reviewed', reviewed_by = v_uid, reviewed_at = now(), version = version + 1
   WHERE id = p_session AND status = 'submitted';
  IF NOT FOUND THEN RAISE EXCEPTION 'อนุมัติไม่สำเร็จ: สถานะเปลี่ยนไปแล้ว'; END IF;
END
$fn$;

-- Return (decision 7): a head, until the order is marked sent. The head's
-- note has its own column; the staff note stays. An approval is undone.
CREATE OR REPLACE FUNCTION public.order_return(p_session uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_status text;
  v_line   record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน'; END IF;
  IF NOT COALESCE(public.is_order_head(), false) THEN RAISE EXCEPTION 'เฉพาะหัวหน้า (editor, admin, owner) เท่านั้นที่ตีกลับได้'; END IF;
  SELECT status INTO v_status FROM public.order_sessions WHERE id = p_session FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'ไม่พบใบสั่งของ'; END IF;
  IF v_status NOT IN ('submitted', 'reviewed') THEN RAISE EXCEPTION 'ตีกลับไม่ได้: ใบสั่งของอยู่ในสถานะ %', v_status; END IF;
  UPDATE public.order_sessions
     SET status = 'returned', return_note = NULLIF(p_note, ''), returned_by = v_uid, returned_at = now(),
         reviewed_by = NULL, reviewed_at = NULL, version = version + 1
   WHERE id = p_session AND status IN ('submitted', 'reviewed');
  IF NOT FOUND THEN RAISE EXCEPTION 'ตีกลับไม่สำเร็จ: สถานะเปลี่ยนไปแล้ว'; END IF;
  -- The head's quantities go with the return (each logged as the head's own
  -- act), so what the creator fixes is what the next head sees; a head
  -- quantity that survived would silently override the fix.
  FOR v_line IN SELECT id, reviewer_qty_ordered FROM public.order_items
                 WHERE session_id = p_session AND reviewer_qty_ordered IS NOT NULL LOOP
    UPDATE public.order_items SET reviewer_qty_ordered = NULL WHERE id = v_line.id;
    PERFORM public.order_log_change(p_session, v_line.id, 'reviewer_qty_ordered', v_line.reviewer_qty_ordered, NULL, v_uid);
  END LOOP;
END
$fn$;

-- Mark sent (decision 5): owner or admin, after approval.
CREATE OR REPLACE FUNCTION public.order_mark_sent(p_session uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน'; END IF;
  IF COALESCE(public.current_role(), '') NOT IN ('admin', 'owner') THEN RAISE EXCEPTION 'เฉพาะ admin หรือ owner เท่านั้นที่บันทึกว่าสั่งของแล้วได้'; END IF;
  SELECT status INTO v_status FROM public.order_sessions WHERE id = p_session FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'ไม่พบใบสั่งของ'; END IF;
  IF v_status <> 'reviewed' THEN RAISE EXCEPTION 'บันทึกว่าสั่งแล้วไม่ได้: ใบสั่งของอยู่ในสถานะ %', v_status; END IF;
  UPDATE public.order_sessions
     SET status = 'sent', sent_by = v_uid, sent_at = now(), version = version + 1
   WHERE id = p_session AND status = 'reviewed';
  IF NOT FOUND THEN RAISE EXCEPTION 'บันทึกไม่สำเร็จ: สถานะเปลี่ยนไปแล้ว'; END IF;
END
$fn$;

-- Receive (decision 8): anyone who may order, one line at a time. qty NULL
-- means "ยังไม่มา" (the line is open again); 0 means nothing came. Who and
-- when are stored on the line. When every line has a quantity the order
-- closes itself; that is the ONLY way an order becomes 'received'.
CREATE OR REPLACE FUNCTION public.receive_order_item(item_id uuid, qty numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid     uuid := auth.uid();
  v_session uuid;
  v_status  text;
  v_old     numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้อง login ก่อนบันทึกรับของ'; END IF;
  IF NOT COALESCE(public.can_order(), false) THEN RAISE EXCEPTION 'สิทธิ์นี้บันทึกรับของไม่ได้'; END IF;
  IF qty IS NOT NULL AND (qty < 0 OR qty > 1000000) THEN RAISE EXCEPTION 'จำนวนรับต้องเป็น 0 ขึ้นไป'; END IF;
  SELECT i.session_id, s.status, i.qty_received INTO v_session, v_status, v_old
    FROM public.order_items i JOIN public.order_sessions s ON s.id = i.session_id
   WHERE i.id = item_id FOR UPDATE OF i, s;
  IF v_session IS NULL THEN RAISE EXCEPTION 'ไม่พบรายการ id=%', item_id; END IF;
  IF v_status <> 'sent' THEN
    RAISE EXCEPTION 'บันทึกรับของได้เฉพาะใบที่สั่งแล้ว: ใบสั่งของอยู่ในสถานะ %', v_status;
  END IF;
  UPDATE public.order_items
     SET qty_received = qty,
         received_by  = CASE WHEN qty IS NULL THEN NULL ELSE v_uid END,
         received_at  = CASE WHEN qty IS NULL THEN NULL ELSE now() END
   WHERE id = item_id;
  PERFORM public.order_log_change(v_session, item_id, 'qty_received', v_old, qty, v_uid);
  IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE session_id = v_session AND qty_received IS NULL) THEN
    UPDATE public.order_sessions
       SET status = 'received', received_at = now(), version = version + 1
     WHERE id = v_session AND status = 'sent';
  END IF;
END
$fn$;

-- Cancel (decision 10), instead of delete: the creator while it waits for
-- review; a head before it is sent; owner and admin after it is sent too.
CREATE OR REPLACE FUNCTION public.order_cancel(p_session uuid, p_note text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_role   text := COALESCE(public.current_role(), '');
  v_status text;
  v_by     uuid;
  v_may    boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน'; END IF;
  IF NOT COALESCE(public.can_order(), false) THEN RAISE EXCEPTION 'สิทธิ์นี้สั่งของไม่ได้'; END IF;
  SELECT status, created_by INTO v_status, v_by FROM public.order_sessions WHERE id = p_session FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'ไม่พบใบสั่งของ'; END IF;
  IF v_status IN ('received', 'cancelled') THEN RAISE EXCEPTION 'ยกเลิกไม่ได้: ใบสั่งของอยู่ในสถานะ %', v_status; END IF;
  v_may := (v_by = v_uid AND v_status = 'submitted')
        OR (COALESCE(public.is_order_head(), false) AND v_status IN ('submitted', 'returned', 'reviewed'))
        OR (v_role IN ('admin', 'owner') AND v_status = 'sent');
  IF NOT v_may THEN
    RAISE EXCEPTION 'ยกเลิกไม่ได้: % ยกเลิกใบสั่งของในสถานะ % ไม่ได้', v_role, v_status;
  END IF;
  UPDATE public.order_sessions
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_note = NULLIF(p_note, ''),
         version = version + 1
   WHERE id = p_session AND status = v_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'ยกเลิกไม่สำเร็จ: สถานะเปลี่ยนไปแล้ว'; END IF;
END
$fn$;

-- PUBLIC holds an implicit EXECUTE on every new function; revoking from
-- anon alone would leave it. So: from PUBLIC, then back to authenticated.
REVOKE EXECUTE ON FUNCTION public.is_order_head(), public.can_order(),
  public.order_create(uuid, text, jsonb), public.order_edit(uuid, jsonb, boolean),
  public.order_set_head_qty(uuid, numeric), public.order_approve(uuid, int),
  public.order_return(uuid, text), public.order_mark_sent(uuid),
  public.receive_order_item(uuid, numeric), public.order_cancel(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_order_head(), public.can_order(),
  public.order_create(uuid, text, jsonb), public.order_edit(uuid, jsonb, boolean),
  public.order_set_head_qty(uuid, numeric), public.order_approve(uuid, int),
  public.order_return(uuid, text), public.order_mark_sent(uuid),
  public.receive_order_item(uuid, numeric), public.order_cancel(uuid, text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.order_log_change(uuid, uuid, text, numeric, numeric, uuid), public.order_touch(uuid)
  FROM PUBLIC, anon, authenticated;

-- ── Step 1f: direct writes closed for every app role ───────────────────────
-- The eight permissive write policies go; a RESTRICTIVE deny is AND-ed with
-- any permissive policy the live database might still hold, so nothing can
-- reopen a write by accident; and the privileges themselves are revoked.
-- The functions run as the file's owner and are not affected. Reads stay:
-- any signed-in account, as before.

DROP POLICY IF EXISTS order_sessions_insert          ON public.order_sessions;
DROP POLICY IF EXISTS order_sessions_update_editor   ON public.order_sessions;
DROP POLICY IF EXISTS order_sessions_update_resubmit ON public.order_sessions;
DROP POLICY IF EXISTS order_sessions_update_receive  ON public.order_sessions;
DROP POLICY IF EXISTS order_sessions_delete          ON public.order_sessions;
DROP POLICY IF EXISTS order_items_insert             ON public.order_items;
DROP POLICY IF EXISTS order_items_update_editor      ON public.order_items;
DROP POLICY IF EXISTS order_items_delete             ON public.order_items;

DROP POLICY IF EXISTS order_sessions_no_direct_write     ON public.order_sessions;
DROP POLICY IF EXISTS order_items_no_direct_write        ON public.order_items;
DROP POLICY IF EXISTS order_item_changes_no_direct_write ON public.order_item_changes;
-- One per command: a FOR ALL policy would also refuse SELECT.
DROP POLICY IF EXISTS order_sessions_no_direct_update     ON public.order_sessions;
DROP POLICY IF EXISTS order_sessions_no_direct_delete     ON public.order_sessions;
DROP POLICY IF EXISTS order_items_no_direct_update        ON public.order_items;
DROP POLICY IF EXISTS order_items_no_direct_delete        ON public.order_items;
DROP POLICY IF EXISTS order_item_changes_no_direct_update ON public.order_item_changes;
DROP POLICY IF EXISTS order_item_changes_no_direct_delete ON public.order_item_changes;
CREATE POLICY order_sessions_no_direct_write  ON public.order_sessions AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY order_sessions_no_direct_update ON public.order_sessions AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY order_sessions_no_direct_delete ON public.order_sessions AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);
CREATE POLICY order_items_no_direct_write  ON public.order_items AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY order_items_no_direct_update ON public.order_items AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY order_items_no_direct_delete ON public.order_items AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);
CREATE POLICY order_item_changes_no_direct_write  ON public.order_item_changes AS RESTRICTIVE FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY order_item_changes_no_direct_update ON public.order_item_changes AS RESTRICTIVE FOR UPDATE TO authenticated, anon USING (false);
CREATE POLICY order_item_changes_no_direct_delete ON public.order_item_changes AS RESTRICTIVE FOR DELETE TO authenticated, anon USING (false);

REVOKE INSERT, UPDATE, DELETE ON public.order_sessions, public.order_items, public.order_item_changes
  FROM anon, authenticated;
GRANT SELECT ON public.order_item_changes TO authenticated;

DO $do$
DECLARE
  v_txt text;
  v_fk  text;
BEGIN
  SELECT string_agg(tablename || '.' || policyname || ' (' || cmd || CASE WHEN permissive = 'PERMISSIVE' THEN '' ELSE ', restrictive' END || ')', ', ' ORDER BY tablename, policyname)
    INTO v_txt
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename IN ('order_sessions', 'order_items', 'order_item_changes') AND cmd <> 'SELECT';
  PERFORM pg_temp.note('after   write policies on the order tables: ' || COALESCE(v_txt, 'none'));
  SELECT string_agg(a.attname || ':' || CASE c.confdeltype WHEN 'n' THEN 'set null' WHEN 'r' THEN 'restrict' ELSE c.confdeltype::text END, ', ' ORDER BY a.attname)
    INTO v_fk
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
   WHERE c.conrelid = 'public.order_sessions'::regclass AND c.contype = 'f'
     AND c.confrelid = 'public.profiles'::regclass;
  PERFORM pg_temp.note(format('after   order_sessions -> profiles: %s; templates policies dropped: %s (a re-run says 0)',
    COALESCE(v_fk, 'none'), current_setting('orders.tpl_dropped')));
END
$do$;

-- ── Step 2: the trial's open orders are closed (decision 13) ───────────────
-- 5 submitted, 5 reviewed, 12 sent, none touched since 2026-08-04: ยกเลิก,
-- with a note saying why, no cancelled_by (the system did it), nothing
-- deleted. The counts are asserted first, on a first run; a re-run finds
-- them already cancelled and changes nothing.

DO $do$
DECLARE
  v_sub  bigint;
  v_ret  bigint;
  v_rev  bigint;
  v_sent bigint;
  v_n    bigint;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'submitted'), count(*) FILTER (WHERE status = 'returned'),
         count(*) FILTER (WHERE status = 'reviewed'),  count(*) FILTER (WHERE status = 'sent')
    INTO v_sub, v_ret, v_rev, v_sent
    FROM public.order_sessions;
  IF v_sub + v_ret + v_rev + v_sent = 0 THEN
    PERFORM pg_temp.note(format('skip    Step 2: no open order (a re-run); cancelled already %s',
      (SELECT count(*) FROM public.order_sessions WHERE status = 'cancelled')));
  ELSE
    IF v_sub <> 5 OR v_ret <> 0 OR v_rev <> 5 OR v_sent <> 12 THEN
      RAISE EXCEPTION 'FAIL    Step 2: the open orders are not the 22 read on 2026-09-23 (submitted 5, returned 0, reviewed 5, sent 12) but submitted %, returned %, reviewed %, sent %. Nothing applied.',
        v_sub, v_ret, v_rev, v_sent;
    END IF;
    IF EXISTS (SELECT 1 FROM public.order_sessions WHERE status IN ('submitted', 'reviewed', 'sent') AND created_at >= '2026-08-05') THEN
      RAISE EXCEPTION 'FAIL    Step 2: an open order was created after 2026-08-04, so it is not one of the trial''s. Nothing applied.';
    END IF;
    UPDATE public.order_sessions
       SET status = 'cancelled', cancelled_at = now(),
           cancel_note = 'ปิดโดยระบบก่อนเริ่มใช้ขั้นตอนอนุมัติใหม่ (23/9/2569)'
     WHERE status IN ('submitted', 'reviewed', 'sent') AND created_at < '2026-08-05';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 22 THEN
      RAISE EXCEPTION 'FAIL    Step 2 cancelled % orders, expected 22. Nothing applied.', v_n;
    END IF;
    PERFORM pg_temp.note(format('ok      Step 2: %s open trial orders (5 submitted, 5 reviewed, 12 sent) are ยกเลิก with the note; received orders untouched: %s',
      v_n, (SELECT count(*) FROM public.order_sessions WHERE status = 'received')));
  END IF;
END
$do$;

-- ── Step 3: tests, as real accounts, every write rolled back ───────────────
-- One block that ends by raising a private SQLSTATE; the results are carried
-- out by a VARIABLE (v_log). Tests marked keep build on each other's writes;
-- the rest roll back at once.

DO $do$
DECLARE
  owner_  uuid := current_setting('orders.owner')::uuid;
  admin_  uuid := current_setting('orders.admin')::uuid;
  editor_ uuid := current_setting('orders.editor')::uuid;
  staff_  uuid := current_setting('orders.staff')::uuid;
  hr_     uuid := current_setting('orders.hr')::uuid;
  sales_  uuid := current_setting('orders.sales')::uuid;
  v_o1    uuid;   -- staff's order: the whole flow
  v_o2    uuid;   -- staff's order: cancelled by its creator
  v_o3    uuid;   -- staff's order: approved, then cancelled by a head
  v_o4    uuid;   -- the editor's own order: self-approved, sent, cancelled by admin
  v_l1    uuid;   -- o1's first line
  v_l2    uuid;   -- o1's second line
  v_ver   int;
  v_txt   text;
  v_n     bigint;
  v_log   text;
BEGIN
  BEGIN
    -- ── Creating ──
    PERFORM pg_temp.t('C1 hr creates an order', hr_, 'hr',
      format($q$SELECT public.order_create(NULL, 'probe', %L::jsonb)$q$, pg_temp.lines(3, 2)), ARRAY['refused']);
    PERFORM pg_temp.note('        (C1 read: ' || current_setting('orders.last_refusal', true) || ')');
    -- A login with no profile row: current_role() is NULL, and a NULL gate
    -- must refuse, not pass (the review's finding 3).
    PERFORM pg_temp.t('C1b a login with no profile creates an order', gen_random_uuid(), 'no-profile',
      format($q$SELECT public.order_create(NULL, 'probe', %L::jsonb)$q$, pg_temp.lines(3, 2)), ARRAY['refused']);
    PERFORM pg_temp.t('C2 sales creates an order', sales_, 'sales',
      format($q$SELECT public.order_create(NULL, 'probe', %L::jsonb)$q$, pg_temp.lines(3, 2)), ARRAY['refused']);
    PERFORM pg_temp.t('C3 staff inserts an order row directly', staff_, 'staff',
      format($q$INSERT INTO public.order_sessions (created_by) VALUES (%L)$q$, staff_), ARRAY['denied']);
    PERFORM pg_temp.t('C4 staff creates an order with no useful line (both quantities 0, nothing left)', staff_, 'staff',
      $q$SELECT public.order_create(NULL, 'probe', '[{"ingredient_name":"x","qty_ordered":0}]'::jsonb)$q$, ARRAY['refused']);
    PERFORM pg_temp.t('C5 staff creates an order of two lines (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o1', public.order_create(NULL, 'probe-note', %L::jsonb)::text, true)$q$, pg_temp.lines(3, 2)),
      ARRAY['rows=1'], NULL, true);
    v_o1 := current_setting('orders.o1', true)::uuid;
    SELECT id INTO v_l1 FROM public.order_items WHERE session_id = v_o1 AND sort_order = 0;
    SELECT id INTO v_l2 FROM public.order_items WHERE session_id = v_o1 AND sort_order = 1;
    IF v_l1 IS NULL OR v_l2 IS NULL
       OR (SELECT created_by FROM public.order_sessions WHERE id = v_o1) IS DISTINCT FROM staff_
       OR (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'submitted'
       OR (SELECT version FROM public.order_sessions WHERE id = v_o1) <> 0 THEN
      RAISE EXCEPTION 'FAIL    C5 the order was not created as expected. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      C5 read back: created by staff, submitted, version 0, two lines (3 โล, 2 ถุง)');
    PERFORM pg_temp.t('C6 editor inserts a line into that order directly', editor_, 'editor',
      format($q$INSERT INTO public.order_items (session_id, ingredient_name) VALUES (%L, 'x')$q$, v_o1), ARRAY['denied']);
    PERFORM pg_temp.t('C7 editor deletes that order directly', editor_, 'editor',
      format($q$DELETE FROM public.order_sessions WHERE id = %L$q$, v_o1), ARRAY['denied', 'rows=0']);
    PERFORM pg_temp.t('C8 owner deletes a line directly', owner_, 'owner',
      format($q$DELETE FROM public.order_items WHERE id = %L$q$, v_l1), ARRAY['denied', 'rows=0']);

    -- ── The creator's edits, while it waits ──
    PERFORM pg_temp.t('E1 editor edits the staff order''s lines (not the creator)', editor_, 'editor',
      format($q$SELECT public.order_edit(%L, %L::jsonb)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', v_l1, 'qty_ordered', 5, 'order_unit', 'โล'))), ARRAY['refused']);
    PERFORM pg_temp.t('E2 staff edits the first line 3 -> 5 while it waits (kept)', staff_, 'staff',
      format($q$SELECT public.order_edit(%L, %L::jsonb)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', v_l1, 'qty_ordered', 5, 'order_unit', 'โล', 'remaining_kitchen_qty', 1, 'remaining_kitchen_unit', 'โล'))),
      ARRAY['rows=1'], NULL, true);
    IF (SELECT qty_ordered FROM public.order_items WHERE id = v_l1) <> 5
       OR (SELECT version FROM public.order_sessions WHERE id = v_o1) <> 1
       OR (SELECT count(*) FROM public.order_item_changes WHERE item_id = v_l1 AND field = 'qty_ordered'
            AND old_value = 3 AND new_value = 5 AND changed_by = staff_) <> 1 THEN
      RAISE EXCEPTION 'FAIL    E2 the line, the version or the change log does not read as expected. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      E2 read back: the line is 5, the version is 1, and the log holds one row (qty_ordered 3 -> 5, by staff)');
    PERFORM pg_temp.t('E3 staff resubmits an order that was not returned', staff_, 'staff',
      format($q$SELECT public.order_edit(%L, '[]'::jsonb, true)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('E4 staff edits a line of ANOTHER order under this order''s id', staff_, 'staff',
      format($q$SELECT public.order_edit(%L, %L::jsonb)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', (SELECT id FROM public.order_items WHERE session_id <> v_o1 LIMIT 1), 'qty_ordered', 9))),
      ARRAY['refused']);
    PERFORM pg_temp.t('E4b staff edits a line with a negative stock figure', staff_, 'staff',
      format($q$SELECT public.order_edit(%L, %L::jsonb)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', v_l1, 'qty_ordered', 5, 'remaining_kitchen_qty', -5))), ARRAY['refused']);
    PERFORM pg_temp.t('E5 staff updates a line directly', staff_, 'staff',
      format($q$UPDATE public.order_items SET qty_ordered = 99 WHERE id = %L$q$, v_l1), ARRAY['denied', 'rows=0']);

    -- ── The head's quantity ──
    PERFORM pg_temp.t('H1 staff sets the head quantity', staff_, 'staff',
      format($q$SELECT public.order_set_head_qty(%L, 4)$q$, v_l1), ARRAY['refused']);
    PERFORM pg_temp.t('H2 hr sets the head quantity', hr_, 'hr',
      format($q$SELECT public.order_set_head_qty(%L, 4)$q$, v_l1), ARRAY['refused']);
    PERFORM pg_temp.t('H3 editor sets the head quantity to 4 while it waits (kept)', editor_, 'editor',
      format($q$SELECT public.order_set_head_qty(%L, 4)$q$, v_l1), ARRAY['rows=1'], NULL, true);
    IF (SELECT reviewer_qty_ordered FROM public.order_items WHERE id = v_l1) <> 4
       OR (SELECT version FROM public.order_sessions WHERE id = v_o1) <> 2
       OR (SELECT count(*) FROM public.order_item_changes WHERE item_id = v_l1 AND field = 'reviewer_qty_ordered'
            AND old_value IS NULL AND new_value = 4 AND changed_by = editor_) <> 1 THEN
      RAISE EXCEPTION 'FAIL    H3 the head quantity, the version or the change log does not read as expected. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      H3 read back: head quantity 4, version 2, one log row (reviewer_qty_ordered null -> 4, by editor)');

    -- ── Approval ──
    PERFORM pg_temp.t('A1 staff approves', staff_, 'staff',
      format($q$SELECT public.order_approve(%L, 2)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('A2 editor approves with the version it read BEFORE the head quantity (1)', editor_, 'editor',
      format($q$SELECT public.order_approve(%L, 1)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.note('        (A2 read: ' || current_setting('orders.last_refusal', true) || ')');
    PERFORM pg_temp.t('A2b a login with no profile approves', gen_random_uuid(), 'no-profile',
      format($q$SELECT public.order_approve(%L, 2)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('A3 editor approves with no version', editor_, 'editor',
      format($q$SELECT public.order_approve(%L, NULL)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('A4 editor approves with the current version (kept)', editor_, 'editor',
      format($q$SELECT public.order_approve(%L, 2)$q$, v_o1), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'reviewed'
       OR (SELECT reviewed_by FROM public.order_sessions WHERE id = v_o1) IS DISTINCT FROM editor_
       OR (SELECT version FROM public.order_sessions WHERE id = v_o1) <> 3 THEN
      RAISE EXCEPTION 'FAIL    A4 the order is not reviewed by the editor at version 3. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      A4 read back: reviewed by the editor, version 3');
    PERFORM pg_temp.t('A5 editor approves it again', editor_, 'editor',
      format($q$SELECT public.order_approve(%L, 3)$q$, v_o1), ARRAY['refused']);

    -- ── Locked after approval ──
    PERFORM pg_temp.t('L1 staff (the creator) edits a line after approval', staff_, 'staff',
      format($q$SELECT public.order_edit(%L, %L::jsonb)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', v_l1, 'qty_ordered', 6))), ARRAY['refused']);
    PERFORM pg_temp.note('        (L1 read: ' || current_setting('orders.last_refusal', true) || ')');
    PERFORM pg_temp.t('L2 editor changes the head quantity after approval', editor_, 'editor',
      format($q$SELECT public.order_set_head_qty(%L, 7)$q$, v_l1), ARRAY['refused']);
    PERFORM pg_temp.t('L3 editor marks it sent directly', editor_, 'editor',
      format($q$UPDATE public.order_sessions SET status = 'sent' WHERE id = %L$q$, v_o1), ARRAY['denied', 'rows=0']);

    -- ── Return, and back ──
    PERFORM pg_temp.t('R1 staff returns', staff_, 'staff',
      format($q$SELECT public.order_return(%L, 'x')$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('R2 editor returns the reviewed order with a note (kept)', editor_, 'editor',
      format($q$SELECT public.order_return(%L, 'probe-return')$q$, v_o1), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'returned'
       OR (SELECT return_note FROM public.order_sessions WHERE id = v_o1) <> 'probe-return'
       OR (SELECT note FROM public.order_sessions WHERE id = v_o1) <> 'probe-note'
       OR (SELECT returned_by FROM public.order_sessions WHERE id = v_o1) IS DISTINCT FROM editor_
       OR (SELECT reviewed_by FROM public.order_sessions WHERE id = v_o1) IS NOT NULL
       OR (SELECT reviewer_qty_ordered FROM public.order_items WHERE id = v_l1) IS NOT NULL
       OR (SELECT count(*) FROM public.order_item_changes WHERE item_id = v_l1 AND field = 'reviewer_qty_ordered'
            AND old_value = 4 AND new_value IS NULL AND changed_by = editor_) <> 1 THEN
      RAISE EXCEPTION 'FAIL    R2 the return did not keep both notes, clear the approval, or clear and log the head quantity. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      R2 read back: returned by the editor, the head''s note beside the staff note (both kept), the approval cleared, the head quantity cleared and logged (4 -> null)');
    PERFORM pg_temp.t('R3 staff fixes the line and resubmits (kept)', staff_, 'staff',
      format($q$SELECT public.order_edit(%L, %L::jsonb, true)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', v_l1, 'qty_ordered', 5, 'order_unit', 'โล'))),
      ARRAY['rows=1'], NULL, true);
    SELECT version INTO v_ver FROM public.order_sessions WHERE id = v_o1;
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'submitted' THEN
      RAISE EXCEPTION 'FAIL    R3 the order did not go back to waiting. Nothing applied.';
    END IF;
    PERFORM pg_temp.t('R4 admin approves the resubmitted order at its current version (kept)', admin_, 'admin',
      format($q$SELECT public.order_approve(%L, %s)$q$, v_o1, v_ver), ARRAY['rows=1'], NULL, true);

    -- ── Sending ──
    PERFORM pg_temp.t('S1 editor marks it sent', editor_, 'editor',
      format($q$SELECT public.order_mark_sent(%L)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('S2 admin marks it sent (kept)', admin_, 'admin',
      format($q$SELECT public.order_mark_sent(%L)$q$, v_o1), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'sent'
       OR (SELECT sent_by FROM public.order_sessions WHERE id = v_o1) IS DISTINCT FROM admin_ THEN
      RAISE EXCEPTION 'FAIL    S2 the order is not sent by the admin. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      S2 read back: sent by the admin');
    PERFORM pg_temp.t('S3 admin marks it sent again', admin_, 'admin',
      format($q$SELECT public.order_mark_sent(%L)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('S4 editor returns an order that was sent', editor_, 'editor',
      format($q$SELECT public.order_return(%L, 'x')$q$, v_o1), ARRAY['refused']);

    -- ── Receiving ──
    PERFORM pg_temp.t('V1 hr receives a line', hr_, 'hr',
      format($q$SELECT public.receive_order_item(%L, 4)$q$, v_l1), ARRAY['refused']);
    PERFORM pg_temp.t('V2 sales receives a line', sales_, 'sales',
      format($q$SELECT public.receive_order_item(%L, 4)$q$, v_l1), ARRAY['refused']);
    PERFORM pg_temp.t('V3 staff marks the order received directly, skipping the lines', staff_, 'staff',
      format($q$UPDATE public.order_sessions SET status = 'received' WHERE id = %L$q$, v_o1), ARRAY['denied', 'rows=0']);
    PERFORM pg_temp.t('V4 staff receives the first line, 4 of the 5 ordered (kept)', staff_, 'staff',
      format($q$SELECT public.receive_order_item(%L, 4)$q$, v_l1), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'sent'
       OR (SELECT received_by FROM public.order_items WHERE id = v_l1) IS DISTINCT FROM staff_
       OR (SELECT received_at FROM public.order_items WHERE id = v_l1) IS NULL
       OR (SELECT count(*) FROM public.order_item_changes WHERE item_id = v_l1 AND field = 'qty_received' AND new_value = 4) <> 1 THEN
      RAISE EXCEPTION 'FAIL    V4 the line is not received by staff with the order still open. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      V4 read back: the line says who received it and when, the order is still sent, the log has the shortfall (null -> 4)');
    PERFORM pg_temp.t('V5 owner receives the second line, closing the order (kept)', owner_, 'owner',
      format($q$SELECT public.receive_order_item(%L, 2)$q$, v_l2), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'received'
       OR (SELECT received_at FROM public.order_sessions WHERE id = v_o1) IS NULL THEN
      RAISE EXCEPTION 'FAIL    V5 the order did not close itself when its last line was received. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      V5 read back: every line received, so the order is received');
    PERFORM pg_temp.t('V6 staff receives a line of a received order', staff_, 'staff',
      format($q$SELECT public.receive_order_item(%L, 5)$q$, v_l1), ARRAY['refused']);
    PERFORM pg_temp.t('V7 admin cancels a received order', admin_, 'admin',
      format($q$SELECT public.order_cancel(%L, 'x')$q$, v_o1), ARRAY['refused']);

    -- ── Cancelling ──
    PERFORM pg_temp.t('X1 staff creates a second order (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o2', public.order_create(NULL, 'probe-note', %L::jsonb)::text, true)$q$, pg_temp.lines(1, 1)),
      ARRAY['rows=1'], NULL, true);
    v_o2 := current_setting('orders.o2', true)::uuid;
    PERFORM pg_temp.t('X2 sales cancels it', sales_, 'sales',
      format($q$SELECT public.order_cancel(%L, 'x')$q$, v_o2), ARRAY['refused']);
    PERFORM pg_temp.t('X3 staff cancels its own waiting order (kept)', staff_, 'staff',
      format($q$SELECT public.order_cancel(%L, 'probe-cancel')$q$, v_o2), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o2) <> 'cancelled'
       OR (SELECT cancelled_by FROM public.order_sessions WHERE id = v_o2) IS DISTINCT FROM staff_
       OR (SELECT cancel_note FROM public.order_sessions WHERE id = v_o2) <> 'probe-cancel' THEN
      RAISE EXCEPTION 'FAIL    X3 the order is not cancelled by staff with the note. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      X3 read back: cancelled by staff, with who, when and the note');
    PERFORM pg_temp.t('X4 editor approves a cancelled order', editor_, 'editor',
      format($q$SELECT public.order_approve(%L, 0)$q$, v_o2), ARRAY['refused']);
    PERFORM pg_temp.t('X5 staff creates a third order (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o3', public.order_create(NULL, NULL, %L::jsonb)::text, true)$q$, pg_temp.lines(1, 1)),
      ARRAY['rows=1'], NULL, true);
    v_o3 := current_setting('orders.o3', true)::uuid;
    PERFORM pg_temp.t('X6 editor approves it (kept)', editor_, 'editor',
      format($q$SELECT public.order_approve(%L, 0)$q$, v_o3), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('X7 staff cancels its own order after approval', staff_, 'staff',
      format($q$SELECT public.order_cancel(%L, 'x')$q$, v_o3), ARRAY['refused']);
    PERFORM pg_temp.note('        (X7 read: ' || current_setting('orders.last_refusal', true) || ')');
    PERFORM pg_temp.t('X8 editor (a head) cancels the approved order (kept)', editor_, 'editor',
      format($q$SELECT public.order_cancel(%L, 'probe-cancel')$q$, v_o3), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('X9 editor creates an order of its own (kept)', editor_, 'editor',
      format($q$SELECT set_config('orders.o4', public.order_create(NULL, NULL, %L::jsonb)::text, true)$q$, pg_temp.lines(2, 0)),
      ARRAY['rows=1'], NULL, true);
    v_o4 := current_setting('orders.o4', true)::uuid;
    PERFORM pg_temp.t('X10 editor approves its own order (kept)', editor_, 'editor',
      format($q$SELECT public.order_approve(%L, 0)$q$, v_o4), ARRAY['rows=1'], NULL, true);
    IF (SELECT reviewed_by FROM public.order_sessions WHERE id = v_o4) IS DISTINCT FROM (SELECT created_by FROM public.order_sessions WHERE id = v_o4) THEN
      RAISE EXCEPTION 'FAIL    X10 the self-approval did not record the creator as the reviewer. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      X10 read back: reviewed_by = created_by, which the screen marks อนุมัติเอง');
    PERFORM pg_temp.t('X11 admin marks the editor''s order sent (kept)', admin_, 'admin',
      format($q$SELECT public.order_mark_sent(%L)$q$, v_o4), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('X12 editor cancels a sent order', editor_, 'editor',
      format($q$SELECT public.order_cancel(%L, 'x')$q$, v_o4), ARRAY['refused']);
    PERFORM pg_temp.t('X13 admin cancels the sent order (kept)', admin_, 'admin',
      format($q$SELECT public.order_cancel(%L, 'probe-cancel')$q$, v_o4), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('X14 staff receives a line of the cancelled order', staff_, 'staff',
      format($q$SELECT public.receive_order_item(%L, 1)$q$, (SELECT id FROM public.order_items WHERE session_id = v_o4 LIMIT 1)), ARRAY['refused']);

    -- ── Ordering by other roles, the change log, the account ──
    PERFORM pg_temp.t('O1 hr reads the orders (reads are unchanged)', hr_, 'hr',
      'SELECT id FROM public.order_sessions', ARRAY['rows=' || (current_setting('orders.n_sessions')::bigint + 4)]);
    PERFORM pg_temp.t('O2 staff writes the change log directly', staff_, 'staff',
      format($q$INSERT INTO public.order_item_changes (session_id, item_id, field, changed_by) VALUES (%L, %L, 'qty_ordered', %L)$q$, v_o1, v_l1, staff_),
      ARRAY['denied']);
    PERFORM pg_temp.t('O3 staff calls the private log helper', staff_, 'staff',
      format($q$SELECT public.order_log_change(%L, %L, 'qty_ordered', 1, 2, %L)$q$, v_o1, v_l1, staff_), ARRAY['denied', 'error 42501 permission denied for function order_log_change']);
    -- The staff account now has order history: deleting it must be refused
    -- by the foreign keys (decision 15). As the file's own role.
    BEGIN
      DELETE FROM public.profiles WHERE id = staff_;
      RAISE EXCEPTION 'FAIL    F1 a profile with order history was deleted. Nothing applied.';
    EXCEPTION
      WHEN foreign_key_violation OR restrict_violation THEN
        PERFORM pg_temp.note('ok      F1 deleting the staff account that created orders is refused by the foreign key (' || SQLERRM || ')');
    END;

    -- ── Templates ──
    PERFORM pg_temp.t('P1 staff inserts a template directly (the open policy is gone)', staff_, 'staff',
      $q$INSERT INTO public.templates (name) VALUES ('probe-template')$q$, ARRAY['denied']);
    PERFORM pg_temp.t('P2 editor inserts a template directly (the role-checked policy admits it)', editor_, 'editor',
      $q$INSERT INTO public.templates (name) VALUES ('probe-template')$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('P3 sales reads the templates', sales_, 'sales',
      'SELECT id FROM public.templates', ARRAY['rows=' || (SELECT count(*) FROM public.templates)]);

    -- The last thing before the abort: the results out of the setting and
    -- into memory, which the abort cannot reach.
    v_log := current_setting('orders.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('orders.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (four test orders, their lines, the change log, the returns, the receipts, the cancellations, the template)');
  END;
END
$do$;

-- ── Step 4: nothing the tests did survived them, and the file reported ─────

DO $do$
DECLARE
  v_rows     bigint;
  v_open     bigint := current_setting('orders.n_open')::bigint;
  -- Every row the file is supposed to emit, counted by hand and asserted
  -- below (the checker counts the sites): the harness's 2, Step 0's 8, Step
  -- 1's 2, Step 2's 1, Step 3's tests and read-backs and the rollback line,
  -- and this step's 2 lines before the count line. Change a test, change this.
  c_expected constant bigint := 93;
BEGIN
  IF (SELECT count(*) FROM public.order_sessions)::text <> current_setting('orders.n_sessions')
     OR (SELECT count(*) FROM public.order_items)::text <> current_setting('orders.n_items')
     OR (SELECT count(*) FROM public.order_sessions WHERE status = 'received')::text <> current_setting('orders.n_received')
     OR (SELECT count(*) FROM public.order_sessions WHERE status = 'cancelled') <> current_setting('orders.n_cancelled')::bigint + v_open
     OR (SELECT count(*) FROM public.order_sessions WHERE status IN ('submitted', 'returned', 'reviewed', 'sent')) <> 0
     OR (SELECT count(*) FROM public.order_item_changes) <> 0 THEN
    RAISE EXCEPTION 'FAIL    a row count changed: orders %, lines %, received %, cancelled %, open %, log rows %. Nothing applied.',
      (SELECT count(*) FROM public.order_sessions), (SELECT count(*) FROM public.order_items),
      (SELECT count(*) FROM public.order_sessions WHERE status = 'received'),
      (SELECT count(*) FROM public.order_sessions WHERE status = 'cancelled'),
      (SELECT count(*) FROM public.order_sessions WHERE status IN ('submitted', 'returned', 'reviewed', 'sent')),
      (SELECT count(*) FROM public.order_item_changes);
  END IF;
  IF EXISTS (SELECT 1 FROM public.order_sessions WHERE note = 'probe-note' OR cancel_note = 'probe-cancel' OR return_note = 'probe-return')
     OR EXISTS (SELECT 1 FROM public.order_items WHERE ingredient_name LIKE 'probe-item-%')
     OR EXISTS (SELECT 1 FROM public.templates WHERE name = 'probe-template') THEN
    RAISE EXCEPTION 'FAIL    a test order, line or template remains. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.conrelid = 'public.order_sessions'::regclass AND c.contype = 'f' AND c.confrelid = 'public.profiles'::regclass
        AND a.attname IN ('created_by', 'reviewed_by', 'sent_by', 'approved_by', 'returned_by', 'cancelled_by')
        AND c.confdeltype = 'r') <> 6 THEN
    RAISE EXCEPTION 'FAIL    not every account column of order_sessions is ON DELETE RESTRICT. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename IN ('order_sessions', 'order_items', 'order_item_changes')
                AND cmd <> 'SELECT' AND permissive = 'PERMISSIVE') THEN
    RAISE EXCEPTION 'FAIL    a permissive write policy remains on an order table. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('is_order_head', 'can_order', 'order_create', 'order_edit', 'order_set_head_qty',
                                                    'order_approve', 'order_return', 'order_mark_sent', 'receive_order_item',
                                                    'order_cancel', 'order_log_change', 'order_touch')) <> 12 THEN
    RAISE EXCEPTION 'FAIL    the twelve functions are not exactly one each by name: an older signature would stay callable. Nothing applied.';
  END IF;
  PERFORM pg_temp.note(format('ok      counts as before the tests (orders %s, lines %s, received %s, cancelled %s, none open, log empty); six account columns ON DELETE RESTRICT; no permissive write policy on the order tables; twelve functions, one each',
    current_setting('orders.n_sessions'), current_setting('orders.n_items'), current_setting('orders.n_received'),
    current_setting('orders.n_cancelled')::bigint + v_open));
  PERFORM pg_temp.note(format('ok      templates: %s open/duplicate policies dropped, policies now: %s',
    current_setting('orders.tpl_dropped'),
    (SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname) FROM pg_policies
      WHERE schemaname = 'public' AND tablename IN ('templates', 'template_items'))));

  -- The file checks that its own checks reported.
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
  pg_temp.lines(numeric, numeric),
  pg_temp.t(text, uuid, text, text, text[], text, boolean),
  pg_temp.classify(text, text),
  pg_temp.sql_target(text),
  pg_temp.probe(uuid, text, text, boolean),
  pg_temp.logged(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs — in the app, once the code that calls these is deployed ══
--
-- Until that deploy, the ordering screens fail on every write (the old code
-- writes the tables directly, which this file closes) and the order lists
-- show the 22 cancelled orders under ประวัติ. Nobody uses ordering yet.
--
-- 1. As a staff login: เช็คของ / สั่งของ, fill two lines, ส่งให้หัวหน้าตรวจ.
--    Open it: the lines can be edited and the order cancelled.
-- 2. As a head (editor): ตรวจสอบ shows it with a badge on สั่งของ. Change a
--    quantity, then ✓ อนุมัติ. Open the same order in a second tab first and
--    approve there after the change: refused, reload, approve again.
-- 3. As the creator: the lines are locked. As the head: ตีกลับ with a note;
--    the staff note is still shown beside it.
-- 4. As admin: บันทึกว่าสั่งของแล้ว; as staff: รับของ line by line; the order
--    closes on the last line and each line says who received it.
-- 5. As hr or sales: /staff/inventory/new is refused.
-- 6. On ผู้ใช้งาน/สิทธิ์: ลบบัญชี on the staff account offers ระงับการใช้งาน
--    instead.
