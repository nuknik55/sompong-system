-- ============================================================================
-- Supply orders: the two old head functions go, and a return needs a note
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. ONE
-- transaction: it records what is live, drops two functions, replaces one,
-- tests the result AS REAL ACCOUNTS with every test write rolled back,
-- counts its own result rows, and rolls the whole thing back if anything
-- disagrees. Safe to re-run: the drops are IF EXISTS and the one function is
-- CREATE OR REPLACE (a re-run says the two were already gone).
--
-- Needs supply_order_approval_migration.sql and
-- order_review_approve_migration.sql (both applied 2026-09-23): Step 0 stops
-- if order_return, order_review_approve or order_item_changes is missing.
--
-- WHY (README item 54, the follow-ups of the 2026-09-23 review). Since
-- 440fdcb the head approves WITH the quantities in one call,
-- order_review_approve. The two functions it replaced were still granted
-- to every signed-in account:
--   order_set_head_qty(item, qty) — a head quantity saved on its own, and
--   order_approve(session, version) — an approval with no quantities.
-- Called directly, they are the two-step approval Nik's rule forbids
-- (อนุมัติ ends in exactly one of two states). And a return with no note
-- was refused only by the screen and the server action; the database took
-- one from any direct call.
--
-- WHAT IT CHANGES
--   1. DROP FUNCTION order_approve(uuid, int) and
--      order_set_head_qty(uuid, numeric) — dropped, not revoked: nothing
--      calls them (the app since 440fdcb; Step 1 checks that no function
--      body and no scheduled job in this database names them, and the DROP
--      is RESTRICT, so a view or policy that uses one stops the file), a
--      revoked function can be granted back by accident, and a dropped one
--      cannot be called by any role, service role included.
--      The deadlock recorded in item 54 goes with it: order_set_head_qty
--      locked a LINE, then its ORDER; order_review_approve and order_edit
--      lock the order first. (order_approve locked only the order; it was
--      never half of that pair.)
--   2. order_return(session, note): refused, before any lock or write,
--      when the note is missing or holds nothing but spaces (ordinary,
--      tab, newline, no-break, ideographic, zero-width). Everything else is
--      as before: who may (a head), when (waiting or approved), the head's
--      quantities cleared and logged. EXECUTE from PUBLIC and anon revoked,
--      granted to authenticated, as before.
--   Nothing else changes. No app code waits for this file: the app already
--   refuses an empty note and no longer calls the two functions.
--
-- WHAT IT DOES NOT CHANGE: receive_order_item also locks the line before
-- the order. It refuses any order that is not 'sent', but only after taking
-- both locks, so a direct call (or a stale screen) on a line of an order
-- being approved, edited or returned can still deadlock with it: Postgres
-- aborts one side, nothing partial. Recorded in README item 54, not fixed
-- here.
--
-- AFTER THIS FILE: an app deployment older than 440fdcb cannot approve (it
-- calls order_approve), so do not roll Vercel back past 440fdcb. Re-running
-- supply_order_approval_migration.sql would bring both functions back and
-- the note-less order_return: run THIS file again after it.
-- order_review_approve_migration.sql cannot be re-run after this one (its
-- Step 0 requires the two functions, so it stops with nothing changed); it
-- never needs to be.
--
-- CHANGES NO DATA. Every test write happens inside a block that always
-- rolls back; Step 3 checks every count afterwards.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: DROP FUNCTION IF EXISTS ×2 in
-- public (order_approve, order_set_head_qty); CREATE OR REPLACE FUNCTION ×1
-- in public (order_return) and the pg_temp helpers; COMMENT ON FUNCTION ×1;
-- REVOKE EXECUTE (then GRANT) on order_return; after COMMIT, DROP FUNCTION
-- IF EXISTS on the pg_temp helpers; inside the always-aborting test block,
-- the order writes the tests make through the order functions and one
-- direct UPDATE expected to be refused — all rolled back. Anything else is
-- unexpected: stop and send it. Never "Run and enable RLS".
--
-- RUN IT WHILE NOBODY IS REVIEWING OR RETURNING AN ORDER.
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
BEGIN
  BEGIN
    PERFORM 'public.order_return(uuid, text)'::regprocedure;
    PERFORM 'public.order_review_approve(uuid, int, jsonb)'::regprocedure;
    PERFORM 'public.order_create(uuid, text, jsonb)'::regprocedure;
    PERFORM 'public.order_log_change(uuid, uuid, text, numeric, numeric, uuid)'::regprocedure;
    PERFORM 'public.is_order_head()'::regprocedure;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'the order functions are missing: supply_order_approval_migration.sql or order_review_approve_migration.sql has not run. Nothing changed.';
  END;
  IF to_regclass('public.order_item_changes') IS NULL THEN
    RAISE EXCEPTION 'order_item_changes is missing: supply_order_approval_migration.sql has not run. Nothing changed.';
  END IF;

  SELECT id INTO v_owner  FROM public.profiles WHERE role = 'owner'  ORDER BY id LIMIT 1;
  SELECT id INTO v_admin  FROM public.profiles WHERE role = 'admin'  ORDER BY id LIMIT 1;
  SELECT id INTO v_editor FROM public.profiles WHERE role = 'editor' ORDER BY id LIMIT 1;
  SELECT id INTO v_staff  FROM public.profiles WHERE role = 'staff'  ORDER BY id LIMIT 1;
  SELECT id INTO v_hr     FROM public.profiles WHERE role = 'hr'     ORDER BY id LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL OR v_editor IS NULL OR v_staff IS NULL OR v_hr IS NULL THEN
    RAISE EXCEPTION 'need an owner, admin, editor, staff and hr profile to test as. Nothing changed.';
  END IF;
  PERFORM set_config('orders.owner',  v_owner::text,  false);
  PERFORM set_config('orders.admin',  v_admin::text,  false);
  PERFORM set_config('orders.editor', v_editor::text, false);
  PERFORM set_config('orders.staff',  v_staff::text,  false);
  PERFORM set_config('orders.hr',     v_hr::text,     false);
  PERFORM set_config('orders.n_sessions', (SELECT count(*) FROM public.order_sessions)::text, false);
  PERFORM set_config('orders.n_items',    (SELECT count(*) FROM public.order_items)::text, false);
  PERFORM set_config('orders.n_changes',  (SELECT count(*) FROM public.order_item_changes)::text, false);
  PERFORM set_config('orders.fingerprint',
    (SELECT md5(COALESCE(string_agg(id::text || status || version::text || COALESCE(reviewed_by::text, '')
                                     || COALESCE(returned_by::text, '') || COALESCE(md5(return_note), ''), ',' ORDER BY id), ''))
       FROM public.order_sessions), false);
  PERFORM pg_temp.note(format('before  orders %s (%s), lines %s, change-log rows %s; order_approve exists: %s, order_set_head_qty exists: %s (a re-run says false, false)',
    current_setting('orders.n_sessions'),
    (SELECT string_agg(status || ' ' || n, ', ' ORDER BY status) FROM (SELECT status, count(*) AS n FROM public.order_sessions GROUP BY status) s),
    current_setting('orders.n_items'), current_setting('orders.n_changes'),
    to_regprocedure('public.order_approve(uuid, int)') IS NOT NULL,
    to_regprocedure('public.order_set_head_qty(uuid, numeric)') IS NOT NULL));
