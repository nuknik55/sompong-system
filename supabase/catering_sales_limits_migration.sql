-- ============================================================================
-- Catering: what sales may write, and the cost lock (queue item 33)
-- ============================================================================
-- Run once in the Supabase SQL editor, the WHOLE FILE in one go, at a time
-- when nobody has a catering screen open (see LOCKS below). One
-- transaction: it records what it finds, makes its change, tests the result
-- AS REAL ACCOUNTS before COMMIT, and rolls back on any disagreement.
--
-- It closes three things a sales login could do by calling the database
-- directly, although the app never offers them:
--   1. SET MENUS: change a set menu's price or items, add one, or delete
--      one. Every set-menu screen in the app is admin-only. Now only owner
--      and admin write set menus and their items; sales still reads them.
--   2. THE COST LOCK: clear an event's cost lock, lock one, or change or
--      delete a locked event's own row, its menu lines or its charges.
--      Only the admin lock and unlock actions are meant to touch the lock.
--      Now, for sales, those rows of a locked event are read-only, and
--      cost_locked_at stays empty on every event row sales writes. Owner
--      and admin are not limited here.
--      NOT covered: a locked event's staff list (catering_event_staff),
--      and two foreign-key actions, which row-level security does not
--      apply to: deleting a customer clears that customer from its events,
--      locked ones included; and deleting a menu line deletes every charge
--      linked to it, even a charge of another event. The app only ever
--      links a charge to a line of its own event, so the second needs a
--      link planted in advance by a direct call.
--   3. THE ACTIVITY HISTORY: rewrite or delete an event's history, or add a
--      line under someone else's name or with a date of one's choosing.
--      Now the history is append-only through the API, for EVERY role (the
--      app only ever adds and reads lines), and a new line must name the
--      caller as its author and carry the time of its own insert (the
--      column's default, which Step 0 checks). Deleting an unlocked event
--      still removes its history with it: a foreign-key cascade, which
--      row-level security does not apply to.
--
-- The app change that goes with it (deleteCateringEvent checks the lock
-- first and says why it refuses) should be deployed with this file or
-- before it. Neither needs the other, but until the app change is live, a
-- sales delete of a locked booking does nothing and says nothing: the
-- booking simply stays in the list.
--
-- ── WHAT IT CHANGES, AND WHAT IT DOES NOT ─────────────────────────────────
--
-- Committed: 18 restrictive policies and one new function,
-- catering_event_unlocked(uuid). Nothing else. Plain reads are unchanged;
-- a read that locks rows (SELECT ... FOR UPDATE) now also follows the write
-- rules, and nothing in the app reads that way.
--
-- NO DATA IS CHANGED AND NO TABLE IS CREATED. Every test write happens
-- inside a block that is always rolled back, so none of it is ever
-- committed or seen by another session: the lock the tests put on event E,
-- the unlock of event U (which clears a real lock if U has one, and gives
-- it back), and every test insert, update and delete. Most test writes
-- touch one row; a delete also removes what hangs off the deleted row (an
-- event's lines and history, a set menu's items, a menu line's charge),
-- inside the same rolled-back block. The last check before COMMIT confirms
-- it: no event carries the test lock; no row carries the tests' marker,
-- which every test insert writes; and the second run of the checks, made
-- while this file holds all six tables, left their row counts and U's lock
-- as it found them. (The first run happens before the tables are held, so
-- its deletes cannot be counted; it uses the same rolled-back block.) The
-- results are kept in settings of this session, not in a table, and are
-- cleared at the end.
--
-- What the SQL editor may call destructive, all of it expected:
--   - 18 DROP POLICY IF EXISTS: each policy this file creates is dropped by
--     name first, so the file can run again. No existing policy is removed.
--   - DROP FUNCTION IF EXISTS pg_temp.*, at the end: this session's test
--     helpers. The one that prints the result stays, empty, until the
--     session ends.
--   - The UPDATE, DELETE and INSERT statements inside the test functions,
--     the lock on E and the unlock on U included: all rolled back, as above.
-- Anything else it calls destructive is NOT expected: stop and send it.
--
-- THE RESULT is the table the last statement prints: one row per finding
-- and per test, before and after, with "ok" on every judged row. It has
-- 130 rows plus one per existing policy on the eight tables Step 0
-- lists (8 if the database matches this repository; a re-run lists the 18
-- new ones too). Copy it back whole. If the file fails, the editor shows
-- that error instead and nothing is applied. Running the whole file again
-- is safe.
--
-- LOCKS: each policy change locks its table until COMMIT, so a catering
-- screen loading at that moment waits for the file, or, rarely, the
-- database stops one of the two with a deadlock error. If the file is the
-- one stopped, nothing was applied: run it again.
--
-- ── WHY RESTRICTIVE POLICIES ───────────────────────────────────────────────
--
-- The existing policies (catering_*_rw) admit owner, admin and sales and
-- are left as they are. A RESTRICTIVE policy is AND-ed with every
-- permissive one, including any the live database holds that the repo does
-- not show, so these caps hold whatever else exists.
--
-- ── HOW THE CHECKS CAN FAIL ────────────────────────────────────────────────
--
-- Every test runs twice, before and after the change. "before" lines are
-- printed, not judged; on a first run they show the holes (for example
-- "before  L1 sale unlocks the locked event — sales rows=1"). "after" lines
-- are judged. Each test prints the role it actually ran as, and a wrong
-- role stops the file. Every row a test names is looked up first by this
-- session and passed in by id, and the same account is shown able to read
-- it, so "blocked" means the policy, not a row the account cannot see.
--
-- The negative controls are the SALES account, the population the rule is
-- about (and admin and owner for the history, which is closed to
-- everyone). The positive controls come from the same account (reading,
-- and every write the booking screen makes on an unlocked event, a new
-- booking included) and from admin and owner, who keep their reach.
-- L25 counts U's history itself, before the delete and after it, because a
-- statement reports only its own rows and cannot show what a cascade
-- removed. A "soft" test is a positive one whose statement may fail for a
-- reason that is not a policy (a constraint this repository does not
-- show): it then prints NOT DEMONSTRATED instead of stopping the file, but
-- a policy refusal still stops it. The end of this file says which app
-- check covers each soft test.
--
-- The tests use two real events with menu lines and charges, each the
-- first such event by id: U, which also has history lines, and E, another
-- one. E is locked and U unlocked for the duration of the tests. Nothing
-- about either survives the run.
--
-- Accounts used (checked first):
--   Owner   6c8a428c-386b-40f9-9758-c643b7219815  owner
--   admin   c0d216ea-941b-44fc-b19c-f330fb9a4efd  admin
--   sale    bcfc52ef-740f-40b1-8b24-d533585dcb4a  sales
-- ============================================================================


-- ── The results, for this session only ─────────────────────────────────────
--
-- Kept in a setting of this session, not in a table: no other session can
-- read it, the last statement clears it, and it ends with the session.
-- (A setting changed inside a transaction that fails is undone with it,
-- exactly as rows in a table would be.)

SELECT set_config('catering_limits.log', '', false);

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  -- Separated by chr(30), not a newline: a note can itself span lines (a
  -- function definition, a policy expression) and must stay one row.
  PERFORM set_config('catering_limits.log',
    COALESCE(current_setting('catering_limits.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

-- Prints the recorded lines, in order, and clears the setting.
CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('catering_limits.log', true), '');
BEGIN
  PERFORM set_config('catering_limits.log', '', false);
  RETURN QUERY
    SELECT r.i, r.l
      FROM regexp_split_to_table(v_log, chr(30)) WITH ORDINALITY AS r(l, i)
     WHERE r.l <> ''
     ORDER BY r.i;
END
$fn$;


-- ── The test events and the row counts, for this session only ─────────────
--
-- test_events() picks the two test events the same way every time it is
-- called. catering_counts() gives the row counts of the six tables this
-- file changes, for the check before COMMIT.

CREATE OR REPLACE FUNCTION pg_temp.test_events(OUT e uuid, OUT u uuid)
LANGUAGE sql
STABLE
AS $fn$
  WITH candidate AS (
    SELECT ev.id,
           EXISTS (SELECT 1 FROM public.catering_event_activity_log l WHERE l.event_id = ev.id) AS has_history
      FROM public.catering_events ev
     WHERE EXISTS (SELECT 1 FROM public.catering_event_menus m WHERE m.event_id = ev.id)
       AND EXISTS (SELECT 1 FROM public.catering_event_charges c WHERE c.event_id = ev.id)
  ), pick_u AS (
    SELECT id FROM candidate WHERE has_history ORDER BY id LIMIT 1
  )
  SELECT (SELECT c.id FROM candidate c WHERE c.id <> (SELECT id FROM pick_u) ORDER BY c.id LIMIT 1),
         (SELECT id FROM pick_u);
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.catering_counts()
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT format('set menus %s, set menu items %s, events %s, event menu lines %s, charges %s, history lines %s',
    (SELECT count(*) FROM public.catering_set_menus),
    (SELECT count(*) FROM public.catering_set_menu_items),
    (SELECT count(*) FROM public.catering_events),
    (SELECT count(*) FROM public.catering_event_menus),
    (SELECT count(*) FROM public.catering_event_charges),
    (SELECT count(*) FROM public.catering_event_activity_log));
$fn$;


-- ── Step 0: the accounts, the columns, the test rows, what is live ─────────

DO $do$
DECLARE
  r          record;
  v_bad      int := 0;
  v_default  text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('6c8a428c-386b-40f9-9758-c643b7219815'::uuid, 'owner', 'Owner'),
      ('c0d216ea-941b-44fc-b19c-f330fb9a4efd'::uuid, 'admin', 'admin'),
      ('bcfc52ef-740f-40b1-8b24-d533585dcb4a'::uuid, 'sales', 'sale')
    ) AS v(id, role, name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.id AND p.role = r.role) THEN
      RAISE WARNING 'account % (%) is no longer %', r.name, r.id, r.role;
      v_bad := v_bad + 1;
    END IF;
  END LOOP;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% account(s) changed since 2026-09-17, and the checks below depend on them. Nothing applied.', v_bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'catering_events'
                   AND column_name = 'cost_locked_at') THEN
    RAISE EXCEPTION 'catering_events.cost_locked_at does not exist. Nothing applied.';
  END IF;

  -- The history rule pins a new line's created_at to the time of the
  -- insert. That lets the app's inserts through only if the column's
  -- default IS that time; otherwise every history line would be refused.
  SELECT c.column_default INTO v_default
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'catering_event_activity_log'
     AND c.column_name = 'created_at';
  PERFORM pg_temp.note('live default of catering_event_activity_log.created_at: ' || COALESCE(v_default, '(none)'));
  IF v_default IS NULL OR v_default NOT IN ('now()', 'CURRENT_TIMESTAMP', 'transaction_timestamp()') THEN
    RAISE EXCEPTION 'catering_event_activity_log.created_at does not default to the time of the insert (%). Nothing applied.',
      COALESCE(v_default, 'no default');
  END IF;

  IF (SELECT t.e IS NULL OR t.u IS NULL FROM pg_temp.test_events() t)
     OR NOT EXISTS (SELECT 1 FROM public.catering_set_menu_items) THEN
    RAISE EXCEPTION 'the tests need two events with menu lines and charges, one of them with history lines, and a set menu with items. Nothing applied.';
  END IF;

  PERFORM pg_temp.note('live current_role(): ' || pg_get_functiondef('public.current_role()'::regprocedure));

  -- What is live on the six tables this file changes, and on the two
  -- cost tables beside them that it leaves alone: catering_event_labor,
  -- which the repository says sales cannot reach at all, and
  -- catering_event_cost_snapshots, whose owner-and-admin-only rule is in no
  -- file under supabase/ (queue item 33, "repo drift").
  FOR r IN
    SELECT tablename, policyname, permissive, cmd, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('catering_set_menus', 'catering_set_menu_items', 'catering_events',
                         'catering_event_menus', 'catering_event_charges', 'catering_event_activity_log',
                         'catering_event_labor', 'catering_event_cost_snapshots')
     ORDER BY 1, 2
  LOOP
    PERFORM pg_temp.note(format('existing: public.%s.%s [%s %s] TO %s USING %s WITH CHECK %s',
      r.tablename, r.policyname, r.permissive, r.cmd, r.roles,
      coalesce(r.qual, '-'), coalesce(r.with_check, '-')));
  END LOOP;

  PERFORM pg_temp.note(format('%s (locked events %s)', pg_temp.catering_counts(),
    (SELECT count(*) FROM public.catering_events WHERE cost_locked_at IS NOT NULL)));
END
$do$;


-- ── Test helpers, for this session only ────────────────────────────────────
--
-- probe() runs one statement as one account and ALWAYS rolls it back. It
-- returns "<who it ran as> <result>". Who: the account's profile role, or
-- anon for no session, read after the switch; anything else means the
-- switch did not take. Result: rows=N; denied:<table>, a row-level security
-- refusal and the table whose policy refused; or error <code> <message>.
-- A SELECT is counted; any other statement reports the rows it touched.

CREATE OR REPLACE FUNCTION pg_temp.probe(p_who uuid, p_sql text)
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_role text;
  v_n    bigint;
BEGIN
  BEGIN
    IF p_who IS NULL THEN
      PERFORM set_config('request.jwt.claims', '', true);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      PERFORM set_config('role', 'anon', true);
      v_role := current_user::text;
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', p_who::text, 'role', 'authenticated')::text, true);
      PERFORM set_config('request.jwt.claim.sub', p_who::text, true);
      PERFORM set_config('role', 'authenticated', true);
      v_role := CASE WHEN current_user::text = 'authenticated'
                     THEN COALESCE(public.current_role(), 'no-profile')
                     ELSE 'not-authenticated' END;
    END IF;
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
    WHEN insufficient_privilege THEN
      IF SQLERRM LIKE '%row-level security%' THEN
        RETURN COALESCE(v_role, '?') || ' denied:'
          || COALESCE(substring(SQLERRM from 'table "([^"]+)"'), '?');
      END IF;
      RETURN COALESCE(v_role, '?') || ' error 42501 ' || SQLERRM;
    WHEN OTHERS THEN
      RETURN COALESCE(v_role, '?') || ' error ' || SQLSTATE || ' ' || SQLERRM;
  END;
END
$fn$;

-- t() prints a "before" line, or judges an "after" line against p_want:
--   rows=N    exactly N rows
--   denied    refused by row-level security ON THE TABLE THE STATEMENT
--             WRITES; a refusal raised by another table's policy (a
--             trigger's write) counts as an error, not as this refusal
--   blocked   refused, or 0 rows
--   allowed   at least one row, or a foreign key refusal AFTER the policy let
--             the statement through
--   no-privilege  refused by a missing column or table privilege (not by
--             row-level security)
--   soft ...  the same, except that an error that is not a policy refusal
--             prints NOT DEMONSTRATED instead of stopping the file
CREATE OR REPLACE FUNCTION pg_temp.t(
  p_after boolean, p_label text, p_who uuid, p_role text, p_sql text, p_want text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_got  text := pg_temp.probe(p_who, p_sql);
  v_role text := split_part(v_got, ' ', 1);
  v_res  text := substr(v_got, length(split_part(v_got, ' ', 1)) + 2);
  v_soft boolean := p_want LIKE 'soft %';
  v_want text := CASE WHEN p_want LIKE 'soft %' THEN substr(p_want, 6) ELSE p_want END;
  v_table text := lower((regexp_match(p_sql,
    '(?:insert\s+into|update|delete\s+from)\s+(?:\w+\.)?(\w+)', 'i'))[1]);
  v_ok   boolean;
BEGIN
  IF NOT p_after THEN
    PERFORM pg_temp.note(format('before  %s — %s', p_label, v_got));
    RETURN;
  END IF;
  IF v_res = 'denied:' || v_table THEN
    v_res := 'denied';
  ELSIF v_res LIKE 'denied:%' THEN
    v_res := 'error (a policy on another table) ' || v_res;
  END IF;
  IF v_role IS DISTINCT FROM p_role THEN
    RAISE EXCEPTION '% — ran as %, expected %: the impersonation did not take, so the result means nothing. Nothing applied.',
      p_label, v_role, p_role;
  END IF;
  IF v_want = 'no-privilege' THEN
    IF v_res LIKE 'error 42501 permission denied%' THEN
      PERFORM pg_temp.note(format('ok      %s — %s', p_label, v_res));
      RETURN;
    END IF;
    RAISE EXCEPTION '% — got %, expected a privilege refusal. Nothing applied.', p_label, v_res;
  END IF;
  IF v_want = 'allowed' AND v_res LIKE 'error 23503%' THEN
    PERFORM pg_temp.note(format('ok      %s — the policy let it through; a foreign key then refused it', p_label));
    RETURN;
  END IF;
  IF v_res LIKE 'error %' THEN
    IF v_soft THEN
      PERFORM pg_temp.note(format('NOT DEMONSTRATED  %s — %s. Check it in the app instead (see the end of this file).', p_label, v_res));
      RETURN;
    END IF;
    RAISE EXCEPTION '% — %, expected %. Nothing applied.', p_label, v_res, v_want;
  END IF;
  v_ok := CASE v_want
            WHEN 'blocked' THEN v_res IN ('denied', 'rows=0')
            WHEN 'allowed' THEN v_res ~ '^rows=[1-9]'
            ELSE v_res = v_want
          END;
  IF NOT v_ok THEN
    RAISE EXCEPTION '% — got %, expected %. Nothing applied.', p_label, v_res, v_want;
  END IF;
  PERFORM pg_temp.note(format('ok      %s — %s', p_label, v_res));
END
$fn$;


-- ============================================================================
-- The change, tested
-- ============================================================================

BEGIN;

-- Is this event unlocked? Read past row-level security, so a policy can ask
-- it whoever the caller is. An unknown event counts as locked: a rule that
-- cannot find the event does not assume it is open. Like coa_is_open(), it
-- stays callable by any role; it tells a caller only whether an event id
-- exists and is unlocked.
CREATE OR REPLACE FUNCTION public.catering_event_unlocked(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE((SELECT e.cost_locked_at IS NULL FROM public.catering_events e WHERE e.id = p_event_id), false);
$fn$;

COMMENT ON FUNCTION public.catering_event_unlocked(uuid) IS
  'TRUE when the catering event exists and its cost is not locked. Used by the '
  'lock policies on catering_event_menus and catering_event_charges '
  '(catering_sales_limits_migration.sql).';

CREATE OR REPLACE FUNCTION pg_temp.check_catering(p_after boolean, p_e uuid, p_u uuid)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  owner_  constant uuid := '6c8a428c-386b-40f9-9758-c643b7219815';
  admin_  constant uuid := 'c0d216ea-941b-44fc-b19c-f330fb9a4efd';
  sale_   constant uuid := 'bcfc52ef-740f-40b1-8b24-d533585dcb4a';
  marker  constant text := 'probe-item33';
  l25     constant text := 'L25 sale deletes the unlocked event, its history lines with it';
  -- Every row a test names, looked up here as this session and passed in as
  -- a literal id, so a lookup the policy under test hides cannot become
  -- NULL and pass as "no rows". Each is checked below.
  v_set       uuid;  -- a set menu, one no booking uses if there is one
  v_item      uuid;  -- a set menu item
  v_item_set  uuid;  -- the set menu it belongs to
  v_dish      uuid;  -- a dish that set menu does not have yet
  v_log       uuid;  -- a history line
  v_e_menu    uuid;  -- a menu line of E
  v_e_charge  uuid;  -- a charge of E
  v_u_menu    uuid;  -- a menu line of U
  v_u_charge  uuid;  -- a charge of U, a hand-entered one if U has one
  v_cols      text;  -- the event columns a copy of U carries over
  n_sets      bigint;
  n_log       bigint;
  n_hist      bigint;
  n_left      bigint;
  v_rows      bigint;
  v_self      text := current_user::text;
  v_who       text;
  v_res       text;
BEGIN
  IF p_e IS NULL OR p_u IS NULL THEN
    RAISE EXCEPTION 'two test events are needed. Nothing applied.';
  END IF;
  IF (SELECT cost_locked_at IS NULL FROM public.catering_events WHERE id = p_e)
     OR (SELECT cost_locked_at IS NOT NULL FROM public.catering_events WHERE id = p_u) THEN
    RAISE EXCEPTION 'test event E must be locked and U unlocked at this point. Nothing applied.';
  END IF;

  SELECT s.id INTO v_set FROM public.catering_set_menus s
   ORDER BY EXISTS (SELECT 1 FROM public.catering_event_menus m WHERE m.set_menu_id = s.id), s.id
   LIMIT 1;
  SELECT i.id, i.set_menu_id INTO v_item, v_item_set
    FROM public.catering_set_menu_items i ORDER BY i.id LIMIT 1;
  SELECT d.id INTO v_dish FROM public.menus d
   WHERE NOT EXISTS (SELECT 1 FROM public.catering_set_menu_items i
                      WHERE i.set_menu_id = v_item_set AND i.menu_id = d.id)
   ORDER BY d.id LIMIT 1;
  SELECT l.id INTO v_log FROM public.catering_event_activity_log l ORDER BY l.id LIMIT 1;
  SELECT m.id INTO v_e_menu FROM public.catering_event_menus m WHERE m.event_id = p_e ORDER BY m.id LIMIT 1;
  SELECT c.id INTO v_e_charge FROM public.catering_event_charges c WHERE c.event_id = p_e ORDER BY c.id LIMIT 1;
  SELECT m.id INTO v_u_menu FROM public.catering_event_menus m WHERE m.event_id = p_u ORDER BY m.id LIMIT 1;
  SELECT c.id INTO v_u_charge FROM public.catering_event_charges c WHERE c.event_id = p_u
   ORDER BY (c.event_menu_id IS NULL) DESC, c.id LIMIT 1;
  -- Every column a booking row has, except those a new booking never copies:
  -- its id, its lock, its quotation number (unique) and its timestamps, and
  -- detail_note, which a test copy sets to the marker instead. Generated and
  -- identity columns cannot be written, so they are left out.
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'catering_events'
     AND c.is_generated = 'NEVER' AND c.is_identity = 'NO'
     AND c.column_name NOT IN ('id', 'cost_locked_at', 'quote_number', 'created_at', 'updated_at', 'detail_note');
  IF v_set IS NULL OR v_item IS NULL OR v_dish IS NULL OR v_log IS NULL
     OR v_e_menu IS NULL OR v_e_charge IS NULL OR v_u_menu IS NULL OR v_u_charge IS NULL
     OR v_cols IS NULL THEN
    RAISE EXCEPTION 'a row the tests need was not found. Nothing applied.';
  END IF;
  SELECT count(*) INTO n_sets FROM public.catering_set_menus;
  SELECT count(*) INTO n_log FROM public.catering_event_activity_log;
  SELECT count(*) INTO n_hist FROM public.catering_event_activity_log l WHERE l.event_id = p_u;
  IF n_hist = 0 THEN
    RAISE EXCEPTION 'test event U has no history lines, so L25 could not show them go. Nothing applied.';
  END IF;

  -- 1. Set menus. Negative controls: the sales account.
  PERFORM pg_temp.t(p_after, 'S1 sale reprices a set menu', sale_, 'sales',
    format($q$UPDATE public.catering_set_menus SET price_per_set = price_per_set WHERE id = %L$q$, v_set), 'blocked');
  PERFORM pg_temp.t(p_after, 'S2 sale deletes a set menu', sale_, 'sales',
    format($q$DELETE FROM public.catering_set_menus WHERE id = %L$q$, v_set), 'blocked');
  PERFORM pg_temp.t(p_after, 'S3 sale adds a set menu', sale_, 'sales',
    format($q$INSERT INTO public.catering_set_menus (name, price_per_set, is_active) VALUES (%L, 1, false)$q$, marker), 'denied');
  PERFORM pg_temp.t(p_after, 'S4 sale changes a set menu item', sale_, 'sales',
    format($q$UPDATE public.catering_set_menu_items SET quantity = quantity WHERE id = %L$q$, v_item), 'blocked');
  PERFORM pg_temp.t(p_after, 'S5 sale deletes a set menu item', sale_, 'sales',
    format($q$DELETE FROM public.catering_set_menu_items WHERE id = %L$q$, v_item), 'blocked');
  PERFORM pg_temp.t(p_after, 'S6 sale adds a set menu item', sale_, 'sales',
    format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, sort_order, note) VALUES (%L, %L, 1, 999, %L)$q$,
      v_item_set, v_dish, marker), 'denied');
  -- Positive controls: sales still reads, including the rows S1-S6 target; admin
  -- still makes every write the set-menu page makes (it replaces a set's
  -- items by deleting and inserting them).
  PERFORM pg_temp.t(p_after, 'S7 sale reads the set menus', sale_, 'sales',
    $q$SELECT id FROM public.catering_set_menus$q$, format('rows=%s', n_sets));
  PERFORM pg_temp.t(p_after, 'S8 sale reads the item S4 and S5 target', sale_, 'sales',
    format($q$SELECT id FROM public.catering_set_menu_items WHERE id = %L$q$, v_item), 'rows=1');
  PERFORM pg_temp.t(p_after, 'S9 admin reprices a set menu', admin_, 'admin',
    format($q$UPDATE public.catering_set_menus SET price_per_set = price_per_set WHERE id = %L$q$, v_set), 'rows=1');
  PERFORM pg_temp.t(p_after, 'S10 owner reprices a set menu', owner_, 'owner',
    format($q$UPDATE public.catering_set_menus SET price_per_set = price_per_set WHERE id = %L$q$, v_set), 'rows=1');
  PERFORM pg_temp.t(p_after, 'S11 admin changes a set menu item', admin_, 'admin',
    format($q$UPDATE public.catering_set_menu_items SET quantity = quantity WHERE id = %L$q$, v_item), 'rows=1');
  PERFORM pg_temp.t(p_after, 'S12 admin adds a set menu', admin_, 'admin',
    format($q$INSERT INTO public.catering_set_menus (name, price_per_set, is_active) VALUES (%L, 1, false) RETURNING id$q$, marker),
    'soft rows=1');
  PERFORM pg_temp.t(p_after, 'S13 admin adds a set menu item', admin_, 'admin',
    format($q$INSERT INTO public.catering_set_menu_items (set_menu_id, menu_id, quantity, sort_order, note) VALUES (%L, %L, 1, 999, %L)$q$,
      v_item_set, v_dish, marker), 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'S14 admin deletes a set menu item', admin_, 'admin',
    format($q$DELETE FROM public.catering_set_menu_items WHERE id = %L$q$, v_item), 'rows=1');
  PERFORM pg_temp.t(p_after, 'S15 admin deletes a set menu', admin_, 'admin',
    format($q$DELETE FROM public.catering_set_menus WHERE id = %L$q$, v_set), 'allowed');

  -- 2. The cost lock. Negative controls: sales, on the locked event E.
  PERFORM pg_temp.t(p_after, 'L1 sale unlocks the locked event', sale_, 'sales',
    format($q$UPDATE public.catering_events SET cost_locked_at = NULL WHERE id = %L$q$, p_e), 'blocked');
  PERFORM pg_temp.t(p_after, 'L2 sale edits the locked event', sale_, 'sales',
    format($q$UPDATE public.catering_events SET detail_note = detail_note WHERE id = %L$q$, p_e), 'blocked');
  PERFORM pg_temp.t(p_after, 'L3 sale deletes the locked event', sale_, 'sales',
    format($q$DELETE FROM public.catering_events WHERE id = %L$q$, p_e), 'blocked');
  PERFORM pg_temp.t(p_after, 'L4 sale locks the unlocked event', sale_, 'sales',
    format($q$UPDATE public.catering_events SET cost_locked_at = now() WHERE id = %L$q$, p_u), 'denied');
  PERFORM pg_temp.t(p_after, 'L5 sale adds a booking already locked', sale_, 'sales',
    format($q$INSERT INTO public.catering_events (%s, detail_note, cost_locked_at) SELECT %s, %L, now() FROM public.catering_events WHERE id = %L$q$,
      v_cols, v_cols, marker, p_u), 'denied');
  PERFORM pg_temp.t(p_after, 'L6 sale changes a menu line of the locked event', sale_, 'sales',
    format($q$UPDATE public.catering_event_menus SET quantity = quantity WHERE id = %L$q$, v_e_menu), 'blocked');
  PERFORM pg_temp.t(p_after, 'L7 sale deletes a menu line of the locked event', sale_, 'sales',
    format($q$DELETE FROM public.catering_event_menus WHERE id = %L$q$, v_e_menu), 'blocked');
  PERFORM pg_temp.t(p_after, 'L8 sale adds a menu line to the locked event', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order, note)
              SELECT %L, set_menu_id, menu_id, quantity, 999, %L FROM public.catering_event_menus WHERE id = %L$q$,
      p_e, marker, v_u_menu), 'denied');
  PERFORM pg_temp.t(p_after, 'L9 sale changes a charge of the locked event', sale_, 'sales',
    format($q$UPDATE public.catering_event_charges SET quantity = quantity WHERE id = %L$q$, v_e_charge), 'blocked');
  PERFORM pg_temp.t(p_after, 'L10 sale deletes a charge of the locked event', sale_, 'sales',
    format($q$DELETE FROM public.catering_event_charges WHERE id = %L$q$, v_e_charge), 'blocked');
  PERFORM pg_temp.t(p_after, 'L11 sale adds a charge to the locked event', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, sort_order, note)
              SELECT %L, label, charge_type, unit_price, quantity, amount, 999, %L FROM public.catering_event_charges WHERE id = %L$q$,
      p_e, marker, v_u_charge), 'denied');
  PERFORM pg_temp.t(p_after, 'L12 sale moves a charge of the unlocked event onto the locked one', sale_, 'sales',
    format($q$UPDATE public.catering_event_charges SET event_id = %L WHERE id = %L$q$, p_e, v_u_charge), 'denied');
  PERFORM pg_temp.t(p_after, 'L13 sale moves a menu line of the unlocked event onto the locked one', sale_, 'sales',
    format($q$UPDATE public.catering_event_menus SET event_id = %L WHERE id = %L$q$, p_e, v_u_menu), 'denied');
  -- Positive controls, sales: it still reads the locked event and the rows
  -- L6-L10 target, and it can still make every write the booking screen makes,
  -- on the unlocked event U.
  PERFORM pg_temp.t(p_after, 'L14 sale reads the locked event', sale_, 'sales',
    format($q$SELECT id FROM public.catering_events WHERE id = %L$q$, p_e), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L15 sale reads the menu line L6 and L7 target', sale_, 'sales',
    format($q$SELECT id FROM public.catering_event_menus WHERE id = %L$q$, v_e_menu), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L16 sale reads the charge L9 and L10 target', sale_, 'sales',
    format($q$SELECT id FROM public.catering_event_charges WHERE id = %L$q$, v_e_charge), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L17 sale creates a booking', sale_, 'sales',
    format($q$INSERT INTO public.catering_events (%s, detail_note) SELECT %s, %L FROM public.catering_events WHERE id = %L RETURNING id$q$,
      v_cols, v_cols, marker, p_u), 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'L18 sale edits the unlocked event', sale_, 'sales',
    format($q$UPDATE public.catering_events SET detail_note = detail_note WHERE id = %L$q$, p_u), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L19 sale changes a menu line of the unlocked event', sale_, 'sales',
    format($q$UPDATE public.catering_event_menus SET quantity = quantity WHERE id = %L$q$, v_u_menu), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L20 sale adds a menu line to the unlocked event', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order, note)
              SELECT %L, set_menu_id, menu_id, quantity, 999, %L FROM public.catering_event_menus WHERE id = %L RETURNING id$q$,
      p_u, marker, v_u_menu), 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'L21 sale deletes a menu line of the unlocked event (its charge goes with it)', sale_, 'sales',
    format($q$DELETE FROM public.catering_event_menus WHERE id = %L$q$, v_u_menu), 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'L22 sale changes a charge of the unlocked event', sale_, 'sales',
    format($q$UPDATE public.catering_event_charges SET quantity = quantity WHERE id = %L$q$, v_u_charge), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L23 sale adds a charge to the unlocked event', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_charges (event_id, label, charge_type, unit_price, quantity, amount, sort_order, note)
              SELECT %L, label, charge_type, unit_price, quantity, amount, 999, %L FROM public.catering_event_charges WHERE id = %L$q$,
      p_u, marker, v_u_charge), 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'L24 sale deletes a charge of the unlocked event', sale_, 'sales',
    format($q$DELETE FROM public.catering_event_charges WHERE id = %L$q$, v_u_charge), 'soft rows=1');

  -- L25, by hand rather than through t(): a statement reports only its own
  -- rows, and a cascade that skipped the history would still say rows=1. So
  -- U's history is counted before the delete (above), and again after it,
  -- in the same always-rolled-back block, once this session is itself again.
  v_who := NULL;
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', sale_::text, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', sale_::text, true);
    PERFORM set_config('role', 'authenticated', true);
    v_who := CASE WHEN current_user::text = 'authenticated'
                  THEN COALESCE(public.current_role(), 'no-profile')
                  ELSE 'not-authenticated' END;
    DELETE FROM public.catering_events WHERE id = p_u;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    PERFORM set_config('role', v_self, true);
    SELECT count(*) INTO n_left FROM public.catering_event_activity_log l WHERE l.event_id = p_u;
    v_res := format('rows=%s, history lines %s -> %s', v_rows, n_hist, n_left);
    RAISE EXCEPTION USING ERRCODE = 'U0001';
  EXCEPTION
    WHEN SQLSTATE 'U0001' THEN
      NULL;
    WHEN OTHERS THEN
      v_res := format('error %s %s', SQLSTATE, SQLERRM);
  END;
  IF NOT p_after THEN
    PERFORM pg_temp.note(format('before  %s — %s %s', l25, COALESCE(v_who, '?'), v_res));
  ELSIF v_who IS DISTINCT FROM 'sales' THEN
    RAISE EXCEPTION '% — ran as %, expected sales: the impersonation did not take, so the result means nothing. Nothing applied.',
      l25, COALESCE(v_who, '?');
  ELSIF v_res LIKE 'error 42501%' THEN
    RAISE EXCEPTION '% — %: a refusal inside its block (the delete, the switch back, or the recount), where the delete should go through. Nothing applied.',
      l25, v_res;
  ELSIF v_res LIKE 'error %' THEN
    PERFORM pg_temp.note(format('NOT DEMONSTRATED  %s — %s. Check it in the app instead (see the end of this file).', l25, v_res));
  ELSIF v_res IS DISTINCT FROM format('rows=1, history lines %s -> 0', n_hist) THEN
    RAISE EXCEPTION '% — got %, expected rows=1, history lines % -> 0. Nothing applied.', l25, v_res, n_hist;
  ELSE
    PERFORM pg_temp.note(format('ok      %s — %s', l25, v_res));
  END IF;

  -- Positive controls, admin and owner: their reach on the locked event.
  PERFORM pg_temp.t(p_after, 'L26 admin edits the locked event', admin_, 'admin',
    format($q$UPDATE public.catering_events SET detail_note = detail_note WHERE id = %L$q$, p_e), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L27 admin changes a menu line of the locked event', admin_, 'admin',
    format($q$UPDATE public.catering_event_menus SET quantity = quantity WHERE id = %L$q$, v_e_menu), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L28 admin adds a menu line to the locked event', admin_, 'admin',
    format($q$INSERT INTO public.catering_event_menus (event_id, set_menu_id, menu_id, quantity, sort_order, note)
              SELECT %L, set_menu_id, menu_id, quantity, 999, %L FROM public.catering_event_menus WHERE id = %L RETURNING id$q$,
      p_e, marker, v_u_menu), 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'L29 owner changes a charge of the locked event', owner_, 'owner',
    format($q$UPDATE public.catering_event_charges SET quantity = quantity WHERE id = %L$q$, v_e_charge), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L30 admin deletes a charge of the locked event', admin_, 'admin',
    format($q$DELETE FROM public.catering_event_charges WHERE id = %L$q$, v_e_charge), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L31 owner deletes a menu line of the locked event (its charge goes with it)', owner_, 'owner',
    format($q$DELETE FROM public.catering_event_menus WHERE id = %L$q$, v_e_menu), 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'L32 admin unlocks the locked event', admin_, 'admin',
    format($q$UPDATE public.catering_events SET cost_locked_at = NULL WHERE id = %L$q$, p_e), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L33 admin locks the unlocked event', admin_, 'admin',
    format($q$UPDATE public.catering_events SET cost_locked_at = now() WHERE id = %L$q$, p_u), 'rows=1');
  PERFORM pg_temp.t(p_after, 'L34 admin deletes the locked event', admin_, 'admin',
    format($q$DELETE FROM public.catering_events WHERE id = %L$q$, p_e), 'soft rows=1');

  -- 3. The history. Negative controls: sales, and admin and owner too (the
  -- history is append-only for everyone through the API).
  PERFORM pg_temp.t(p_after, 'H1 sale rewrites a history line', sale_, 'sales',
    format($q$UPDATE public.catering_event_activity_log SET description = description WHERE id = %L$q$, v_log), 'blocked');
  PERFORM pg_temp.t(p_after, 'H2 sale deletes a history line', sale_, 'sales',
    format($q$DELETE FROM public.catering_event_activity_log WHERE id = %L$q$, v_log), 'blocked');
  PERFORM pg_temp.t(p_after, 'H3 sale adds a history line under admin''s name', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, p_u, admin_, marker), 'denied');
  PERFORM pg_temp.t(p_after, 'H4 sale adds a backdated history line under its own name', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description, created_at)
              VALUES (%L, %L, 'edited', %L, now() - interval '1 day')$q$, p_u, sale_, marker), 'denied');
  PERFORM pg_temp.t(p_after, 'H5 admin adds a history line under sales''s name', admin_, 'admin',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, p_u, sale_, marker), 'denied');
  PERFORM pg_temp.t(p_after, 'H6 admin rewrites a history line', admin_, 'admin',
    format($q$UPDATE public.catering_event_activity_log SET description = description WHERE id = %L$q$, v_log), 'blocked');
  PERFORM pg_temp.t(p_after, 'H7 owner deletes a history line', owner_, 'owner',
    format($q$DELETE FROM public.catering_event_activity_log WHERE id = %L$q$, v_log), 'blocked');
  -- Positive controls: each of them still reads the line H1, H2, H6 and H7
  -- target (so "blocked" there is the policy, not an unseen row); writing
  -- one's own line with the insert's own time works, on a locked event too;
  -- and sales reads the whole history.
  PERFORM pg_temp.t(p_after, 'H8 sale reads the history line H1 and H2 target', sale_, 'sales',
    format($q$SELECT id FROM public.catering_event_activity_log WHERE id = %L$q$, v_log), 'rows=1');
  PERFORM pg_temp.t(p_after, 'H9 admin reads that history line', admin_, 'admin',
    format($q$SELECT id FROM public.catering_event_activity_log WHERE id = %L$q$, v_log), 'rows=1');
  PERFORM pg_temp.t(p_after, 'H10 owner reads that history line', owner_, 'owner',
    format($q$SELECT id FROM public.catering_event_activity_log WHERE id = %L$q$, v_log), 'rows=1');
  PERFORM pg_temp.t(p_after, 'H11 sale adds its own history line', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, p_u, sale_, marker), 'rows=1');
  PERFORM pg_temp.t(p_after, 'H12 admin adds its own history line', admin_, 'admin',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, p_u, admin_, marker), 'rows=1');
  PERFORM pg_temp.t(p_after, 'H13 owner adds its own history line to the locked event', owner_, 'owner',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, p_e, owner_, marker), 'rows=1');
  PERFORM pg_temp.t(p_after, 'H14 sale reads the whole history', sale_, 'sales',
    $q$SELECT id FROM public.catering_event_activity_log$q$, format('rows=%s', n_log));
