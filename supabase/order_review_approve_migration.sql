-- ============================================================================
-- Supply orders: the head approves with the quantities, in ONE step
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. ONE
-- transaction: it records what is live, creates one function, tests it AS
-- REAL ACCOUNTS with every test write rolled back, counts its own result
-- rows, and rolls the whole thing back if anything disagrees. Safe to
-- re-run: the only change is CREATE OR REPLACE FUNCTION.
--
-- Needs supply_order_approval_migration.sql (applied 2026-09-23): Step 0
-- stops if its functions or order_item_changes are missing.
--
-- WHY (Nik, 2026-09-23). A head reviews an order the way he corrects the
-- paper sheet: the quantities are editable on the review screen, and
-- อนุมัติ saves the corrections WITH the approval. Until now the head's
-- quantities were saved one line at a time (order_set_head_qty, each its
-- own transaction, each moving the order's version) and approval was a
-- separate call: a failure between them left some quantities saved and the
-- order not approved. Nik's rule: อนุมัติ ends in exactly one of two states —
-- everything saved and approved, or nothing approved and the head told why.
--
-- WHAT IT CHANGES
--   order_review_approve(p_session uuid, p_seen_version int, p_lines jsonb)
--   p_lines: [{id, qty}], a line of THIS order and the quantity the head
--   approves for it (what the screen shows, pre-filled with what staff
--   ordered or the head's earlier figure). Lines not listed keep what they
--   have.
--   It refuses, BEFORE ANY WRITE: no login; a caller who is not a head
--   (is_order_head(), NULL-safe); p_seen_version missing; an order that does
--   not exist, is not waiting for review, or changed since the head opened
--   it (its version moved — a creator's edit, another head's quantity);
--   p_lines that is not an array; a line that is not an object with an id
--   and a number; an id that is not a line of this order; the same line
--   twice; a quantity below 0 or above 1,000,000.
--   Then, in the same transaction: each listed line's head quantity becomes
--   the quantity given — or NULL when it equals what staff ordered, so the
--   creator's figure stands — with one order_item_changes row per line whose
--   head quantity actually changed (who, old, new, when); and the order
--   becomes reviewed by the caller, its version counted up.
--   SECURITY DEFINER, search_path public, every relation qualified; EXECUTE
--   from PUBLIC and anon revoked, granted to authenticated.
--   order_approve and order_set_head_qty stay as they are (the app stops
--   calling them); nothing else changes.
--
-- CHANGES NO DATA. Every test write happens inside a block that always
-- rolls back; Step 3 checks every count afterwards.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: CREATE OR REPLACE FUNCTION ×1
-- in public and the pg_temp helpers; COMMENT ON FUNCTION ×1; REVOKE EXECUTE
-- (then GRANT) on the new function; after COMMIT, DROP FUNCTION IF EXISTS on
-- the pg_temp helpers; inside the always-aborting test block, the order
-- writes the tests make through the order functions and one direct UPDATE
-- expected to be refused — all rolled back. Anything else is unexpected:
-- stop and send it. Never "Run and enable RLS".
--
-- RUN IT WHILE NOBODY IS REVIEWING AN ORDER.
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
BEGIN
  BEGIN
    PERFORM 'public.order_approve(uuid, int)'::regprocedure;
    PERFORM 'public.order_set_head_qty(uuid, numeric)'::regprocedure;
    PERFORM 'public.order_create(uuid, text, jsonb)'::regprocedure;
    PERFORM 'public.order_edit(uuid, jsonb, boolean)'::regprocedure;
    PERFORM 'public.order_log_change(uuid, uuid, text, numeric, numeric, uuid)'::regprocedure;
    PERFORM 'public.is_order_head()'::regprocedure;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'the order functions are missing: supply_order_approval_migration.sql has not run. Nothing changed.';
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
    (SELECT md5(COALESCE(string_agg(id::text || status || version::text || COALESCE(reviewed_by::text, ''), ',' ORDER BY id), ''))
       FROM public.order_sessions), false);
  PERFORM pg_temp.note(format('before  orders %s (%s), lines %s, change-log rows %s; order_review_approve exists: %s (a re-run says true)',
    current_setting('orders.n_sessions'),
    (SELECT string_agg(status || ' ' || n, ', ' ORDER BY status) FROM (SELECT status, count(*) AS n FROM public.order_sessions GROUP BY status) s),
    current_setting('orders.n_items'), current_setting('orders.n_changes'),
    EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'order_review_approve')));