END
$do$;

-- ── Step 1a: nothing in this database calls the two old functions ──────────
-- A PL/pgSQL body records no dependency, so the DROP below cannot see one:
-- every function body is read instead. A scheduled job (pg_cron), if the
-- extension is there, is read too. A view, policy or default that uses one
-- DOES record a dependency, and the DROP (RESTRICT) stops the file on it.

DO $do$
DECLARE
  v_users text;
  v_jobs  text;
BEGIN
  SELECT string_agg(n.nspname || '.' || p.proname, ', ' ORDER BY n.nspname, p.proname) INTO v_users
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast%'
     AND p.proname NOT IN ('order_approve', 'order_set_head_qty')
     AND (p.prosrc ~ '(^|[^[:alnum:]_])order_approve[[:space:]]*[(]'
          OR p.prosrc ~ '(^|[^[:alnum:]_])order_set_head_qty[[:space:]]*[(]');
  IF v_users IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    these functions still call order_approve or order_set_head_qty: %. Nothing applied.', v_users;
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT string_agg(jobname, ', ') FROM cron.job WHERE command ~ 'order_approve|order_set_head_qty'$q$ INTO v_jobs;
    IF v_jobs IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL    these scheduled jobs call order_approve or order_set_head_qty: %. Nothing applied.', v_jobs;
    END IF;
  END IF;
  PERFORM pg_temp.note(format('ok      nothing calls the two old functions: no function body names them; scheduled jobs %s',
    CASE WHEN to_regclass('cron.job') IS NULL THEN 'n/a (no pg_cron)' ELSE 'none name them' END));