END
$fn$;

-- Locks the test event E and unlocks U, runs the checks, and rolls
-- everything back: the lock, the unlock and every test write are undone,
-- and only the recorded lines are carried out (a plpgsql variable survives
-- the rollback; the setting does not). A failed check is a different error,
-- is not caught, and stops the file.
CREATE OR REPLACE FUNCTION pg_temp.with_locked_event(p_after boolean)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text;
  v_e   uuid;
  v_u   uuid;
BEGIN
  SELECT t.e, t.u INTO v_e, v_u FROM pg_temp.test_events() t;
  BEGIN
    UPDATE public.catering_events SET cost_locked_at = now() WHERE id = v_e;
    UPDATE public.catering_events SET cost_locked_at = NULL WHERE id = v_u;
    PERFORM pg_temp.check_catering(p_after, v_e, v_u);
    v_log := current_setting('catering_limits.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('catering_limits.log', v_log, false);
  END;
END
$fn$;

SELECT pg_temp.with_locked_event(false);

-- 1. Set menus: only owner and admin write them.
DROP POLICY IF EXISTS catering_set_menus_admin_insert ON public.catering_set_menus;
CREATE POLICY catering_set_menus_admin_insert ON public.catering_set_menus
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.current_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS catering_set_menus_admin_update ON public.catering_set_menus;
CREATE POLICY catering_set_menus_admin_update ON public.catering_set_menus
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.current_role() IN ('owner', 'admin'))
  WITH CHECK (public.current_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS catering_set_menus_admin_delete ON public.catering_set_menus;
CREATE POLICY catering_set_menus_admin_delete ON public.catering_set_menus
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.current_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS catering_set_menu_items_admin_insert ON public.catering_set_menu_items;
CREATE POLICY catering_set_menu_items_admin_insert ON public.catering_set_menu_items
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.current_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS catering_set_menu_items_admin_update ON public.catering_set_menu_items;
CREATE POLICY catering_set_menu_items_admin_update ON public.catering_set_menu_items
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.current_role() IN ('owner', 'admin'))
  WITH CHECK (public.current_role() IN ('owner', 'admin'));