END
$do$;

-- ── Step 1: the one approval with the quantities ───────────────────────────

CREATE OR REPLACE FUNCTION public.order_review_approve(p_session uuid, p_seen_version int, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_status text;
  v_ver    int;
  v_line   jsonb;
  v_ids    uuid[] := ARRAY[]::uuid[];
  v_qtys   numeric[] := ARRAY[]::numeric[];
  v_id     uuid;
  v_qty    numeric;
  v_i      int;
  r        record;
  v_new    numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'ต้องเข้าสู่ระบบก่อน'; END IF;
  IF NOT COALESCE(public.is_order_head(), false) THEN
    RAISE EXCEPTION 'เฉพาะหัวหน้า (editor, admin, owner) เท่านั้นที่อนุมัติได้';
  END IF;
  IF p_seen_version IS NULL THEN RAISE EXCEPTION 'หน้าจอไม่ได้ส่งรุ่นของใบสั่งของมา กรุณาโหลดหน้าใหม่'; END IF;

  SELECT status, version INTO v_status, v_ver FROM public.order_sessions WHERE id = p_session FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'ไม่พบใบสั่งของ'; END IF;
  IF v_status <> 'submitted' THEN RAISE EXCEPTION 'อนุมัติไม่ได้: ใบสั่งของอยู่ในสถานะ %', v_status; END IF;
  IF v_ver IS DISTINCT FROM p_seen_version THEN
    RAISE EXCEPTION 'ใบสั่งของถูกแก้ไขหลังจากเปิดหน้านี้ กรุณาโหลดใหม่แล้วอนุมัติอีกครั้ง';
  END IF;

  -- Every line checked before anything is written.
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN RAISE EXCEPTION 'รายการจำนวนไม่ถูกต้อง'; END IF;
  v_i := 0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_line) <> 'object' THEN RAISE EXCEPTION 'บรรทัดที่ % ไม่ถูกต้อง', v_i; END IF;
    BEGIN
      v_id := (v_line ->> 'id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'บรรทัดที่ %: รหัสรายการไม่ถูกต้อง', v_i;
    END;
    -- A JSON number only (the screen sends numbers): no strings, no hex, no
    -- spaces. Rounded to the column's 4 decimals BEFORE it is compared, so
    -- 3.00001 on a line of 3 is 3 (no change), and 0.00001 is refused as 0
    -- only if the head typed 0.
    IF jsonb_typeof(v_line -> 'qty') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'บรรทัดที่ %: จำนวนไม่ใช่ตัวเลข', v_i;
    END IF;
    v_qty := round((v_line ->> 'qty')::numeric, 4);
    IF v_id IS NULL OR v_qty IS NULL THEN RAISE EXCEPTION 'บรรทัดที่ %: ไม่มีรายการหรือจำนวน', v_i; END IF;
    IF v_qty < 0 OR v_qty > 1000000 THEN RAISE EXCEPTION 'บรรทัดที่ %: จำนวนต้องเป็น 0 ขึ้นไป', v_i; END IF;
    IF v_id = ANY (v_ids) THEN RAISE EXCEPTION 'บรรทัดที่ %: รายการซ้ำ', v_i; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.order_items WHERE id = v_id AND session_id = p_session) THEN
      RAISE EXCEPTION 'บรรทัดที่ %: ไม่ใช่รายการของใบสั่งของนี้', v_i;
    END IF;
    v_ids  := v_ids || v_id;
    v_qtys := v_qtys || v_qty;
  END LOOP;

  -- The quantities, each change logged.
  FOR r IN SELECT i.id, i.qty_ordered, i.reviewer_qty_ordered, q.qty
             FROM unnest(v_ids, v_qtys) AS q(id, qty)
             JOIN public.order_items i ON i.id = q.id
            ORDER BY i.sort_order, i.id
              FOR UPDATE OF i LOOP
    v_new := CASE WHEN r.qty = r.qty_ordered THEN NULL ELSE r.qty END;
    IF v_new IS DISTINCT FROM r.reviewer_qty_ordered THEN
      UPDATE public.order_items SET reviewer_qty_ordered = v_new WHERE id = r.id;
      PERFORM public.order_log_change(p_session, r.id, 'reviewer_qty_ordered', r.reviewer_qty_ordered, v_new, v_uid);
    END IF;
  END LOOP;

  -- The approval, in the same transaction.
  UPDATE public.order_sessions
     SET status = 'reviewed', reviewed_by = v_uid, reviewed_at = now(), version = version + 1
   WHERE id = p_session AND status = 'submitted' AND version = p_seen_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'อนุมัติไม่สำเร็จ: ใบสั่งของเปลี่ยนไปแล้ว'; END IF;