END
$do$;

-- ── Step 1b: the two old functions go ──────────────────────────────────────

DROP FUNCTION IF EXISTS public.order_approve(uuid, int), public.order_set_head_qty(uuid, numeric);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname IN ('order_approve', 'order_set_head_qty')) THEN
    RAISE EXCEPTION 'FAIL    a function named order_approve or order_set_head_qty is still there (another signature?). Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      order_approve and order_set_head_qty are gone, every signature');
END
$do$;

-- ── Step 1c: a return needs a note ─────────────────────────────────────────
-- As supply_order_approval_migration.sql wrote it, plus the note check
-- (before any lock). "Nothing but spaces" counts ordinary whitespace and
-- the no-break (160), zero-width (8203), ideographic (12288) and BOM
-- (65279) characters a phone keyboard can leave.

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
  IF p_note IS NULL
     OR regexp_replace(p_note, '[[:space:]' || chr(160) || chr(8203) || chr(12288) || chr(65279) || ']', '', 'g') = '' THEN
    RAISE EXCEPTION 'กรุณาระบุว่าต้องแก้อะไร ก่อนตีกลับ';
  END IF;
  SELECT status INTO v_status FROM public.order_sessions WHERE id = p_session FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'ไม่พบใบสั่งของ'; END IF;
  IF v_status NOT IN ('submitted', 'reviewed') THEN RAISE EXCEPTION 'ตีกลับไม่ได้: ใบสั่งของอยู่ในสถานะ %', v_status; END IF;
  UPDATE public.order_sessions
     SET status = 'returned', return_note = p_note, returned_by = v_uid, returned_at = now(),
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

COMMENT ON FUNCTION public.order_return(uuid, text) IS
  'A head returns a waiting or approved order to its creator WITH a note saying what to fix (refused without one, 2026-09-24); the head''s quantities are cleared and logged.';