DROP POLICY IF EXISTS catering_set_menu_items_admin_delete ON public.catering_set_menu_items;
CREATE POLICY catering_set_menu_items_admin_delete ON public.catering_set_menu_items
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.current_role() IN ('owner', 'admin'));

-- 2. The cost lock: for everyone but owner and admin, a locked event's own
-- row, menu lines and charges are read-only, and cost_locked_at stays empty.
DROP POLICY IF EXISTS catering_events_lock_insert ON public.catering_events;
CREATE POLICY catering_events_lock_insert ON public.catering_events
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR cost_locked_at IS NULL);

DROP POLICY IF EXISTS catering_events_lock_update ON public.catering_events;
CREATE POLICY catering_events_lock_update ON public.catering_events
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.current_role() IN ('owner', 'admin') OR cost_locked_at IS NULL)
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR cost_locked_at IS NULL);

DROP POLICY IF EXISTS catering_events_lock_delete ON public.catering_events;
CREATE POLICY catering_events_lock_delete ON public.catering_events
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.current_role() IN ('owner', 'admin') OR cost_locked_at IS NULL);

DROP POLICY IF EXISTS catering_event_menus_lock_insert ON public.catering_event_menus;
CREATE POLICY catering_event_menus_lock_insert ON public.catering_event_menus
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

