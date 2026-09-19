-- ============================================================================
-- Catering per-event menus, round 1: a booking's own copy of its set menu
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. One
-- transaction: it records what is live, makes its changes, tests them AS REAL
-- ACCOUNTS with every test write rolled back, and rolls the whole thing back
-- if anything disagrees. Safe to re-run: every statement is IF NOT EXISTS,
-- OR REPLACE, or DROP-then-CREATE by name, so a second run changes nothing
-- and prints the same table.
--
-- Needs catering_sales_limits_migration.sql (applied 2026-09-17): it reuses
-- catering_event_unlocked(uuid) and follows that file's policy shape. Step 0
-- stops if it has not run.
--
-- THE DESIGN (Nik, 2026-09-19)
--   1. Standard set menus stay shared reference data (catering_set_menus and
--      _items), edited by owner and admin only — unchanged, already enforced.
--   2. Picking a set for a booking COPIES its dishes into the booking, as the
--      event's own menu: catering_event_menu_items, one row per course, keyed
--      by the booking's set line (catering_event_menus.id). Editing the copy
--      never touches the shared set. A booking may also start a CUSTOM set —
--      a set line with its own name and no shared source — and add dishes
--      from scratch.
--   3. Past bookings keep showing what was served after the shared set
--      changes: the copy is the record. Bookings from BEFORE this file have
--      set lines with no copy; every screen falls back to the shared set for
--      them, as it always has, and the menu page offers to make the copy.
--   4. Round 2 — copying from a past booking and printing — fits without a
--      rewrite: source_event_menu_id is already here for the first, and the
--      rows already carry section, order and note for the second.
--
-- WHAT IT CHANGES
--   a. catering_event_menus gains set_name TEXT (the set's name as the
--      booking knows it — snapshot on copy, typed for a custom set), and its
--      one-target CHECK widens so a line may be: a shared set (set_menu_id),
--      a custom set (set_name alone), or a single dish (menu_id) — exactly
--      one of the three. Every existing row already satisfies it, and ADD
--      CONSTRAINT proves that or aborts the file.
--   b. NEW TABLE catering_event_menu_items, with RLS enabled and its policies
--      created in this same transaction: owner, admin and sales READ; owner
--      and admin WRITE; and for anyone else a locked booking's rows are
--      read-only — the sales-limits shape, so a later decision to let sales
--      edit is one policy change.
--   c. catering_copy_set_menu(uuid): the ONE way a copy is made. SECURITY
--      DEFINER, so a sales session — which may not write the table — can
--      still get the verbatim copy when it picks a set for a booking. It
--      refuses a locked booking, a line that is not a shared set, and a line
--      that already has a copy — by the line's set_name marker, not its row
--      count, so a copy emptied to rebuild it is still a copy (returns 0,
--      overwrites nothing).
--
-- WHO MAY DO WHAT, matching src/lib/event-menu-access.ts
--   owner, admin   read and write the copy; make the copy
--   sales          read the copy; make the copy by picking a set (the function)
--   everyone else  nothing
--   a locked booking's copy is frozen for everyone below owner/admin at the
--   database, and for everyone including them in the app (assertCostNotLocked)
--
-- CHANGES NO DATA. It reads existing rows to validate the CHECK and to clone
-- a test booking inside a block that is always rolled back. Nothing existing
-- is written.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: ALTER TABLE ADD COLUMN; ALTER
-- TABLE DROP CONSTRAINT + ADD CONSTRAINT (catering_event_menus_one_target,
-- recreated wider); CREATE TABLE (RLS enabled three statements later, before
-- COMMIT); CREATE INDEX ×3; CREATE FUNCTION; DROP/CREATE POLICY ×5; COMMENT
-- ×3. Anything else is unexpected. It deletes nothing and drops no table.
-- ============================================================================

BEGIN;