END
$fn$;

COMMENT ON FUNCTION public.order_review_approve(uuid, int, jsonb) IS
  'A head approves a waiting order WITH its quantities, in one transaction: every line checked first, each head quantity that changes logged, then reviewed. Refuses a stale version. Nik, 2026-09-23.';

REVOKE EXECUTE ON FUNCTION public.order_review_approve(uuid, int, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_review_approve(uuid, int, jsonb) TO authenticated;

-- ── Step 2: tests, as real accounts, every write rolled back ───────────────

DO $do$
DECLARE
  owner_  uuid := current_setting('orders.owner')::uuid;
  admin_  uuid := current_setting('orders.admin')::uuid;
  editor_ uuid := current_setting('orders.editor')::uuid;
  staff_  uuid := current_setting('orders.staff')::uuid;
  hr_     uuid := current_setting('orders.hr')::uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid;
  v_a1 uuid; v_a2 uuid;   -- o1's lines (3 โล, 2 ถุง)
  v_b1 uuid;              -- o2's first line
  v_c1 uuid; v_c2 uuid;   -- o3's lines
  v_other uuid;           -- a line of another order
  v_log text;
BEGIN
  BEGIN
    -- Four waiting orders by staff, kept for the tests below.
    PERFORM pg_temp.t('S1 staff places order 1 (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o1', public.order_create(NULL, 'probe-note', %L::jsonb)::text, true)$q$, pg_temp.lines(3, 2)),
      ARRAY['rows=1'], NULL, true);
    v_o1 := current_setting('orders.o1', true)::uuid;
    SELECT id INTO v_a1 FROM public.order_items WHERE session_id = v_o1 AND sort_order = 0;
    SELECT id INTO v_a2 FROM public.order_items WHERE session_id = v_o1 AND sort_order = 1;
    PERFORM pg_temp.t('S2 staff places order 2 (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o2', public.order_create(NULL, 'probe-note', %L::jsonb)::text, true)$q$, pg_temp.lines(3, 2)),
      ARRAY['rows=1'], NULL, true);
    v_o2 := current_setting('orders.o2', true)::uuid;
    SELECT id INTO v_b1 FROM public.order_items WHERE session_id = v_o2 AND sort_order = 0;
    PERFORM pg_temp.t('S3 staff places order 3 (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o3', public.order_create(NULL, 'probe-note', %L::jsonb)::text, true)$q$, pg_temp.lines(3, 2)),
      ARRAY['rows=1'], NULL, true);
    v_o3 := current_setting('orders.o3', true)::uuid;
    SELECT id INTO v_c1 FROM public.order_items WHERE session_id = v_o3 AND sort_order = 0;
    SELECT id INTO v_c2 FROM public.order_items WHERE session_id = v_o3 AND sort_order = 1;
    PERFORM pg_temp.t('S4 staff places order 4 (kept)', staff_, 'staff',
      format($q$SELECT set_config('orders.o4', public.order_create(NULL, 'probe-note', %L::jsonb)::text, true)$q$, pg_temp.lines(3, 2)),
      ARRAY['rows=1'], NULL, true);
    v_o4 := current_setting('orders.o4', true)::uuid;
    v_other := v_b1;

    -- ── Who may ──
    PERFORM pg_temp.t('W1 staff (the creator) approves its own order with quantities', staff_, 'staff',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o1, jsonb_build_array(jsonb_build_object('id', v_a1, 'qty', 5))),
      ARRAY['refused']);
    PERFORM pg_temp.note('        (W1 read: ' || current_setting('orders.last_refusal', true) || ')');
    PERFORM pg_temp.t('W2 hr approves', hr_, 'hr',
      format($q$SELECT public.order_review_approve(%L, 0, '[]'::jsonb)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('W3 a login with no profile approves', gen_random_uuid(), 'no-profile',
      format($q$SELECT public.order_review_approve(%L, 0, '[]'::jsonb)$q$, v_o1), ARRAY['refused']);

    -- ── Refused before any write: the state after each is checked ──
    PERFORM pg_temp.t('N1 editor with a stale version', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 7, %L::jsonb)$q$, v_o1, jsonb_build_array(jsonb_build_object('id', v_a1, 'qty', 5))),
      ARRAY['refused']);
    PERFORM pg_temp.t('N2 editor with no version', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, NULL, '[]'::jsonb)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('N3 editor with a line of ANOTHER order', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o1, jsonb_build_array(jsonb_build_object('id', v_other, 'qty', 5))),
      ARRAY['refused']);
    PERFORM pg_temp.t('N4 editor with the same line twice', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', v_a1, 'qty', 5), jsonb_build_object('id', v_a1, 'qty', 6))), ARRAY['refused']);
    PERFORM pg_temp.t('N5 editor with a negative quantity', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o1, jsonb_build_array(jsonb_build_object('id', v_a1, 'qty', -1))),
      ARRAY['refused']);
    PERFORM pg_temp.t('N6 editor with a quantity that is not a number', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o1, jsonb_build_array(jsonb_build_object('id', v_a1, 'qty', 'abc'))),
      ARRAY['refused']);
    PERFORM pg_temp.t('N6b editor with a quantity sent as text ("5")', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o1, jsonb_build_array(jsonb_build_object('id', v_a1, 'qty', '5'))),
      ARRAY['refused']);
    PERFORM pg_temp.t('N7 editor with lines that are not an array', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, '{"id": 1}'::jsonb)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('N8 editor: the first line valid (7), the second invalid (-1)', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', v_a1, 'qty', 7), jsonb_build_object('id', v_a2, 'qty', -1))), ARRAY['refused']);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'submitted'
       OR (SELECT version FROM public.order_sessions WHERE id = v_o1) <> 0
       OR (SELECT count(*) FROM public.order_items WHERE session_id = v_o1 AND reviewer_qty_ordered IS NOT NULL) <> 0
       OR (SELECT count(*) FROM public.order_item_changes WHERE session_id = v_o1) <> 0 THEN
      RAISE EXCEPTION 'FAIL    N1–N8 left something behind on order 1. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      N read back: refused, state unchanged — after eight refusals order 1 is still waiting, version 0, no head quantity, no change-log row');

    -- ── The approval with the quantities ──
    PERFORM pg_temp.t('A1 editor approves order 1: line 1 corrected 3 -> 5, line 2 left at 2 (kept)', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o1,
        jsonb_build_array(jsonb_build_object('id', v_a1, 'qty', 5), jsonb_build_object('id', v_a2, 'qty', 2))),
      ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o1) <> 'reviewed'
       OR (SELECT reviewed_by FROM public.order_sessions WHERE id = v_o1) IS DISTINCT FROM editor_
       OR (SELECT version FROM public.order_sessions WHERE id = v_o1) <> 1
       OR (SELECT reviewer_qty_ordered FROM public.order_items WHERE id = v_a1) IS DISTINCT FROM 5
       OR (SELECT reviewer_qty_ordered FROM public.order_items WHERE id = v_a2) IS NOT NULL
       OR (SELECT count(*) FROM public.order_item_changes WHERE session_id = v_o1) <> 1
       OR (SELECT count(*) FROM public.order_item_changes WHERE item_id = v_a1 AND field = 'reviewer_qty_ordered'
            AND old_value IS NULL AND new_value = 5 AND changed_by = editor_) <> 1 THEN
      RAISE EXCEPTION 'FAIL    A1 the approval, the quantities or the log do not read as expected. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      A1 read back: reviewed by the editor, version 1, line 1 at 5, line 2 unchanged, exactly one log row (null -> 5)');
    PERFORM pg_temp.t('A2 editor approves order 1 again', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 1, '[]'::jsonb)$q$, v_o1), ARRAY['refused']);
    PERFORM pg_temp.t('A3 staff edits its approved order', staff_, 'staff',
      format($q$SELECT public.order_edit(%L, %L::jsonb)$q$, v_o1, jsonb_build_array(jsonb_build_object('id', v_a1, 'qty_ordered', 9))),
      ARRAY['refused']);

    -- ── A quantity set back to what staff ordered clears the head's figure ──
    PERFORM pg_temp.t('B1 admin sets a head quantity on order 2 the old way, 3 -> 4 (kept)', admin_, 'admin',
      format($q$SELECT public.order_set_head_qty(%L, 4)$q$, v_b1), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('B2 owner approves order 2 with line 1 back at 3 (kept)', owner_, 'owner',
      format($q$SELECT public.order_review_approve(%L, 1, %L::jsonb)$q$, v_o2, jsonb_build_array(jsonb_build_object('id', v_b1, 'qty', 3))),
      ARRAY['rows=1'], NULL, true);
    IF (SELECT reviewer_qty_ordered FROM public.order_items WHERE id = v_b1) IS NOT NULL
       OR (SELECT status FROM public.order_sessions WHERE id = v_o2) <> 'reviewed'
       OR (SELECT count(*) FROM public.order_item_changes WHERE item_id = v_b1 AND field = 'reviewer_qty_ordered'
            AND old_value = 4 AND new_value IS NULL AND changed_by = owner_) <> 1 THEN
      RAISE EXCEPTION 'FAIL    B2 the head quantity was not cleared and logged. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      B2 read back: order 2 reviewed, line 1 back to what staff ordered (head quantity cleared, logged 4 -> null)');

    -- ── The order changed since the head opened it ──
    PERFORM pg_temp.t('C1 staff edits order 3 while it waits, moving its version (kept)', staff_, 'staff',
      format($q$SELECT public.order_edit(%L, %L::jsonb)$q$, v_o3,
        jsonb_build_array(jsonb_build_object('id', v_c1, 'qty_ordered', 4, 'order_unit', 'โล'))), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('C2 editor approves order 3 with the version it opened (0)', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, %L::jsonb)$q$, v_o3,
        jsonb_build_array(jsonb_build_object('id', v_c1, 'qty', 6), jsonb_build_object('id', v_c2, 'qty', 1))), ARRAY['refused']);
    PERFORM pg_temp.note('        (C2 read: ' || current_setting('orders.last_refusal', true) || ')');
    IF (SELECT status FROM public.order_sessions WHERE id = v_o3) <> 'submitted'
       OR (SELECT count(*) FROM public.order_items WHERE session_id = v_o3 AND reviewer_qty_ordered IS NOT NULL) <> 0 THEN
      RAISE EXCEPTION 'FAIL    C2 a stale approval left quantities or an approval behind. Nothing applied.';
    END IF;
    PERFORM pg_temp.t('C3 editor reloads and approves order 3 at version 1 (kept)', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 1, %L::jsonb)$q$, v_o3,
        jsonb_build_array(jsonb_build_object('id', v_c1, 'qty', 6), jsonb_build_object('id', v_c2, 'qty', 1))), ARRAY['rows=1'], NULL, true);
    IF (SELECT count(*) FROM public.order_item_changes WHERE session_id = v_o3 AND field = 'reviewer_qty_ordered') <> 2 THEN
      RAISE EXCEPTION 'FAIL    C3 two head quantities changed but the log does not hold two rows. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      C3 read back: order 3 approved after the reload, two log rows (head figures null -> 6 and null -> 1)');

    -- ── No lines at all: an approval with nothing corrected ──
    PERFORM pg_temp.t('E1 editor approves order 4, line 1 sent as 3.00001 on a line of 3 (rounds to no change) (kept)', editor_, 'editor',
      format($q$SELECT public.order_review_approve(%L, 0, '[{"id": "%s", "qty": 3.00001}]'::jsonb)$q$, v_o4,
        (SELECT id FROM public.order_items WHERE session_id = v_o4 AND sort_order = 0)), ARRAY['rows=1'], NULL, true);
    IF (SELECT status FROM public.order_sessions WHERE id = v_o4) <> 'reviewed'
       OR (SELECT count(*) FROM public.order_item_changes WHERE session_id = v_o4) <> 0 THEN
      RAISE EXCEPTION 'FAIL    E1 an approval with no corrections wrote a quantity or a log row. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      E1 read back: order 4 reviewed; 3.00001 rounded to the column''s 3.0000, so no quantity touched and no log row');

    -- ── Direct writes stay closed ──
    PERFORM pg_temp.t('D1 editor sets a head quantity by a direct UPDATE', editor_, 'editor',
      format($q$UPDATE public.order_items SET reviewer_qty_ordered = 8 WHERE id = %L$q$, v_c2), ARRAY['denied', 'rows=0']);

    v_log := current_setting('orders.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('orders.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (four test orders, their lines, the quantities, the approvals, the log rows)');
  END;
END
$do$;

-- ── Step 3: nothing the tests did survived them, and the file reported ─────

DO $do$
DECLARE
  v_rows bigint;
  -- Every row the file is supposed to emit, counted by the checker's rule
  -- (a t() or a note() is one row). Change a test, change this.
  c_expected constant bigint := 38;
BEGIN
  IF (SELECT count(*) FROM public.order_sessions)::text <> current_setting('orders.n_sessions')
     OR (SELECT count(*) FROM public.order_items)::text <> current_setting('orders.n_items')
     OR (SELECT count(*) FROM public.order_item_changes)::text <> current_setting('orders.n_changes')
     OR (SELECT md5(COALESCE(string_agg(id::text || status || version::text || COALESCE(reviewed_by::text, ''), ',' ORDER BY id), ''))
           FROM public.order_sessions) <> current_setting('orders.fingerprint') THEN
    RAISE EXCEPTION 'FAIL    an order, a line, a log row or an order''s status, version or reviewer changed. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'order_review_approve') <> 1 THEN
    RAISE EXCEPTION 'FAIL    more than one function is named order_review_approve. Nothing applied.';
  END IF;
  IF has_function_privilege('anon', 'public.order_review_approve(uuid, int, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL    anon may still execute order_review_approve. Nothing applied.';
  END IF;
  PERFORM pg_temp.note(format('ok      counts as before (orders %s, lines %s, log rows %s), every order''s status, version and reviewer byte for byte; one function of the name; anon may not execute it',
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

-- ═══ After it runs — in the app, once the code that calls it is deployed ══
--
-- 1. As staff: place an order of two lines.
-- 2. As a head: ตรวจสอบ, open it; the quantities are editable, pre-filled.
--    Change one and press อนุมัติ: the order is รอสั่งซื้อ and the change
--    shows as แก้จาก and in ประวัติการแก้จำนวน.
-- 3. Open another waiting order in two tabs; in one, as its creator, change
--    a line; in the other, as a head, press อนุมัติ: refused with the reload
--    message, nothing approved; reload, approve.