DROP POLICY IF EXISTS catering_event_menus_lock_update ON public.catering_event_menus;
CREATE POLICY catering_event_menus_lock_update ON public.catering_event_menus
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id))
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

DROP POLICY IF EXISTS catering_event_menus_lock_delete ON public.catering_event_menus;
CREATE POLICY catering_event_menus_lock_delete ON public.catering_event_menus
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

DROP POLICY IF EXISTS catering_event_charges_lock_insert ON public.catering_event_charges;
CREATE POLICY catering_event_charges_lock_insert ON public.catering_event_charges
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

DROP POLICY IF EXISTS catering_event_charges_lock_update ON public.catering_event_charges;
CREATE POLICY catering_event_charges_lock_update ON public.catering_event_charges
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id))
  WITH CHECK (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

DROP POLICY IF EXISTS catering_event_charges_lock_delete ON public.catering_event_charges;
CREATE POLICY catering_event_charges_lock_delete ON public.catering_event_charges
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.current_role() IN ('owner', 'admin') OR public.catering_event_unlocked(event_id));

-- 3. The history: append-only through the API; a new line names its caller
-- and carries the time of its own insert, which is the column's default.
-- (An event's deletion still removes its lines: a foreign-key cascade is not
-- subject to row-level security.)
DROP POLICY IF EXISTS catering_activity_log_own_line ON public.catering_event_activity_log;
CREATE POLICY catering_activity_log_own_line ON public.catering_event_activity_log
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (actor = auth.uid() AND created_at = now());