-- ── Test scaffolding: notes in a session setting, never a table ────────────

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  PERFORM set_config('event_menu.log',
    COALESCE(current_setting('event_menu.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('event_menu.log', true), '');
BEGIN
  PERFORM set_config('event_menu.log', '', false);
  RETURN QUERY
    SELECT r.i, r.l
      FROM regexp_split_to_table(v_log, chr(30)) WITH ORDINALITY AS r(l, i)
     WHERE r.l <> ''
     ORDER BY r.i;
END
$fn$;

-- How many lines the result table holds RIGHT NOW. Step 3 checks this against
-- the number the file is supposed to emit: a block that runs and reports
-- nothing is worse than one that fails, and that is exactly what happened on
-- 2026-09-19 (8 rows of 31, no error, and the file applied on that showing).
CREATE OR REPLACE FUNCTION pg_temp.logged()
RETURNS bigint
LANGUAGE sql
STABLE
AS $fn$
  SELECT count(*)
    FROM regexp_split_to_table(COALESCE(current_setting('event_menu.log', true), ''), chr(30)) AS l
   WHERE l <> '';
$fn$;

-- Runs one statement as one account and ALWAYS rolls it back (a private
-- SQLSTATE, caught). Returns the identity it actually ran as, first.
CREATE OR REPLACE FUNCTION pg_temp.probe(p_who uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_role text;
  v_n    bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_who::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', p_who::text, true);
    PERFORM set_config('role', 'authenticated', true);
    v_role := CASE WHEN current_user::text = 'authenticated'
                   THEN COALESCE(public.current_role(), 'no-profile')
                   ELSE 'not-authenticated' END;
    IF p_sql ~* '^\s*select' THEN
      EXECUTE 'SELECT count(*) FROM (' || p_sql || ') q' INTO v_n;
    ELSE
      EXECUTE p_sql;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'U0001';
  EXCEPTION
    WHEN SQLSTATE 'U0001' THEN
      RETURN v_role || ' rows=' || v_n;
    WHEN check_violation THEN
      RETURN COALESCE(v_role, '?') || ' check-refused';
    WHEN unique_violation THEN
      RETURN COALESCE(v_role, '?') || ' unique-refused';
    WHEN insufficient_privilege THEN
      -- WHICH table refused, not just that something did. Taken from the
      -- applied catering_sales_limits/history harness: a refusal from a
      -- policy on ANOTHER table would otherwise read as the expected
      -- "denied" and the negative control would pass for the wrong reason.
      IF SQLERRM LIKE '%row-level security%' THEN
        RETURN COALESCE(v_role, '?') || ' denied:'
          || COALESCE(substring(SQLERRM from 'table "([^"]+)"'), '?');
      END IF;
      RETURN COALESCE(v_role, '?') || ' error 42501 ' || SQLERRM;
    WHEN raise_exception THEN
      -- The copy function's own refusals (P0001). The message is recorded
      -- separately so the table stays one word per outcome.
      PERFORM set_config('event_menu.last_refusal', SQLERRM, true);
      RETURN COALESCE(v_role, '?') || ' refused';
    WHEN OTHERS THEN
      RETURN COALESCE(v_role, '?') || ' error ' || SQLSTATE || ' ' || SQLERRM;
  END;
END
$fn$;

-- One assertion: raises — so the whole file rolls back — when the account it
-- ran as is not the one meant, or the answer is not one of p_want.
-- The table a write statement names. NO BACKSLASH APPEARS IN THIS PATTERN,
-- on purpose: POSIX classes say what \s and \w say, and cannot be silently
-- de-escaped on the way into this file. The first corrected run died exactly
-- there (2026-09-19) — the pattern arrived as 'inserts+into', matched
-- nothing, and every refusal was then attributed to "another table".
CREATE OR REPLACE FUNCTION pg_temp.sql_target(p_sql text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT lower((regexp_match(p_sql,
    '(?:insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(?:[[:alnum:]_]+[.])?([[:alnum:]_]+)',
    'i'))[1]);
$fn$;

-- One probe result, in the vocabulary the expectations use.
--
-- A refusal counts as 'denied' ONLY when it came from the table the statement
-- writes to. A refusal from anywhere else is a different fact and must not
-- pass as this one — that discrimination is the point of the whole helper.
-- And a refusal that cannot be attributed at all RAISES rather than guessing:
-- a broken pattern then stops the file at the first probe, loudly, instead of
-- mislabelling every refusal after it.
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

CREATE OR REPLACE FUNCTION pg_temp.t(p_label text, p_who uuid, p_role text, p_sql text, p_want text[])
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_got  text := pg_temp.probe(p_who, p_sql);
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
--
-- Every negative control below rests on one claim: that a refusal is
-- attributed to the table that made it. Twice now that machinery has been
-- wrong — once silently right, once loudly wrong — so it is proved here,
-- both ways, on the SAME function the probes use, before a single test write
-- happens. If either direction breaks, the file stops with nothing applied.

DO $do$
DECLARE
  v_here  constant text := 'INSERT INTO public.catering_event_menu_items (event_id) VALUES (NULL)';
  v_ok    boolean := false;
BEGIN
  -- X1. A refusal FROM THE TABLE UNDER TEST reads as 'denied' — for each
  --     statement shape a probe can send.
  IF pg_temp.sql_target(v_here) IS DISTINCT FROM 'catering_event_menu_items'
     OR pg_temp.sql_target('UPDATE public.catering_event_menu_items SET quantity = 1 WHERE id = NULL') IS DISTINCT FROM 'catering_event_menu_items'
     OR pg_temp.sql_target('DELETE FROM public.catering_event_menu_items WHERE id = NULL') IS DISTINCT FROM 'catering_event_menu_items'
     OR pg_temp.sql_target('insert into catering_event_menu_items (event_id) values (NULL)') IS DISTINCT FROM 'catering_event_menu_items' THEN
    RAISE EXCEPTION 'FAIL    X1 the harness cannot read the table out of a statement (insert/update/delete, with or without the schema). Nothing applied.';
  END IF;
  IF pg_temp.classify('denied:catering_event_menu_items', v_here) IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'FAIL    X1 a refusal from the table under test was not read as "denied": got %. Nothing applied.',
      pg_temp.classify('denied:catering_event_menu_items', v_here);
  END IF;
  PERFORM pg_temp.note('ok      X1 a refusal from the table under test reads as "denied" (insert, update, delete, with and without the schema)');

  -- X2. A refusal from ANOTHER table does not, and one that cannot be
  --     attributed raises instead of being classified.
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
  -- And a result that is not a refusal passes through untouched.
  IF pg_temp.classify('rows=1', v_here) IS DISTINCT FROM 'rows=1' THEN
    RAISE EXCEPTION 'FAIL    X2 a non-refusal was rewritten. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      X2 a refusal from another table is not "denied", an unattributable one raises, and a non-refusal is untouched');
END
$do$;

-- ── Step 0: what is live, and the accounts and rows the tests need ─────────

DO $do$
DECLARE
  v_owner     uuid;
  v_admin     uuid;
  v_sales     uuid;
  v_has       boolean;
  v_items     bigint;
  v_uncopied  bigint;
  v_set_lines bigint;
BEGIN
  PERFORM 'public.current_role()'::regprocedure;
  BEGIN
    PERFORM 'public.catering_event_unlocked(uuid)'::regprocedure;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'catering_event_unlocked(uuid) is missing: catering_sales_limits_migration.sql has not run. Nothing changed.';
  END;
  IF to_regclass('public.catering_event_menus') IS NULL OR to_regclass('public.catering_set_menu_items') IS NULL THEN
    RAISE EXCEPTION 'the catering tables are missing. Nothing changed.';
  END IF;

  SELECT id INTO v_owner FROM public.profiles WHERE role = 'owner' ORDER BY id LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY id LIMIT 1;
  SELECT id INTO v_sales FROM public.profiles WHERE role = 'sales' ORDER BY id LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL OR v_sales IS NULL THEN
    RAISE EXCEPTION 'need one owner, one admin and one sales profile to test as; found owner %, admin %, sales %. Nothing changed.',
      v_owner, v_admin, v_sales;
  END IF;
  PERFORM set_config('event_menu.owner', v_owner::text, false);
  PERFORM set_config('event_menu.admin', v_admin::text, false);
  PERFORM set_config('event_menu.sales', v_sales::text, false);

  -- ── The survey, and the trap its first version fell into ────────────────
  --
  -- PL/PGSQL PARSES A WHOLE STATEMENT BEFORE IT EVALUATES ANYTHING INSIDE IT.
  -- A guard written INTO the statement —
  --   NOT v_has OR NOT EXISTS (SELECT 1 FROM public.catering_event_menu_items ...)
  -- — is therefore no guard at all: the planner resolves every table name
  -- first, so on a machine where that table does not exist yet the statement
  -- fails with 42P01 whatever the boolean says. That is exactly how this
  -- file aborted on its first run (Nik, 2026-09-19); nothing was applied,
  -- the transaction rolled back clean, and the fix is below.
  --
  -- So: every probe that names an object THIS FILE CREATES is DYNAMIC, and
  -- runs only when to_regclass has already found the object. Probes that
  -- name tables which have existed for months stay static — they cannot
  -- fail this way, and dynamic SQL would only hide their typos until run
  -- time. The same rule applies to the new COLUMN: `set_name` is probed
  -- through information_schema, which is a table that always exists.
  v_has := to_regclass('public.catering_event_menu_items') IS NOT NULL;
  SELECT count(*) INTO v_set_lines FROM public.catering_event_menus WHERE set_menu_id IS NOT NULL;
  IF v_has THEN
    EXECUTE 'SELECT count(*) FROM public.catering_event_menu_items' INTO v_items;
    EXECUTE $q$SELECT count(*) FROM public.catering_event_menus m
                WHERE m.set_menu_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM public.catering_event_menu_items i
                                   WHERE i.event_menu_id = m.id)$q$ INTO v_uncopied;
  ELSE
    -- No table, so no copies: every set line is one that falls back to the
    -- shared set. The first run reports the pre-feature state truthfully.
    v_items := 0;
    v_uncopied := v_set_lines;
  END IF;

  PERFORM pg_temp.note(format('before  catering_event_menu_items exists: %s (a re-run says true)', v_has));
  PERFORM pg_temp.note(format('before  catering_event_menus.set_name exists: %s',
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'catering_event_menus' AND column_name = 'set_name')));
  PERFORM pg_temp.note(format('before  copies already stored: %s row(s)', v_items));
  PERFORM pg_temp.note(format('before  set lines with no copy (they fall back to the shared set): %s of %s', v_uncopied, v_set_lines));
  PERFORM set_config('event_menu.n_events',   (SELECT count(*) FROM public.catering_events)::text, false);
  -- Every menu line, not just the set lines: this is the invariant Step 3
  -- checks, and v_set_lines counts only the ones with a shared set.
  PERFORM set_config('event_menu.n_lines',    (SELECT count(*) FROM public.catering_event_menus)::text, false);
  PERFORM set_config('event_menu.n_charges',  (SELECT count(*) FROM public.catering_event_charges)::text, false);
  PERFORM set_config('event_menu.n_items',    v_items::text, false);
END
$do$;

-- ── Step 1a: the set line learns its own name, and may be a custom set ─────

ALTER TABLE public.catering_event_menus
  ADD COLUMN IF NOT EXISTS set_name TEXT;

COMMENT ON COLUMN public.catering_event_menus.set_name IS
  'The set''s name as THIS booking knows it: a snapshot of catering_set_menus.name '
  'taken when the dishes were copied (catering_copy_set_menu), or the name typed for a '
  'custom set that has no shared source. NULL on set lines from before the copy existed '
  '(they fall back to the shared set) and on single-dish lines. Catering per-event menus, '
  '2026-09-19.';

-- Exactly one of: a shared set (set_menu_id), a custom set (set_name alone),
-- a single dish (menu_id). Recreated by name; the old constraint allowed the
-- first and third only. ADD CONSTRAINT validates every existing row.
ALTER TABLE public.catering_event_menus DROP CONSTRAINT IF EXISTS catering_event_menus_one_target;
ALTER TABLE public.catering_event_menus ADD CONSTRAINT catering_event_menus_one_target
  CHECK ((set_menu_id IS NOT NULL OR set_name IS NOT NULL) <> (menu_id IS NOT NULL));

-- ── Step 1b: the copy ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.catering_event_menu_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalised from the line so the lock policies and every read are one
  -- predicate on event_id, as they are for menus and charges.
  event_id             UUID NOT NULL REFERENCES public.catering_events(id) ON DELETE CASCADE,
  event_menu_id        UUID NOT NULL REFERENCES public.catering_event_menus(id) ON DELETE CASCADE,
  menu_id              UUID NOT NULL REFERENCES public.menus(id) ON DELETE RESTRICT,
  quantity             NUMERIC NOT NULL DEFAULT 1 CHECK (quantity > 0),
  section              TEXT NOT NULL DEFAULT 'dish' CHECK (section IN ('dish', 'dessert', 'drink', 'free')),
  sort_order           INTEGER NOT NULL DEFAULT 0,
  note                 TEXT,
  -- Provenance, never a live reference: which shared set this course was
  -- copied from (NULL when added from scratch). SET NULL if that set goes.
  source_set_menu_id   UUID REFERENCES public.catering_set_menus(id) ON DELETE SET NULL,
  -- Round 2: which past booking's line this was copied from. Unused in round
  -- 1, here so round 2 needs no ALTER.
  source_event_menu_id UUID REFERENCES public.catering_event_menus(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_menu_id, menu_id)
);

CREATE INDEX IF NOT EXISTS idx_catering_event_menu_items_event ON public.catering_event_menu_items(event_id);
CREATE INDEX IF NOT EXISTS idx_catering_event_menu_items_line  ON public.catering_event_menu_items(event_menu_id);
CREATE INDEX IF NOT EXISTS idx_catering_event_menu_items_menu  ON public.catering_event_menu_items(menu_id);

ALTER TABLE public.catering_event_menu_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.catering_event_menu_items IS
  'A booking''s OWN menu: the dishes copied into it from a shared set menu (catering_copy_set_menu) '
  'or added from scratch, one row per course, keyed by the booking''s set line (event_menu_id). '
  'The copy is the record — editing it never touches catering_set_menu_items, and a shared set '
  'changing later never changes what a past booking shows. quantity is per table, as in '
  'catering_set_menu_items. Read by owner, admin and sales; edited by owner and admin '
  '(src/lib/event-menu-access.ts). The one write a sales session has is the verbatim copy, through '
  'catering_copy_set_menu when it picks a set for a booking. Frozen with the booking''s cost lock. 2026-09-19.';

-- Who reads: the three catering roles, as every catering table.
DROP POLICY IF EXISTS catering_event_menu_items_read ON public.catering_event_menu_items;
CREATE POLICY catering_event_menu_items_read ON public.catering_event_menu_items
  FOR SELECT TO authenticated
  USING (public.current_role() IN ('owner', 'admin', 'sales'));

-- Who writes: owner and admin. Sales has NO permissive write policy, so an
-- INSERT is denied and an UPDATE or DELETE touches no row. The verbatim copy
-- a sales session gets when it picks a set goes through the function below.
DROP POLICY IF EXISTS catering_event_menu_items_admin_write ON public.catering_event_menu_items;
CREATE POLICY catering_event_menu_items_admin_write ON public.catering_event_menu_items
  FOR ALL TO authenticated
  USING      (public.current_role() IN ('owner', 'admin'))
  WITH CHECK (public.current_role() IN ('owner', 'admin'));

-- The cost lock, the sales-limits shape: for anyone but owner and admin a
-- locked booking's rows are read-only. Owner and admin are exempt here as
-- they are on menus and charges — the app refuses them too, and they unlock
-- on the cost page first. Restrictive, so it can only narrow the above; it
-- matters the day sales is let in above, and it is already in place.
DROP POLICY IF EXISTS catering_event_menu_items_lock_insert ON public.catering_event_menu_items;
CREATE POLICY catering_event_menu_items_lock_insert ON public.catering_event_menu_items
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

DROP POLICY IF EXISTS catering_event_menu_items_lock_update ON public.catering_event_menu_items;
CREATE POLICY catering_event_menu_items_lock_update ON public.catering_event_menu_items
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id))
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

