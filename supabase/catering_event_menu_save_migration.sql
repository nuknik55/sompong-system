-- ============================================================================
-- Catering per-event menus, round 2: ONE save of a booking's own menu
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. One
-- transaction: it records what is live, creates one function, tests it AS
-- REAL ACCOUNTS with every test write rolled back, counts its own result rows,
-- and rolls the whole thing back if anything disagrees. Safe to re-run: the
-- only change is CREATE OR REPLACE FUNCTION, so a second run changes nothing
-- and prints the same table.
--
-- Needs catering_event_menu_items_migration.sql (applied 2026-09-19): the
-- table it writes, the set_name marker, and catering_event_unlocked(uuid) from
-- catering_sales_limits_migration.sql. Step 0 stops if either is missing.
--
-- WHY (Nik, 2026-09-19). Round 1 wrote every edit of a booking's menu the
-- moment it was made — six separate server actions, each its own statement.
-- Nik decided the screen holds its edits and ONE บันทึก commits them all:
-- swaps, quantities, removals, additions, a fill from a standard set or from
-- another booking's own list, a new custom set started empty, and the price
-- per table. A save of several lines through several statements could land
-- half-way; this file gives the app one function that writes every changed
-- line in one transaction — whole, or not at all.
--
-- WHAT IT CHANGES
--   catering_save_event_menus(p_event_id uuid, p_lines jsonb) RETURNS jsonb.
--   For each line in p_lines:
--     • event_menu_id NULL — a NEW custom set: inserts the set line
--       (set_name, quantity = tables) and its food charge (unit_price = the
--       price per table, amount = price × tables), the same pair the price
--       box creates when a set is picked.
--     • event_menu_id given — an EXISTING set line of this booking: stamps
--       set_name when it has none (a line from before the copy existed
--       becomes the booking's own from this save on), sets THE price on the
--       linked charge (unit_price; amount follows the charge's own tables),
--       and replaces the line's courses with the ones sent.
--     • Each course carries its provenance — source_set_menu_id (a standard
--       set) or source_event_menu_id (another booking's line) — recorded,
--       never followed live. A course the person chose by hand carries
--       neither.
--   It refuses: a caller who is not owner or admin; a booking that does not
--   exist; a cost-locked booking; a line that is not this booking's or is a
--   single dish; a new set with no name or no tables; a new set NAMED LIKE A
--   SET LINE THE BOOKING ALREADY HAS (A5 — three "t2000" rows at three
--   prices, 2026-09-19; existing rows are never refused); a negative price;
--   the same dish twice in one line; and a draft whose CONFLICT TOKEN is
--   stale — the row ids and price the screen opened with no longer match,
--   because someone else saved the line since (two admins, one line: the
--   review found the second save silently won). quantity > 0 and the four
--   sections are the table's own CHECKs. SECURITY INVOKER: every statement
--   runs under the caller's own row-level security, on top of the checks
--   above. The app
--   always creates a new set with tables = 1 (the count is set in the price
--   box); the function accepts any count above 0.
--
-- WHO MAY DO WHAT, matching src/lib/event-menu-access.ts
--   owner, admin   save (the function); sales   nothing here (view only)
--   a locked booking is refused for everyone, owner and admin included
--
-- CHANGES NO DATA. It reads existing rows to clone a test booking inside a
-- block that is always rolled back. Nothing existing is written.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: CREATE OR REPLACE FUNCTION ×1;
-- COMMENT ON FUNCTION ×1. Anything else is unexpected. It creates no table,
-- deletes nothing and drops nothing.
--
-- THE THREE LESSONS OF THE ROUND-1 FILE are built in (AGENTS.md): every probe
-- naming an object this file creates is dynamic or a catalog lookup by text
-- (check C); the pattern that attributes a refusal has no backslash (check
-- D); the results are carried out of the always-aborting block by a variable
-- (check E); and Step 3 asserts the result table's row count (check F).
-- ============================================================================

BEGIN;

-- ── Test scaffolding: notes in a session setting, never a table ────────────

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  PERFORM set_config('event_menu_save.log',
    COALESCE(current_setting('event_menu_save.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('event_menu_save.log', true), '');
BEGIN
  PERFORM set_config('event_menu_save.log', '', false);
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
    FROM regexp_split_to_table(COALESCE(current_setting('event_menu_save.log', true), ''), chr(30)) AS l
   WHERE l <> '';
$fn$;

-- Runs one statement as one account and ALWAYS rolls it back (a private
-- SQLSTATE, caught). Returns the identity it actually ran as, first. With
-- p_check, a SELECT run right after the statement, in the same impersonated
-- sub-transaction, whose row count is appended as "check=N" — so a probe can
-- report what the statement DID, not only that it ran.
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
      PERFORM set_config('event_menu_save.last_refusal', SQLERRM, true);
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

-- ── The harness tests ITSELF, before it tests anything else ────────────────

DO $do$
DECLARE
  v_here  constant text := 'INSERT INTO public.catering_event_menu_items (event_id) VALUES (NULL)';
  v_ok    boolean := false;
BEGIN
  -- X1. A refusal FROM THE TABLE UNDER TEST reads as 'denied'.
  IF pg_temp.sql_target(v_here) IS DISTINCT FROM 'catering_event_menu_items'
     OR pg_temp.sql_target('UPDATE public.catering_event_charges SET quantity = 1 WHERE id = NULL') IS DISTINCT FROM 'catering_event_charges'
     OR pg_temp.sql_target('DELETE FROM public.catering_event_menu_items WHERE id = NULL') IS DISTINCT FROM 'catering_event_menu_items'
     OR pg_temp.sql_target('insert into catering_event_menus (event_id) values (NULL)') IS DISTINCT FROM 'catering_event_menus' THEN
    RAISE EXCEPTION 'FAIL    X1 the harness cannot read the table out of a statement. Nothing applied.';
  END IF;
  IF pg_temp.classify('denied:catering_event_menu_items', v_here) IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'FAIL    X1 a refusal from the table under test was not read as "denied": got %. Nothing applied.',
      pg_temp.classify('denied:catering_event_menu_items', v_here);
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
  v_has   boolean;
BEGIN
  PERFORM 'public.current_role()'::regprocedure;
  BEGIN
    PERFORM 'public.catering_event_unlocked(uuid)'::regprocedure;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'catering_event_unlocked(uuid) is missing: catering_sales_limits_migration.sql has not run. Nothing changed.';
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
  IF v_owner IS NULL OR v_admin IS NULL OR v_sales IS NULL THEN
    RAISE EXCEPTION 'need one owner, one admin and one sales profile to test as; found owner %, admin %, sales %. Nothing changed.',
      v_owner, v_admin, v_sales;
  END IF;
  PERFORM set_config('event_menu_save.owner', v_owner::text, false);
  PERFORM set_config('event_menu_save.admin', v_admin::text, false);
  PERFORM set_config('event_menu_save.sales', v_sales::text, false);

  -- The function this file creates, looked up by NAME AS TEXT in the catalog
  -- — never named in executable SQL before its own CREATE (AGENTS.md).
  v_has := EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE n.nspname = 'public' AND p.proname = 'catering_save_event_menus');
  PERFORM pg_temp.note(format('before  catering_save_event_menus exists: %s (a re-run says true)', v_has));
  PERFORM pg_temp.note(format('before  copies stored: %s row(s); set lines with no copy (they fall back to the shared set): %s of %s',
    (SELECT count(*) FROM public.catering_event_menu_items),
    (SELECT count(*) FROM public.catering_event_menus m WHERE m.set_menu_id IS NOT NULL AND m.set_name IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.catering_event_menu_items i WHERE i.event_menu_id = m.id)),
    (SELECT count(*) FROM public.catering_event_menus m WHERE m.set_menu_id IS NOT NULL)));
  PERFORM set_config('event_menu_save.n_events',  (SELECT count(*) FROM public.catering_events)::text, false);
  PERFORM set_config('event_menu_save.n_lines',   (SELECT count(*) FROM public.catering_event_menus)::text, false);
  PERFORM set_config('event_menu_save.n_charges', (SELECT count(*) FROM public.catering_event_charges)::text, false);
  PERFORM set_config('event_menu_save.n_items',   (SELECT count(*) FROM public.catering_event_menu_items)::text, false);
END
$do$;

-- ── Step 1: the one save ───────────────────────────────────────────────────
--
-- SECURITY INVOKER, deliberately: unlike catering_copy_set_menu (which a sales
-- session must be able to call), nothing here needs to bypass a policy. Every
-- INSERT, UPDATE and DELETE below runs under the caller's own RLS as well as
-- the explicit checks at the top.

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
  v_name   text;
  v_price  numeric;
  v_tables numeric;
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
      RAISE EXCEPTION 'ราคาต่อโต๊ะต้องเป็นตัวเลข 0 หรือมากกว่า';
    END IF;
    IF jsonb_typeof(v_line->'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (items)';
    END IF;

    IF (v_line->>'event_menu_id') IS NULL THEN
      -- A NEW custom set: the set line and its food charge, the pair the
      -- price box creates when a set is picked (addCateringEventMenu).
      v_name   := nullif(btrim(v_line->>'set_name'), '');
      v_tables := (v_line->>'tables')::numeric;
      IF v_name IS NULL THEN
        RAISE EXCEPTION 'ชุดเมนูของงานต้องมีชื่อ';
      END IF;
      IF v_tables IS NULL OR v_tables <= 0 THEN
        RAISE EXCEPTION 'จำนวนโต๊ะต้องมากกว่า 0';
      END IF;
      -- A5 (Nik, 2026-09-19): three sets called t2000 at three prices all
      -- counted toward one total with nothing to tell them apart. A NEW set
      -- may not take a name another set line of this booking already goes
      -- by — its snapshot name, its shared set's name, or its charge label.
      -- Existing lines are never refused: Nik removes his own duplicates.
      IF EXISTS (SELECT 1
                   FROM public.catering_event_menus m
                   LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
                   LEFT JOIN public.catering_event_charges c ON c.event_menu_id = m.id
                  WHERE m.event_id = p_event_id AND m.menu_id IS NULL
                    AND lower(btrim(COALESCE(m.set_name, s.name, c.label))) = lower(v_name)) THEN
        RAISE EXCEPTION 'มีชุดชื่อ "%" อยู่ในงานนี้แล้ว — ตั้งชื่อชุดใหม่ให้ต่างกัน', v_name;
      END IF;
      SELECT COALESCE(max(m.sort_order), 0) + 10 INTO v_sort FROM public.catering_event_menus m WHERE m.event_id = p_event_id;
      INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, set_name, quantity, sort_order)
        VALUES (p_event_id, NULL, NULL, v_name, v_tables, v_sort)
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
      -- THE CONFLICT TOKEN (review, 2026-09-19: two admins on one line, and
      -- the second save silently won). The screen sends the row ids and the
      -- price it opened with; every save rewrites a line's rows, so anyone
      -- else's save since then shows as different ids or a different price,
      -- and this draft is refused rather than written over their work. A
      -- payload without the token (an older bundle) is not checked.
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
        RAISE EXCEPTION 'ราคาต่อโต๊ะของชุดนี้ถูกแก้ไขจากที่อื่นหลังจากเปิดหน้านี้ — กดยกเลิกเพื่อโหลดข้อมูลล่าสุด แล้วทำใหม่';
      END IF;
      -- The marker: from this save on, the line is the booking's own list,
      -- however many rows it holds (an emptied copy is a copy with no rows).
      IF v_name IS NULL THEN
        UPDATE public.catering_event_menus m
           SET set_name = COALESCE((SELECT s.name FROM public.catering_set_menus s WHERE s.id = m.set_menu_id), 'ชุดเมนู')
         WHERE m.id = v_id;
      END IF;
      -- THE price per table: the linked charge's unit_price — the number the
      -- price box shows and the quotation prints. Its amount follows its own
      -- quantity (tables), which this save does not change.
      UPDATE public.catering_event_charges c
         SET unit_price = v_price, amount = v_price * c.quantity
       WHERE c.event_menu_id = v_id AND c.event_id = p_event_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 0 THEN
        -- Every set line is created with its charge; one without is a line
        -- the price box cannot show. Give it the charge it should have had.
        SELECT COALESCE(max(c.sort_order), 0) + 10 INTO v_sort FROM public.catering_event_charges c WHERE c.event_id = p_event_id;
        INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, sort_order)
          SELECT p_event_id, COALESCE(m.set_name, s.name, 'ชุดเมนู'), 'food', v_price, m.quantity, v_price * m.quantity, NULL, v_id, v_sort
            FROM public.catering_event_menus m
            LEFT JOIN public.catering_set_menus s ON s.id = m.set_menu_id
           WHERE m.id = v_id;
      END IF;
      DELETE FROM public.catering_event_menu_items i WHERE i.event_menu_id = v_id;
    END IF;

    -- The courses, whole, in the order sent. Provenance is copied as given.
    v_sort := 0;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_line->'items') LOOP
      v_sort := v_sort + 10;
      v_menu := (v_item->>'menu_id')::uuid;
      v_qty  := (v_item->>'quantity')::numeric;
      IF v_menu IS NULL OR v_qty IS NULL THEN
        RAISE EXCEPTION 'รูปแบบข้อมูลไม่ถูกต้อง (menu_id, quantity)';
      END IF;
      IF EXISTS (SELECT 1 FROM public.catering_event_menu_items i WHERE i.event_menu_id = v_id AND i.menu_id = v_menu) THEN
        RAISE EXCEPTION 'เมนูเดียวกันอยู่ในชุดเดียวกันสองครั้ง';
      END IF;
      INSERT INTO public.catering_event_menu_items
        (event_id, event_menu_id, menu_id, quantity, section, sort_order, note, source_set_menu_id, source_event_menu_id)
      VALUES
        (p_event_id, v_id, v_menu, v_qty, COALESCE(v_item->>'section', 'dish'), v_sort,
         nullif(btrim(v_item->>'note'), ''),
         (v_item->>'source_set_menu_id')::uuid, (v_item->>'source_event_menu_id')::uuid);
    END LOOP;

    v_out := v_out || jsonb_build_object('key', v_line->>'key', 'event_menu_id', v_id);
  END LOOP;

  RETURN v_out;
END
$fn$;

COMMENT ON FUNCTION public.catering_save_event_menus(uuid, jsonb) IS
  'ONE save of a booking''s own menu (catering per-event menus, round 2): every changed set line, '
  'whole — its courses (replacing the copy, provenance as given), THE price per table (the linked '
  'charge''s unit_price, the number the price box shows), and for a new custom set the line and its '
  'food charge. Owner and admin only; refuses a locked booking, a line of another booking, a single '
  'dish, a nameless new set, a negative price, and the same dish twice. SECURITY INVOKER: runs under '
  'the caller''s own RLS. One transaction: a payload lands entirely or not at all. 2026-09-19.';

-- ── Step 2: tests, as real accounts, every write rolled back ───────────────
--
-- Inside one block that ends by raising a private SQLSTATE, so the cloned
-- booking, its lines, the copies, the charges and the lock all go, whatever
-- the outcome. The results are carried out by a VARIABLE (see v_log).

DO $do$
DECLARE
  owner_   uuid := current_setting('event_menu_save.owner')::uuid;
  admin_   uuid := current_setting('event_menu_save.admin')::uuid;
  sales_   uuid := current_setting('event_menu_save.sales')::uuid;
  marker   constant text := 'probe-event-menu-save';
  v_u      uuid;   -- an UNLOCKED real booking with a set line, cloned — never written
  v_u_line uuid;   -- that real booking's set line: named by a probe, never written
  v_cols   text;
  v_e      uuid;   -- the clone
  v_l1     uuid;   -- clone's set line WITH a copy (this session made it)
  v_l2     uuid;   -- clone's set line with NO copy: a pre-feature shape
  v_ld     uuid;   -- clone's single-dish line
  v_set    uuid;
  v_set_name text;
  v_n_shared integer;
  v_set_dish uuid; -- a dish IN the set
  v_dish   uuid;   -- a dish NOT in the set
  v_dish2  uuid;   -- another dish NOT in the set
  v_items  text;   -- a valid items payload, reused
  v_log    text;   -- THE RESULTS, carried out of the rollback by hand
BEGIN
  BEGIN
    SELECT e.id, m.id, m.set_menu_id INTO v_u, v_u_line, v_set
      FROM public.catering_events e
      JOIN public.catering_event_menus m ON m.event_id = e.id AND m.set_menu_id IS NOT NULL
      JOIN public.catering_set_menu_items i ON i.set_menu_id = m.set_menu_id
     WHERE e.cost_locked_at IS NULL
     ORDER BY e.id, m.id LIMIT 1;
    IF v_u IS NULL THEN
      RAISE EXCEPTION 'no unlocked booking with a set line whose set has dishes — the tests have nothing to clone. Nothing applied.';
    END IF;
    SELECT count(*), min(i.menu_id::text)::uuid INTO v_n_shared, v_set_dish FROM public.catering_set_menu_items i WHERE i.set_menu_id = v_set;
    SELECT s.name INTO v_set_name FROM public.catering_set_menus s WHERE s.id = v_set;
    SELECT d.id INTO v_dish FROM public.menus d
     WHERE NOT EXISTS (SELECT 1 FROM public.catering_set_menu_items i WHERE i.set_menu_id = v_set AND i.menu_id = d.id)
     ORDER BY d.id LIMIT 1;
    SELECT d.id INTO v_dish2 FROM public.menus d
     WHERE d.id <> v_dish
       AND NOT EXISTS (SELECT 1 FROM public.catering_set_menu_items i WHERE i.set_menu_id = v_set AND i.menu_id = d.id)
     ORDER BY d.id LIMIT 1;
    IF v_dish IS NULL OR v_dish2 IS NULL THEN
      RAISE EXCEPTION 'fewer than two dishes outside the test set; nothing to add or swap in. Nothing applied.';
    END IF;

    -- Clone the booking as this session (the same technique as the round-1 file).
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO v_cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = 'catering_events'
       AND c.is_generated = 'NEVER' AND c.is_identity = 'NO'
       AND c.column_name NOT IN ('id', 'cost_locked_at', 'quote_number', 'created_at', 'updated_at', 'detail_note');
    EXECUTE format('INSERT INTO public.catering_events (%s, detail_note) SELECT %s, %L FROM public.catering_events WHERE id = %L RETURNING id',
      v_cols, v_cols, marker, v_u) INTO v_e;
    -- L1: a copied set line with its charge, 4,500 × 10 tables.
    INSERT INTO public.catering_event_menus (event_id, set_menu_id, set_name, quantity, sort_order, note)
      VALUES (v_e, v_set, v_set_name, 10, 10, marker) RETURNING id INTO v_l1;
    INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id, quantity, section, sort_order, note, source_set_menu_id)
      SELECT v_e, v_l1, i.menu_id, i.quantity, i.section, i.sort_order, i.note, v_set
        FROM public.catering_set_menu_items i WHERE i.set_menu_id = v_set;
    INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, event_menu_id, sort_order)
      VALUES (v_e, v_set_name, 'food', 4500, 10, 45000, v_l1, 10);
    -- L2: a never-copied set line (set_name NULL, no rows) with its charge, 4,500 × 2.
    INSERT INTO public.catering_event_menus (event_id, set_menu_id, quantity, sort_order, note)
      VALUES (v_e, v_set, 2, 20, marker) RETURNING id INTO v_l2;
    INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, event_menu_id, sort_order)
      VALUES (v_e, v_set_name, 'food', 4500, 2, 9000, v_l2, 20);
    -- LD: a single-dish line.
    INSERT INTO public.catering_event_menus (event_id, menu_id, quantity, sort_order, note)
      VALUES (v_e, v_dish2, 1, 30, marker) RETURNING id INTO v_ld;

    -- A valid list: one set dish at 2 portions (provenance: the set), one new dish by hand.
    v_items := format('[{"menu_id":%s,"quantity":2,"section":"dish","sort_order":10,"note":null,"source_set_menu_id":%s,"source_event_menu_id":null},'
                      || '{"menu_id":%s,"quantity":1,"section":"drink","sort_order":20,"note":" เย็นจัด ","source_set_menu_id":null,"source_event_menu_id":null}]',
                      to_json(v_set_dish::text), to_json(v_set::text), to_json(v_dish::text));

    -- ── V1: admin saves an existing line — courses replaced, price set, provenance kept ──
    PERFORM pg_temp.t('V1 admin saves a line: 2 courses replace the copy, price 4,321 lands on the charge', admin_, 'admin',
      format($q$SELECT 1 WHERE jsonb_array_length(public.catering_save_event_menus(%L, %L::jsonb)) = 1$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4321,"items":%s}]', to_json(v_l1::text), v_items)),
      ARRAY['rows=1 check=5'],
      format($q$SELECT 1 FROM public.catering_event_menu_items i WHERE i.event_menu_id = %L AND i.menu_id = %L AND i.quantity = 2 AND i.section = 'dish' AND i.sort_order = 10 AND i.source_set_menu_id = %L
              UNION ALL SELECT 1 FROM public.catering_event_menu_items i WHERE i.event_menu_id = %L AND i.menu_id = %L AND i.quantity = 1 AND i.section = 'drink' AND i.sort_order = 20 AND i.note = 'เย็นจัด' AND i.source_set_menu_id IS NULL
              UNION ALL SELECT 1 FROM (SELECT count(*) c FROM public.catering_event_menu_items i WHERE i.event_menu_id = %L) x WHERE x.c = 2
              UNION ALL SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.unit_price = 4321 AND c.quantity = 10 AND c.amount = 43210
              UNION ALL SELECT 1 FROM public.catering_event_menus m WHERE m.id = %L AND m.set_name = %L$q$,
        v_l1, v_set_dish, v_set, v_l1, v_dish, v_l1, v_l1, v_l1, v_set_name));

    -- ── V2: owner saves a NEVER-copied line — the save makes it the booking's own ──
    PERFORM pg_temp.t('V2 owner saves a pre-feature line (no copy): set_name stamped from the shared set, courses written, price kept', owner_, 'owner',
      format($q$SELECT 1 WHERE jsonb_array_length(public.catering_save_event_menus(%L, %L::jsonb)) = 1$q$,
        v_e, format('[{"key":"L2","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"items":%s}]', to_json(v_l2::text), v_items)),
      ARRAY['rows=1 check=3'],
      format($q$SELECT 1 FROM public.catering_event_menus m WHERE m.id = %L AND m.set_name = %L
              UNION ALL SELECT 1 FROM (SELECT count(*) c FROM public.catering_event_menu_items i WHERE i.event_menu_id = %L) x WHERE x.c = 2
              UNION ALL SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.unit_price = 4500 AND c.amount = 9000$q$,
        v_l2, v_set_name, v_l2, v_l2));

    -- ── V3: a new custom set, started empty, with provenance from another booking's line on one course ──
    PERFORM pg_temp.t('V3 owner creates a custom set (no event_menu_id): the line, its food charge 5,000 × 3, and a course copied from another booking''s line', owner_, 'owner',
      format($q$SELECT 1 WHERE (public.catering_save_event_menus(%L, %L::jsonb)->0->>'event_menu_id') IS NOT NULL$q$,
        v_e, format('[{"key":"new-1","event_menu_id":null,"set_name":" ชุดพิเศษ ทดสอบ ","tables":3,"price_per_table":5000,"items":[{"menu_id":%s,"quantity":1,"section":"dish","sort_order":10,"note":null,"source_set_menu_id":null,"source_event_menu_id":%s}]}]',
          to_json(v_dish::text), to_json(v_u_line::text))),
      ARRAY['rows=1 check=3'],
      format($q$SELECT 1 FROM public.catering_event_menus m WHERE m.event_id = %L AND m.set_name = 'ชุดพิเศษ ทดสอบ' AND m.set_menu_id IS NULL AND m.menu_id IS NULL AND m.quantity = 3
              UNION ALL SELECT 1 FROM public.catering_event_charges c JOIN public.catering_event_menus m ON m.id = c.event_menu_id
                        WHERE m.event_id = %L AND m.set_name = 'ชุดพิเศษ ทดสอบ' AND c.label = 'ชุดพิเศษ ทดสอบ' AND c.charge_type = 'food' AND c.unit_price = 5000 AND c.quantity = 3 AND c.amount = 15000
              UNION ALL SELECT 1 FROM public.catering_event_menu_items i JOIN public.catering_event_menus m ON m.id = i.event_menu_id
                        WHERE m.event_id = %L AND m.set_name = 'ชุดพิเศษ ทดสอบ' AND i.menu_id = %L AND i.source_event_menu_id = %L$q$,
        v_e, v_e, v_e, v_dish, v_u_line));

    -- ── V4: an emptied list is still a copy ──
    PERFORM pg_temp.t('V4 admin saves an EMPTY list: the copy has no rows and is still a copy (set_name kept)', admin_, 'admin',
      format($q$SELECT 1 WHERE jsonb_array_length(public.catering_save_event_menus(%L, %L::jsonb)) = 1$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"items":[]}]', to_json(v_l1::text))),
      ARRAY['rows=1 check=2'],
      format($q$SELECT 1 FROM (SELECT count(*) c FROM public.catering_event_menu_items i WHERE i.event_menu_id = %L) x WHERE x.c = 0
              UNION ALL SELECT 1 FROM public.catering_event_menus m WHERE m.id = %L AND m.set_name IS NOT NULL$q$, v_l1, v_l1));

    -- ── V5: ATOMICITY — two lines, the second invalid: the first does not land ──
    -- The call is wrapped so its refusal is caught INSIDE the probe, and the
    -- check then reads L1 in the same sub-transaction: still 4,500, still the
    -- shared set's courses. This is the "not partially saved" guarantee.
    PERFORM pg_temp.t('V5 a payload whose SECOND line is another booking''s: refused, and the FIRST line''s price and courses are untouched', admin_, 'admin',
      format($q$DO $d$ BEGIN
                 PERFORM public.catering_save_event_menus(%L, %L::jsonb);
                 RAISE EXCEPTION 'FAIL the save accepted a line of another booking';
               EXCEPTION WHEN raise_exception THEN
                 IF SQLERRM LIKE 'FAIL%%' THEN RAISE; END IF;
               END $d$$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":1111,"items":[]},'
                    || '{"key":"X","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":1,"items":[]}]', to_json(v_l1::text), to_json(v_u_line::text))),
      ARRAY['rows=0 check=2'],
      format($q$SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.unit_price = 4500 AND c.amount = 45000
              UNION ALL SELECT 1 FROM (SELECT count(*) c FROM public.catering_event_menu_items i WHERE i.event_menu_id = %L) x WHERE x.c = %s$q$,
        v_l1, v_l1, v_n_shared));

    -- ── Refusals ──
    PERFORM pg_temp.t('V6 sales saves a line', sales_, 'sales',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"items":%s}]', to_json(v_l1::text), v_items)),
      ARRAY['refused']);
    PERFORM pg_temp.note('        (the refusal read: ' || COALESCE(current_setting('event_menu_save.last_refusal', true), '?') || ')');
    PERFORM pg_temp.t('V7 admin saves a line that belongs to ANOTHER booking under this booking''s id', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"X","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":1,"items":[]}]', to_json(v_u_line::text))),
      ARRAY['refused']);
    PERFORM pg_temp.t('V8 admin saves courses onto a SINGLE-DISH line', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"D","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":1,"items":%s}]', to_json(v_ld::text), v_items)),
      ARRAY['refused']);
    PERFORM pg_temp.t('V9 a course with quantity 0 (the table''s CHECK)', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"items":[{"menu_id":%s,"quantity":0,"section":"dish","sort_order":10,"note":null,"source_set_menu_id":null,"source_event_menu_id":null}]}]',
          to_json(v_l1::text), to_json(v_dish::text))),
      ARRAY['check-refused']);
    PERFORM pg_temp.t('V10 a course in a section that does not exist (the table''s CHECK)', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"items":[{"menu_id":%s,"quantity":1,"section":"soup","sort_order":10,"note":null,"source_set_menu_id":null,"source_event_menu_id":null}]}]',
          to_json(v_l1::text), to_json(v_dish::text))),
      ARRAY['check-refused']);
    PERFORM pg_temp.t('V11 the same dish twice in one line', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"items":[{"menu_id":%s,"quantity":1,"section":"dish","sort_order":10,"note":null,"source_set_menu_id":null,"source_event_menu_id":null},{"menu_id":%s,"quantity":2,"section":"drink","sort_order":20,"note":null,"source_set_menu_id":null,"source_event_menu_id":null}]}]',
          to_json(v_l1::text), to_json(v_dish::text), to_json(v_dish::text))),
      ARRAY['refused']);
    PERFORM pg_temp.t('V12 a negative price per table', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":-1,"items":[]}]', to_json(v_l1::text))),
      ARRAY['refused']);
    PERFORM pg_temp.t('V13 a new custom set with no name', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, '[{"key":"n","event_menu_id":null,"set_name":"  ","tables":2,"price_per_table":100,"items":[]}]'),
      ARRAY['refused']);
    -- A5: the name of a set the booking already has (L1 goes by the shared
    -- set's name), differing only in case and surrounding spaces.
    PERFORM pg_temp.t('V14 a new custom set named like a set line the booking already has (case and spaces ignored)', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"n","event_menu_id":null,"set_name":%s,"tables":1,"price_per_table":100,"items":[]}]', to_json(' ' || upper(v_set_name) || ' '))),
      ARRAY['refused']);
    PERFORM pg_temp.note('        (the refusal read: ' || COALESCE(current_setting('event_menu_save.last_refusal', true), '?') || ')');
    PERFORM pg_temp.t('V15 two new custom sets with one name in one payload: the second is refused, so neither lands', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, '[{"key":"a","event_menu_id":null,"set_name":"ชุดเจ","tables":1,"price_per_table":1500,"items":[]},{"key":"b","event_menu_id":null,"set_name":"ชุดเจ","tables":1,"price_per_table":1800,"items":[]}]'),
      ARRAY['refused']);
    -- ── The conflict token: a draft opened before someone else's save is refused ──
    PERFORM pg_temp.t('V16 a draft whose row ids are stale (someone saved this line since it was opened) is refused', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"known_item_ids":[],"known_price":4500,"items":%s}]', to_json(v_l1::text), v_items)),
      ARRAY['refused']);
    PERFORM pg_temp.t('V17 a draft whose price is stale is refused; the same draft with the live ids and price is accepted', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"known_item_ids":%s,"known_price":9999,"items":%s}]',
          to_json(v_l1::text),
          (SELECT COALESCE(json_agg(i.id::text ORDER BY i.id::text), '[]'::json)::text FROM public.catering_event_menu_items i WHERE i.event_menu_id = v_l1),
          v_items)),
      ARRAY['refused']);
    PERFORM pg_temp.t('V18 the same draft carrying the LIVE ids and price lands', admin_, 'admin',
      format($q$SELECT 1 WHERE jsonb_array_length(public.catering_save_event_menus(%L, %L::jsonb)) = 1$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4321,"known_item_ids":%s,"known_price":4500,"items":%s}]',
          to_json(v_l1::text),
          (SELECT COALESCE(json_agg(i.id::text ORDER BY i.id::text), '[]'::json)::text FROM public.catering_event_menu_items i WHERE i.event_menu_id = v_l1),
          v_items)),
      ARRAY['rows=1 check=1'],
      format($q$SELECT 1 FROM public.catering_event_charges c WHERE c.event_menu_id = %L AND c.unit_price = 4321$q$, v_l1));

    -- ── The copy never writes back: the shared set is unchanged by all of the above ──
    IF (SELECT count(*) FROM public.catering_set_menu_items WHERE set_menu_id = v_set) <> v_n_shared
       OR (SELECT s.name FROM public.catering_set_menus s WHERE s.id = v_set) IS DISTINCT FROM v_set_name THEN
      RAISE EXCEPTION 'FAIL    the shared set changed during the tests. Nothing applied.';
    END IF;
    PERFORM pg_temp.note(format('ok      S1 the shared set still has %s dishes and its name after every save above', v_n_shared));

    -- ── The lock: freeze the clone, then try again ──
    UPDATE public.catering_events SET cost_locked_at = now() WHERE id = v_e;
    PERFORM pg_temp.t('L1 admin saves a line of the LOCKED booking', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, format('[{"key":"L1","event_menu_id":%s,"set_name":null,"tables":null,"price_per_table":4500,"items":%s}]', to_json(v_l1::text), v_items)),
      ARRAY['refused']);
    PERFORM pg_temp.t('L2 owner creates a custom set on the LOCKED booking', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L, %L::jsonb)$q$,
        v_e, '[{"key":"n","event_menu_id":null,"set_name":"ชุดใหม่","tables":1,"price_per_table":100,"items":[]}]'),
      ARRAY['refused']);

    -- The last thing before the abort: take the results out of the setting
    -- and into memory, which the abort cannot reach.
    v_log := current_setting('event_menu_save.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      -- The database is back where it was; the record of what was proved is not.
      PERFORM set_config('event_menu_save.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (the cloned booking, its lines, its copies, its charges, its lock)');
  END;
END
$do$;

-- ── Step 3: nothing the tests did survived them, and the file reported ─────

DO $do$
DECLARE
  v_marker bigint;
  v_rows   bigint;
  -- Every row the file is supposed to emit, counted by hand and asserted
  -- below: 2 self-test, 2 survey, 18 V tests, 2 refusal texts, S1, 2 lock
  -- tests, the rollback line, and this step's own count line. Change a test,
  -- change this.
  c_expected constant bigint := 29;
BEGIN
  SELECT count(*) INTO v_marker FROM public.catering_events WHERE detail_note = 'probe-event-menu-save';
  IF v_marker <> 0 THEN
    RAISE EXCEPTION 'FAIL    % test booking(s) remain. Nothing applied.', v_marker;
  END IF;
  IF (SELECT count(*) FROM public.catering_events)::text <> current_setting('event_menu_save.n_events')
     OR (SELECT count(*) FROM public.catering_event_menus)::text <> current_setting('event_menu_save.n_lines')
     OR (SELECT count(*) FROM public.catering_event_charges)::text <> current_setting('event_menu_save.n_charges')
     OR (SELECT count(*) FROM public.catering_event_menu_items)::text <> current_setting('event_menu_save.n_items') THEN
    RAISE EXCEPTION 'FAIL    a row count changed: events % → %, lines % → %, charges % → %, copies % → %. Nothing applied.',
      current_setting('event_menu_save.n_events'), (SELECT count(*) FROM public.catering_events),
      current_setting('event_menu_save.n_lines'), (SELECT count(*) FROM public.catering_event_menus),
      current_setting('event_menu_save.n_charges'), (SELECT count(*) FROM public.catering_event_charges),
      current_setting('event_menu_save.n_items'), (SELECT count(*) FROM public.catering_event_menu_items);
  END IF;
  PERFORM pg_temp.note(format('ok      counts unchanged (events %s, lines %s, charges %s, copies %s); no test booking remains',
    current_setting('event_menu_save.n_events'), current_setting('event_menu_save.n_lines'),
    current_setting('event_menu_save.n_charges'), current_setting('event_menu_save.n_items')));

  -- The file checks that its own checks reported (the round-1 lesson).
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
  pg_temp.t(text, uuid, text, text, text[], text),
  pg_temp.classify(text, text),
  pg_temp.sql_target(text),
  pg_temp.probe(uuid, text, text),
  pg_temp.logged(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs — in the app ════════════════════════════════════════════
--
-- 1. As the OWNER: open a booking → รายการอาหารของงาน. Change a quantity,
--    swap a course (past 10%: the warning shows, confirm anyway), change the
--    price per table. Nothing is written yet: the figures move, the bar says
--    มีการแก้ไขที่ยังไม่บันทึก. Press ยกเลิก: everything returns. Redo, press
--    บันทึก: one save. Open the booking screen: the set line's price is the new
--    one and the dish names sit under the set's name.
-- 2. On a set line, กด "คัดลอกรายการอาหารจาก…": the two groups — standard
--    sets, and every other booking, newest first, searchable by name. Pick a
--    booking's line: ITS list replaces this line's (after confirming), and
--    lands on บันทึก.
-- 3. + สร้างชุดเมนูของงานเอง: a new card, empty. Add courses by hand or fill
--    it from the chooser; บันทึก creates the line and its price-box row.
-- 4. As SALES: the same page shows the row totals and the comparison
--    (ราคาอาหารชุดเทียบกับสั่งแยกจาน — สูงกว่า/ต่ำกว่า), no controls and no
--    cost figure anywhere.
-- 5. Lock a booking on the cost page: its menu page shows the frozen banner
--    and no controls, for the owner too; the save refuses.