DROP POLICY IF EXISTS catering_activity_log_no_update ON public.catering_event_activity_log;
CREATE POLICY catering_activity_log_no_update ON public.catering_event_activity_log
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS catering_activity_log_no_delete ON public.catering_event_activity_log;
CREATE POLICY catering_activity_log_no_delete ON public.catering_event_activity_log
  AS RESTRICTIVE FOR DELETE TO public
  USING (false);

-- From the first policy change above until COMMIT, this transaction holds
-- all six tables, so no other session can change their rows: from here on,
-- any change would be the tests'. The row counts, and U's lock, as they are
-- now, for the check at the end.
SELECT set_config('catering_limits.counts', pg_temp.catering_counts(), false);
SELECT set_config('catering_limits.u_lock',
  (SELECT t.u::text || '|' || COALESCE(e.cost_locked_at::text, 'none')
     FROM pg_temp.test_events() t
     JOIN public.catering_events e ON e.id = t.u),
  false);

SELECT pg_temp.with_locked_event(true);

-- Nothing the tests wrote remains: no event carries the test lock (it was
-- stamped with this transaction's time, now()); U's lock and the six tables'
-- row counts are as they were before the second run; and no row carries the
-- tests' marker.
DO $do$
DECLARE
  v_saved text := current_setting('catering_limits.u_lock', true);
  v_u     uuid := NULLIF(split_part(v_saved, '|', 1), '')::uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.catering_events WHERE cost_locked_at = now()) THEN
    RAISE EXCEPTION 'an event is still locked by the tests. Nothing applied.';
  END IF;
  IF v_u IS NULL
     OR (SELECT COALESCE(e.cost_locked_at::text, 'none') FROM public.catering_events e WHERE e.id = v_u)
        IS DISTINCT FROM split_part(v_saved, '|', 2) THEN
    RAISE EXCEPTION 'test event U''s lock is not as it was before the tests. Nothing applied.';
  END IF;
  IF pg_temp.catering_counts() IS DISTINCT FROM current_setting('catering_limits.counts', true) THEN
    RAISE EXCEPTION 'row counts changed during the tests: % before, % after. Nothing applied.',
      current_setting('catering_limits.counts', true), pg_temp.catering_counts();
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_set_menus WHERE name = 'probe-item33')
     OR EXISTS (SELECT 1 FROM public.catering_set_menu_items WHERE note = 'probe-item33')
     OR EXISTS (SELECT 1 FROM public.catering_events WHERE detail_note = 'probe-item33')
     OR EXISTS (SELECT 1 FROM public.catering_event_menus WHERE note = 'probe-item33')
     OR EXISTS (SELECT 1 FROM public.catering_event_charges WHERE note = 'probe-item33')
     OR EXISTS (SELECT 1 FROM public.catering_event_activity_log WHERE description = 'probe-item33') THEN
    RAISE EXCEPTION 'a test row is still there. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      nothing the tests wrote remains: no test lock, U''s lock as it was, the same '
    || pg_temp.catering_counts() || ', no probe rows');
  PERFORM set_config('catering_limits.counts', '', false);
  PERFORM set_config('catering_limits.u_lock', '', false);