DROP POLICY IF EXISTS catering_event_menu_items_lock_delete ON public.catering_event_menu_items;
CREATE POLICY catering_event_menu_items_lock_delete ON public.catering_event_menu_items
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

-- ── Step 1c: the one way a copy is made ────────────────────────────────────
--
-- SECURITY DEFINER so that a sales session, which may not write the table,
-- still gets the verbatim copy when it picks a set for a booking — and gets
-- nothing else: the function copies, it does not edit. Its own checks stand
-- in for the policies it bypasses.

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
    (event_id, event_menu_id, menu_id, quantity, section, sort_order, note, source_set_menu_id)
  SELECT v_event, p_event_menu_id, i.menu_id, i.quantity, i.section, i.sort_order, i.note, v_set
    FROM public.catering_set_menu_items i
   WHERE i.set_menu_id = v_set
   ORDER BY i.sort_order, i.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.catering_event_menus SET set_name = COALESCE(set_name, v_set_name, 'ชุดเมนู') WHERE id = p_event_menu_id;
  RETURN v_n;
END
$fn$;

COMMENT ON FUNCTION public.catering_copy_set_menu(uuid) IS
  'Copies the shared set menu a booking''s set line points at into catering_event_menu_items, '
  'verbatim, and stamps set_name. Callable by owner, admin and sales (the app calls it when a '
  'set is picked for a booking). Refuses a locked booking, a line with no shared set, and — '
  'returning 0 — a line that already has a copy. SECURITY DEFINER: its checks stand in for the '
  'write policies it bypasses. Catering per-event menus, 2026-09-19.';