REVOKE EXECUTE ON FUNCTION public.order_return(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_return(uuid, text) TO authenticated;

-- ── Step 2: tests, as real accounts, every write rolled back ───────────────

DO $do$
DECLARE
  owner_  uuid := current_setting('orders.owner')::uuid;
  admin_  uuid := current_setting('orders.admin')::uuid;
  editor_ uuid := current_setting('orders.editor')::uuid;
  staff_  uuid := current_setting('orders.staff')::uuid;
  hr_     uuid := current_setting('orders.hr')::uuid;
  v_o1 uuid; v_o2 uuid;
  v_a1 uuid;              -- o1's first line
  v_b1 uuid;              -- o2's first line
  v_blank text := chr(9) || chr(10) || ' ' || chr(160) || chr(12288) || chr(8203) || chr(65279);
  v_log text;
BEGIN
  BEGIN
    -- Two waiting orders by staff, kept for the tests below.
    PERFORM pg_temp.t('S1 staff places order 1 (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o1', public.order_create(NULL, 'probe-note', %L::jsonb)::text, true)$q$, pg_temp.lines(3, 2)),
      ARRAY['rows=1'], NULL, true);
    v_o1 := current_setting('orders.o1', true)::uuid;
    SELECT id INTO v_a1 FROM public.order_items WHERE session_id = v_o1 AND sort_order = 0;
    PERFORM pg_temp.t('S2 staff places order 2 (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o2', public.order_create(NULL, 'probe-note', %L::jsonb)::text, true)$q$, pg_temp.lines(3, 2)),
      ARRAY['rows=1'], NULL, true);
    v_o2 := current_setting('orders.o2', true)::uuid;
    SELECT id INTO v_b1 FROM public.order_items WHERE session_id = v_o2 AND sort_order = 0;

    -- ── The old functions cannot be called by anyone ──
    PERFORM pg_temp.t('G1 editor calls order_approve', editor_, 'editor',
      format($q$SELECT public.order_approve(%L, 0)$q$, v_o1), ARRAY['no-such-function']);
    PERFORM pg_temp.t('G2 admin calls order_set_head_qty', admin_, 'admin',
      format($q$SELECT public.order_set_head_qty(%L, 4)$q$, v_a1), ARRAY['no-such-function']);
    PERFORM pg_temp.t('G3 owner calls order_approve', owner_, 'owner',
      format($q$SELECT public.order_approve(%L, 0)$q$, v_o1), ARRAY['no-such-function']);

    -- ── A return without a note is refused, before anything is written ──
    PERFORM pg_temp.t('R1 editor returns order 1 with no note (NULL)', editor_, 'editor',
      format($q$SELECT public.order_return(%L, NULL)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.note('        (R1 read: ' || current_setting('orders.last_refusal', true) || ')');
    PERFORM pg_temp.t('R2 editor returns order 1 with an empty note', editor_, 'editor',
      format($q$SELECT public.order_return(%L, '')$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('R3 admin returns order 1 with a note of spaces', admin_, 'admin',
      format($q$SELECT public.order_return(%L, '    ')$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('R4 owner returns order 1 with tab, newline, no-break, ideographic, zero-width and BOM only', owner_, 'owner',
      format($q$SELECT public.order_return(%L, %L)$q$, v_o1, v_blank), ARRAY['refused']);
    -- Who may is unchanged: a note does not make a non-head a head.
    PERFORM pg_temp.t('R5 staff (the creator) returns its own order with a note', staff_, 'staff',
      format($q$SELECT public.order_return(%L, 'probe-return')$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('R6 hr returns order 1 with a note', hr_, 'hr',
      format($q$SELECT public.order_return(%L, 'probe-return')$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('R7 a login with no profile returns order 1 with a note', gen_random_uuid(), 'no-profile',
      format($q$SELECT public.order_return(%L, 'probe-return')$q$, v_o1), ARRAY['refused']);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'submitted'
       OR (SELECT version FROM public.order_sessions WHERE id = v_o1) <> 0
       OR (SELECT return_note FROM public.order_sessions WHERE id = v_o1) IS NOT NULL
       OR (SELECT returned_by FROM public.order_sessions WHERE id = v_o1) IS NOT NULL THEN
      RAISE EXCEPTION 'FAIL    R1–R7 left something behind on order 1. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      R read back: refused, state unchanged — after seven refusals order 1 is still waiting, version 0, no return note, no returner');

    -- ── A return with a note ──
    PERFORM pg_temp.t('R8 editor returns order 1 with a note (kept)', editor_, 'editor',
      format($q$SELECT public.order_return(%L, 'probe: ปลาเกินไป 1 ตัว')$q$, v_o1), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'returned'
       OR (SELECT version FROM public.order_sessions WHERE id = v_o1) <> 1
       OR (SELECT return_note FROM public.order_sessions WHERE id = v_o1) IS DISTINCT FROM 'probe: ปลาเกินไป 1 ตัว'
       OR (SELECT returned_by FROM public.order_sessions WHERE id = v_o1) IS DISTINCT FROM editor_ THEN
      RAISE EXCEPTION 'FAIL    R8 the return, its note or its returner do not read as expected. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      R8 read back: order 1 returned by the editor, version 1, the note stored as given');

    -- ── The approval the app uses still works without the old functions ──
    PERFORM pg_temp.t('A1 editor approves order 2 with order_review_approve, line 1 corrected 3 -> 5 (kept)', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o2, jsonb_build_array(jsonb_build_object('id', v_b1, 'qty', 5))),
      ARRAY['rows=1'], NULL, true);

    -- ── An approved order: the note rule holds there too ──
    PERFORM pg_temp.t('R9 admin returns the approved order 2 with an empty note', admin_, 'admin',
      format($q$SELECT public.order_return(%L, '')$q$, v_o2), ARRAY['refused']);
    PERFORM pg_temp.t('R10 admin returns the approved order 2 with a note (kept)', admin_, 'admin',
      format($q$SELECT public.order_return(%L, 'probe-return')$q$, v_o2), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o2) <> 'returned'
       OR (SELECT reviewed_by FROM public.order_sessions WHERE id = v_o2) IS NOT NULL
       OR (SELECT reviewer_qty_ordered FROM public.order_items WHERE id = v_b1) IS NOT NULL
       OR (SELECT count(*) FROM public.order_item_changes WHERE item_id = v_b1 AND field = 'reviewer_qty_ordered'
            AND old_value = 5 AND new_value IS NULL AND changed_by = admin_) <> 1 THEN
      RAISE EXCEPTION 'FAIL    R10 the approval was not undone, or the head quantity not cleared and logged. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      R10 read back: order 2 returned, its approval undone, the head quantity cleared and logged (5 -> null, by the admin)');

    -- ── Direct writes stay closed ──
    PERFORM pg_temp.t('D1 editor writes a return note by a direct UPDATE', editor_, 'editor',
      format($q$UPDATE public.order_sessions SET return_note = 'x' WHERE id = %L$q$, v_o2), ARRAY['denied', 'rows=0']);

    v_log := current_setting('orders.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('orders.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (two test orders, their lines, the approval, the returns, the log rows)');
  END;
END
$do$;

-- ── Step 3: nothing the tests did survived them, and the file reported ─────

DO $do$
DECLARE
  v_rows bigint;
  -- Every row the file is supposed to emit, counted by the checker's rule
  -- (a t() or a note() is one row). Change a test, change this.
  c_expected constant bigint := 28;
BEGIN
  IF (SELECT count(*) FROM public.order_sessions)::text <> current_setting('orders.n_sessions')
     OR (SELECT count(*) FROM public.order_items)::text <> current_setting('orders.n_items')
     OR (SELECT count(*) FROM public.order_item_changes)::text <> current_setting('orders.n_changes')
     OR (SELECT md5(COALESCE(string_agg(id::text || status || version::text || COALESCE(reviewed_by::text, '')
                                         || COALESCE(returned_by::text, '') || COALESCE(md5(return_note), ''), ',' ORDER BY id), ''))
           FROM public.order_sessions) <> current_setting('orders.fingerprint') THEN
    RAISE EXCEPTION 'FAIL    an order, a line, a log row or an order''s status, version, reviewer, returner or return note changed. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'order_return') <> 1 THEN
    RAISE EXCEPTION 'FAIL    there is not exactly one function named order_return. Nothing applied.';
  END IF;
  IF has_function_privilege('anon', 'public.order_return(uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.order_return(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL    order_return: anon may execute it, or authenticated may not. Nothing applied.';
  END IF;
  PERFORM pg_temp.note(format('ok      counts as before (orders %s, lines %s, log rows %s), every order''s status, version, reviewer, returner and return note byte for byte; one order_return, authenticated may execute it, anon may not',
    current_setting('orders.n_sessions'), current_setting('orders.n_items'), current_setting('orders.n_changes')));

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

-- ═══ After it runs — in the app ═══════════════════════════════════════════
--
-- 1. As a head: open a waiting order, ตีกลับ with a note: it goes back to
--    its creator with the note, as before.
-- 2. อนุมัติ on the review screen still works (it never used the two old
--    functions).