END
$do$;

COMMIT;

-- ── The result: copy this table back whole ─────────────────────────────────
--
-- This session's test helpers are dropped first. batch_result() then prints
-- the recorded lines and clears the setting that held them.

DROP FUNCTION IF EXISTS
  pg_temp.with_locked_event(boolean),
  pg_temp.check_catering(boolean, uuid, uuid),
  pg_temp.t(boolean, text, uuid, text, text, text),
  pg_temp.probe(uuid, text),
  pg_temp.test_events(),
  pg_temp.catering_counts(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs — in the app ════════════════════════════════════════════
--
-- 1. As sales: create a test booking dated well in the future, with one
--    menu line and one extra charge, and save it (do not issue a
--    quotation). Add a menu line, remove the first one, change the charge,
--    and save again. Both saves work as before, and its history shows a
--    line for each. Then delete the test booking from the booking list.
--    (Covers L17, L20, L21, L23, L24 and L25.)
-- 2. As sales, try to delete a booking whose cost is locked. With the app
--    change deployed, it refuses with "ต้นทุนของงานนี้ถูกล็อกแล้ว
--    ปลดล็อกก่อนจึงจะแก้ไขได้"; without it, the booking silently stays. If
--    no booking is locked, first lock one as admin: a booking marked done,
--    with a quotation, that is not locked yet; unlock it again afterwards.
--    Never unlock a booking that was locked before this check: unlocking
--    deletes its frozen figures. Do NOT press Save on a locked booking:
--    that still rewrites its staff list and adds an "แก้ไขข้อมูลงาน" line
--    to its history before it refuses (reported separately).
-- 3. As admin, on the set-menu page: create a test set menu with two
--    dishes and save; remove one dish and save; then delete the set menu.
--    (Covers S12 and S13.)
-- L28, L31 and L34 (admin and owner changing a LOCKED booking) have no app
-- check: the app refuses any change to a locked booking, whoever asks. If
-- one of them prints NOT DEMONSTRATED, send the table.