-- ── Step 2: tests, as real accounts, every write rolled back ───────────────
--
-- Inside one block that ends by raising a private SQLSTATE, so the cloned
-- booking, its lines, the copies and the lock all go, whatever the outcome.

DO $do$
DECLARE
  owner_   uuid := current_setting('event_menu.owner')::uuid;
  admin_   uuid := current_setting('event_menu.admin')::uuid;
  sales_   uuid := current_setting('event_menu.sales')::uuid;
  marker   constant text := 'probe-event-menu';
  v_u      uuid;   -- an UNLOCKED real booking with a set line, cloned — never written
  v_cols   text;
  v_e      uuid;   -- the clone
  v_l1     uuid;   -- clone's set line, given a copy by this session
  v_l2     uuid;   -- clone's second set line, no copy: what the function is tested on
  v_set    uuid;
  v_n_shared integer;
  v_item   uuid;
  v_dish   uuid;   -- a dish not in the set, for the add and swap tests
  v_n      integer;
  -- THE RESULTS, CARRIED OUT OF THE ROLLBACK BY HAND.
  --
  -- pg_temp.note() accumulates into a session setting, and a session setting
  -- is TRANSACTIONAL: set_config's third argument decides whether a value
  -- survives COMMIT, not whether it survives ABORT. The block below always
  -- aborts — that is how its test writes are undone — so on 2026-09-19 it
  -- took all twenty test rows down with them: the file printed 8 rows of 31,
  -- raised nothing, and was applied on that showing.
  --
  -- A PL/pgSQL VARIABLE is not transactional ("the local variables remain as
  -- they were when the error occurred, but all changes to persistent database
  -- state within the block are rolled back"). So the log is read into one on
  -- the last line before the abort, and put back in the handler. The writes
  -- are still undone; only the record of them survives.
  v_log    text;
BEGIN
  BEGIN
    -- The real booking to clone: unlocked, with a set line whose set has dishes.
    SELECT e.id, m.set_menu_id INTO v_u, v_set
      FROM public.catering_events e
      JOIN public.catering_event_menus m ON m.event_id = e.id AND m.set_menu_id IS NOT NULL
      JOIN public.catering_set_menu_items i ON i.set_menu_id = m.set_menu_id
     WHERE e.cost_locked_at IS NULL
     ORDER BY e.id, m.id LIMIT 1;
    IF v_u IS NULL THEN
      RAISE EXCEPTION 'no unlocked booking with a set line whose set has dishes — the tests have nothing to clone. Nothing applied.';
    END IF;
    SELECT count(*) INTO v_n_shared FROM public.catering_set_menu_items WHERE set_menu_id = v_set;
    SELECT d.id INTO v_dish FROM public.menus d
     WHERE NOT EXISTS (SELECT 1 FROM public.catering_set_menu_items i WHERE i.set_menu_id = v_set AND i.menu_id = d.id)
     ORDER BY d.id LIMIT 1;
    IF v_dish IS NULL THEN
      RAISE EXCEPTION 'every dish is already in the test set; nothing to add or swap in. Nothing applied.';
    END IF;

    -- Clone the booking as this session (the same technique as the sales-limits file).
    SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO v_cols
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = 'catering_events'
       AND c.is_generated = 'NEVER' AND c.is_identity = 'NO'
       AND c.column_name NOT IN ('id', 'cost_locked_at', 'quote_number', 'created_at', 'updated_at', 'detail_note');
    EXECUTE format('INSERT INTO public.catering_events (%s, detail_note) SELECT %s, %L FROM public.catering_events WHERE id = %L RETURNING id',
      v_cols, v_cols, marker, v_u) INTO v_e;
    INSERT INTO public.catering_event_menus (event_id, set_menu_id, quantity, sort_order, note)
      VALUES (v_e, v_set, 10, 10, marker) RETURNING id INTO v_l1;
    INSERT INTO public.catering_event_menus (event_id, set_menu_id, quantity, sort_order, note)
      VALUES (v_e, v_set, 2, 20, marker) RETURNING id INTO v_l2;
    -- L1 gets its copy from this session, so the probes below have rows to read and write.
    INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id, quantity, section, sort_order, note, source_set_menu_id)
      SELECT v_e, v_l1, i.menu_id, i.quantity, i.section, i.sort_order, i.note, v_set
        FROM public.catering_set_menu_items i WHERE i.set_menu_id = v_set;
    UPDATE public.catering_event_menus SET set_name = (SELECT name FROM public.catering_set_menus WHERE id = v_set) WHERE id = v_l1;
    SELECT id INTO v_item FROM public.catering_event_menu_items WHERE event_menu_id = v_l1 ORDER BY sort_order, id LIMIT 1;

    -- ── The copy function, as sales (the account that picks sets for bookings) ──
    PERFORM pg_temp.t('C1 sales copies a set into a booking (rows copied = the set''s dishes)', sales_, 'sales',
      format($q$SELECT 1 WHERE public.catering_copy_set_menu(%L) = %s$q$, v_l2, v_n_shared), ARRAY['rows=1']);
    PERFORM pg_temp.t('C2 copying a line that already has a copy changes nothing (returns 0)', sales_, 'sales',
      format($q$SELECT 1 WHERE public.catering_copy_set_menu(%L) = 0$q$, v_l1), ARRAY['rows=1']);
    -- An absence must not read as a pass: with no single-dish line to point
    -- at, the check is recorded as skipped, not as refused.
    IF EXISTS (SELECT 1 FROM public.catering_event_menus m WHERE m.menu_id IS NOT NULL) THEN
      PERFORM pg_temp.t('C3 copying a single-dish line is refused', admin_, 'admin',
        format($q$SELECT public.catering_copy_set_menu(%L)$q$,
          (SELECT m.id FROM public.catering_event_menus m WHERE m.menu_id IS NOT NULL ORDER BY m.id LIMIT 1)),
        ARRAY['refused']);
    ELSE
      PERFORM pg_temp.note('skip    C3 copying a single-dish line is refused — no single-dish line exists to test against');
    END IF;

    -- C4 — the review's hole: a copy emptied to zero rows must still be a copy.
    -- Before the fix the function saw no rows and re-copied the shared set.
    DELETE FROM public.catering_event_menu_items WHERE event_menu_id = v_l1;
    PERFORM pg_temp.t('C4 an emptied copy is not re-copied from the shared set (returns 0)', sales_, 'sales',
      format($q$SELECT 1 WHERE public.catering_copy_set_menu(%L) = 0$q$, v_l1), ARRAY['rows=1']);
    INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id, quantity, section, sort_order, note, source_set_menu_id)
      SELECT v_e, v_l1, i.menu_id, i.quantity, i.section, i.sort_order, i.note, v_set
        FROM public.catering_set_menu_items i WHERE i.set_menu_id = v_set;
    SELECT id INTO v_item FROM public.catering_event_menu_items WHERE event_menu_id = v_l1 ORDER BY sort_order, id LIMIT 1;

    -- ── Reads ──
    PERFORM pg_temp.t('R1 sales reads the booking''s copy', sales_, 'sales',
      format($q$SELECT id FROM public.catering_event_menu_items WHERE event_id = %L$q$, v_e), ARRAY['rows=' || v_n_shared]);
    PERFORM pg_temp.t('R2 admin reads it', admin_, 'admin',
      format($q$SELECT id FROM public.catering_event_menu_items WHERE event_id = %L$q$, v_e), ARRAY['rows=' || v_n_shared]);

    -- ── Writes: sales may not, owner and admin may (unlocked) ──
    PERFORM pg_temp.t('W1 sales changes a course', sales_, 'sales',
      format($q$UPDATE public.catering_event_menu_items SET quantity = quantity WHERE id = %L$q$, v_item), ARRAY['rows=0']);
    PERFORM pg_temp.t('W2 sales removes a course', sales_, 'sales',
      format($q$DELETE FROM public.catering_event_menu_items WHERE id = %L$q$, v_item), ARRAY['rows=0']);
    PERFORM pg_temp.t('W3 sales adds a course', sales_, 'sales',
      format($q$INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id) VALUES (%L, %L, %L)$q$, v_e, v_l1, v_dish), ARRAY['denied']);
    PERFORM pg_temp.t('W4 admin swaps a course', admin_, 'admin',
      format($q$UPDATE public.catering_event_menu_items SET menu_id = %L WHERE id = %L$q$, v_dish, v_item), ARRAY['rows=1']);
    PERFORM pg_temp.t('W5 owner adds a course', owner_, 'owner',
      format($q$INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id) VALUES (%L, %L, %L)$q$, v_e, v_l1, v_dish), ARRAY['rows=1']);
    PERFORM pg_temp.t('W6 admin removes a course', admin_, 'admin',
      format($q$DELETE FROM public.catering_event_menu_items WHERE id = %L$q$, v_item), ARRAY['rows=1']);
    PERFORM pg_temp.t('W7 the same dish twice in one set is refused (UNIQUE)', admin_, 'admin',
      format($q$INSERT INTO public.catering_event_menu_items (event_id, event_menu_id, menu_id)
               SELECT %L, %L, menu_id FROM public.catering_event_menu_items WHERE id = %L$q$, v_e, v_l1, v_item), ARRAY['unique-refused']);

    -- ── The copy never writes back: the shared set is unchanged by all of the above ──
    IF (SELECT count(*) FROM public.catering_set_menu_items WHERE set_menu_id = v_set) <> v_n_shared THEN
      RAISE EXCEPTION 'FAIL    the shared set changed during the tests. Nothing applied.';
    END IF;
    PERFORM pg_temp.note(format('ok      S1 the shared set still has %s dishes after every copy and edit above', v_n_shared));

    -- ── The widened CHECK ──
    PERFORM pg_temp.t('K1 a custom set line — a name, no shared set, no dish — is allowed', admin_, 'admin',
      format($q$INSERT INTO public.catering_event_menus (event_id, set_name, quantity, sort_order, note) VALUES (%L, %L, 1, 30, %L)$q$,
        v_e, 'ชุดพิเศษ 4,500', marker), ARRAY['rows=1']);
    PERFORM pg_temp.t('K2 a line naming both a set and a dish is refused', admin_, 'admin',
      format($q$INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order) VALUES (%L, %L, %L, 1, 40)$q$,
        v_e, v_set, v_dish), ARRAY['check-refused']);
    PERFORM pg_temp.t('K3 a line naming nothing is refused', admin_, 'admin',
      format($q$INSERT INTO public.catering_event_menus (event_id, quantity, sort_order) VALUES (%L, 1, 50)$q$, v_e), ARRAY['check-refused']);

    -- ── The lock: freeze the clone, then try again ──
    UPDATE public.catering_events SET cost_locked_at = now() WHERE id = v_e;
    PERFORM pg_temp.t('L1 sales copies a set into the LOCKED booking', sales_, 'sales',
      format($q$SELECT public.catering_copy_set_menu(%L)$q$, v_l2), ARRAY['refused']);
    PERFORM pg_temp.note('        (the refusal read: ' || COALESCE(current_setting('event_menu.last_refusal', true), '?') || ')');
    PERFORM pg_temp.t('L2 sales changes a course of the locked booking', sales_, 'sales',
      format($q$UPDATE public.catering_event_menu_items SET quantity = quantity WHERE event_menu_id = %L$q$, v_l1), ARRAY['rows=0']);
    PERFORM pg_temp.t('L3 admin changes a course of the locked booking (allowed at the database; the app refuses — it unlocks first)', admin_, 'admin',
      format($q$UPDATE public.catering_event_menu_items SET quantity = quantity WHERE id = (SELECT id FROM public.catering_event_menu_items WHERE event_menu_id = %L ORDER BY id LIMIT 1)$q$, v_l1), ARRAY['rows=1']);
    PERFORM pg_temp.t('L4 sales still READS the locked booking''s menu', sales_, 'sales',
      format($q$SELECT id FROM public.catering_event_menu_items WHERE event_id = %L$q$, v_e), ARRAY['rows=' || v_n_shared]);

    -- ── The cascade: removing the set line removes its copy ──
    DELETE FROM public.catering_event_menus WHERE id = v_l1;
    SELECT count(*) INTO v_n FROM public.catering_event_menu_items WHERE event_menu_id = v_l1;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'FAIL    % copied rows survived their set line. Nothing applied.', v_n;
    END IF;
    PERFORM pg_temp.note('ok      D1 deleting a set line takes its copy with it (ON DELETE CASCADE)');

    -- The last thing before the abort: take the results out of the setting
    -- and into memory, which the abort cannot reach.
    v_log := current_setting('event_menu.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      -- The database is back where it was; the record of what was proved is not.
      PERFORM set_config('event_menu.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back (the cloned booking, its lines, its copy, its lock)');
  END;
END
$do$;

-- ── Step 3: nothing the tests did survived them ────────────────────────────

DO $do$
DECLARE
  v_marker bigint;
  v_rows   bigint;
  -- Every row the file is supposed to emit, counted by hand and asserted
  -- below: 2 self-test, 4 survey, 20 permission tests (C3 emits a skip line
  -- instead when there is no single-dish line to point at), S1, the refusal
  -- text, D1, the rollback line, and Step 3's own. Change a test, change this.
  c_expected constant bigint := 31;
BEGIN
  SELECT count(*) INTO v_marker FROM public.catering_events WHERE detail_note = 'probe-event-menu';
  IF v_marker <> 0 THEN
    RAISE EXCEPTION 'FAIL    % test booking(s) remain. Nothing applied.', v_marker;
  END IF;
  IF (SELECT count(*) FROM public.catering_events)::text <> current_setting('event_menu.n_events')
     OR (SELECT count(*) FROM public.catering_event_menus)::text <> current_setting('event_menu.n_lines')
     OR (SELECT count(*) FROM public.catering_event_charges)::text <> current_setting('event_menu.n_charges')
     OR (SELECT count(*) FROM public.catering_event_menu_items)::text <> current_setting('event_menu.n_items') THEN
    RAISE EXCEPTION 'FAIL    a row count changed: events % → %, lines % → %, charges % → %, copies % → %. Nothing applied.',
      current_setting('event_menu.n_events'), (SELECT count(*) FROM public.catering_events),
      current_setting('event_menu.n_lines'), (SELECT count(*) FROM public.catering_event_menus),
      current_setting('event_menu.n_charges'), (SELECT count(*) FROM public.catering_event_charges),
      current_setting('event_menu.n_items'), (SELECT count(*) FROM public.catering_event_menu_items);
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.catering_event_menu_items'::regclass) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL    the new table does not have row level security enabled. Nothing applied.';
  END IF;
  PERFORM pg_temp.note(format('ok      counts unchanged (events %s, lines %s, charges %s, copies %s); RLS on; no test booking remains',
    current_setting('event_menu.n_events'), current_setting('event_menu.n_lines'),
    current_setting('event_menu.n_charges'), current_setting('event_menu.n_items')));

  -- ── The file checks that its own checks reported ────────────────────────
  --
  -- THREE FAILURES THIS WEEK CAME DOWN TO THE SAME THING: the file trusted
  -- that its checks had run. A survey that cannot parse, a mapping that
  -- cannot match, a block whose results are rolled back — none of them
  -- raised, and the last one was applied to production reporting success on
  -- evidence it never gathered. A count is the one thing that catches all
  -- three: whatever went wrong, the rows are missing.
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
  pg_temp.t(text, uuid, text, text, text[]),
  pg_temp.classify(text, text),
  pg_temp.sql_target(text),
  pg_temp.probe(uuid, text),
  pg_temp.logged(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs — in the app ════════════════════════════════════════════
--
-- 1. As SALES: open a booking, add a set menu × tables in the price box, save.
--    The new button รายการอาหารของงาน opens the event's menu: the set's dishes
--    are listed under the set line, marked คัดลอกจากชุด …, with the discount
--    against the dishes' own prices. No cost figure anywhere on the page.
-- 2. As the OWNER: the same page shows ต้นทุนอาหาร and % per set line. Swap
--    one course for a dish more than 10% dearer: the warning appears; confirm
--    anyway. The set-menu management screen (ชุดเมนู) is unchanged.
-- 3. Reopen the kitchen sheet and the function sheet for that booking: they
--    print the swapped dish. Open ชุดเมนู: the shared set still has the
--    original course.
-- 4. A booking from before today: its set line shows ยังใช้ชุดเมนูกลาง with a
--    คัดลอกมาเป็นของงานนี้ button (owner/admin). Its sheets print as before.
-- 5. On the cost page, lock a "done" booking: its menu page shows the frozen
--    banner and no controls, for the owner too.
