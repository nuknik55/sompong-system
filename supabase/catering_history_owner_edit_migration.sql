-- ============================================================================
-- Catering history: the owner may correct or remove a line (queue item 33)
-- ============================================================================
-- Run once in the Supabase SQL editor, the WHOLE FILE in one go, at a time
-- when nobody has a booking open (see LOCKS below). One transaction: it
-- records what it finds, makes its change, tests the result AS REAL
-- ACCOUNTS before COMMIT, and rolls back on any disagreement.
--
-- Needs catering_sales_limits_migration.sql (applied 2026-09-17). Step 0
-- stops if that has not run.
--
-- A booking's history (catering_event_activity_log) has been append-only
-- through the API for every role. Nik cannot use the Supabase dashboard, so
-- the owner gets edit and delete buttons on the booking page instead, and
-- this file lets the database allow exactly what those buttons do:
--   1. ROWS: the owner, and only the owner (is_owner_only()), may update and
--      delete history lines. Admin and sales still may not.
--   2. COLUMNS: an update may change the text (description) and nothing
--      else. Who wrote a line (actor), when (created_at), what kind it is
--      (action_key), which booking it belongs to (event_id) and its id stay
--      as written, for the owner too.
--   3. UNCHANGED: the insert rule. A new line must still name its caller as
--      its author and carry the time of its own insert.
--
-- HOW:
--   1. The two restrictive policies that refused every update and every
--      delete (catering_activity_log_no_update and _no_delete) are replaced
--      by two that admit the owner alone (catering_activity_log_owner_update
--      and _owner_delete).
--   2. Column privileges: UPDATE on the whole table is taken from anon and
--      authenticated, and UPDATE on description alone is given back to
--      authenticated. The database then refuses an update that names any
--      other column, whoever sends it through the API, before any policy
--      is consulted (the service key and the SQL editor keep full UPDATE).
--      This is the pattern permissions_batch_2026_09_17.sql uses on
--      pending_changes.
-- The app's buttons (deployed before this file runs) send the text column
-- only, and treat "no row changed" as a refusal, so until this file runs
-- they show the refusal and change nothing.
--
-- ── WHAT IT CHANGES, AND WHAT IT DOES NOT ─────────────────────────────────
--
-- Committed: two restrictive policies replaced by two, and one privilege
-- change. Nothing else. Plain reads are unchanged, and so are the insert
-- rule and every other table. (A read that locks rows, SELECT ... FOR
-- UPDATE, now works for the owner where it worked for nobody; nothing in
-- the app reads that way.)
--
-- NO DATA IS CHANGED AND NO TABLE IS CREATED. Every test write happens
-- inside a block that is always rolled back, and each touches at most one
-- row. The
-- file holds the history table against writes from its first statement
-- inside the transaction until COMMIT (LOCK TABLE ... IN SHARE ROW EXCLUSIVE
-- MODE: reads go on, writes wait), so the last check before COMMIT can
-- compare every line with what was there before either run of the tests:
-- the same number of lines, the same checksum over their contents, and no
-- line carrying the tests' marker. The results are kept in settings of this
-- session, not in a table, and are cleared at the end.
--
-- What the SQL editor may call destructive, all of it expected:
--   - 4 DROP POLICY IF EXISTS. Two remove the old refusals on purpose
--     (catering_activity_log_no_update, _no_delete); the other two drop this
--     file's own policies first, so the file can run again.
--   - REVOKE UPDATE on catering_event_activity_log, followed at once by the
--     GRANT of UPDATE on its description column.
--   - LOCK TABLE on catering_event_activity_log. It writes nothing.
--   - DROP FUNCTION IF EXISTS pg_temp.*, at the end: this session's test
--     helpers. The one that prints the result stays, empty, until the
--     session ends.
--   - The UPDATE, DELETE and INSERT statements inside the test function:
--     all rolled back, as above.
-- Anything else it calls destructive is NOT expected: stop and send it.
--
-- THE RESULT is the table the last statement prints: one row per finding
-- and per test, before and after, with "ok" on every judged row. It has
-- 45 rows plus one per policy Step 0 lists on the history table: 49
-- rows if the database matches this repository, on a first run and on a
-- re-run alike. Copy it back whole. There is no FAIL row: a judged test
-- that fails stops the file with its reason, so if the file fails, the
-- editor shows that error instead of the table, and nothing is applied.
-- Running the whole file again is safe.
--
-- LOCKS: from the start of the transaction, a booking save waits for this
-- file before it can add its history line, and so does deleting a
-- booking; from the policy change on, so does opening a booking page. The
-- file takes seconds, but a request that waits longer than its own time
-- limit fails: the booking page shows an error, a delete is refused, and a
-- save keeps its booking but loses that one history line. So run it when
-- nobody is using the catering screens. The file waits at most 3 seconds
-- for any lock it needs (lock_timeout); if it cannot get one, it stops with
-- nothing applied. Rarely, the database stops one side with a deadlock
-- error; if it stops the file, nothing was applied either. In both cases,
-- run it again.
--
-- ── HOW THE CHECKS CAN FAIL ────────────────────────────────────────────────
--
-- Every test runs twice, before and after the change. "before" lines are
-- printed, not judged; on a first run they show the old rule (for example
-- "before  E11 owner rewrites the text — owner rows=0"). "after" lines are
-- judged. Each test prints the role it actually ran as, and a wrong role
-- on a judged line stops the file. The line the tests use is looked up
-- by this session and passed in by id, and R1-R3 show every account can
-- read it, so "blocked" means the policy, not a row the account cannot see.
--
-- The negative controls for the rows rule are admin and sales, the two
-- other roles the table admits. For the columns rule the negative control
-- is the OWNER, the one account the rows rule now lets through, so the
-- rule cannot pass merely because the row was out of reach. P1 states the
-- column privileges themselves. The positive controls are the owner's text
-- update and delete, sent as the app sends them, and the unchanged insert
-- rule for all three accounts.
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

SELECT set_config('catering_history.log', '', false);

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  -- Separated by chr(30), not a newline: a note can itself span lines (a
  -- function definition, a policy expression) and must stay one row.
  PERFORM set_config('catering_history.log',
    COALESCE(current_setting('catering_history.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

-- Prints the recorded lines, in order, and clears the setting.
CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('catering_history.log', true), '');
BEGIN
  PERFORM set_config('catering_history.log', '', false);
  RETURN QUERY
    SELECT r.i, r.l
      FROM regexp_split_to_table(v_log, chr(30)) WITH ORDINALITY AS r(l, i)
     WHERE r.l <> ''
     ORDER BY r.i;
END
$fn$;


-- ── The history's fingerprint, for this session only ──────────────────────
--
-- The number of lines and a checksum over every line's contents, for the
-- check before COMMIT.

CREATE OR REPLACE FUNCTION pg_temp.history_fingerprint()
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT format('%s lines, checksum %s', count(*), md5(COALESCE(string_agg(l::text, '|' ORDER BY l.id), '')))
    FROM public.catering_event_activity_log l;
$fn$;


-- ── Step 0: the accounts, the predicate, the earlier file, what is live ────

DO $do$
DECLARE
  r      record;
  v_bad  int := 0;
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

  IF to_regprocedure('public.is_owner_only()') IS NULL THEN
    RAISE EXCEPTION 'public.is_owner_only() does not exist. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('live is_owner_only(): ' || pg_get_functiondef('public.is_owner_only()'::regprocedure));

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'catering_event_activity_log'
                    AND policyname = 'catering_activity_log_own_line') THEN
    RAISE EXCEPTION 'catering_sales_limits_migration.sql has not run: its insert rule is missing. Run that file first. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.catering_event_activity_log) THEN
    RAISE EXCEPTION 'the tests need one history line, and there is none. Nothing applied.';
  END IF;

  FOR r IN
    SELECT policyname, permissive, cmd, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'catering_event_activity_log'
     ORDER BY policyname
  LOOP
    PERFORM pg_temp.note(format('existing: public.catering_event_activity_log.%s [%s %s] TO %s USING %s WITH CHECK %s',
      r.policyname, r.permissive, r.cmd, r.roles, coalesce(r.qual, '-'), coalesce(r.with_check, '-')));
  END LOOP;

  PERFORM pg_temp.note('history now: ' || pg_temp.history_fingerprint());
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

-- Wait at most 3 seconds for any lock this file needs; failing to get one
-- stops the file with nothing applied (see LOCKS).
SET LOCAL lock_timeout = '3s';

-- Hold the history against writes until COMMIT (reads go on), then record
-- what it holds, for the check at the end.
LOCK TABLE public.catering_event_activity_log IN SHARE ROW EXCLUSIVE MODE;
SELECT set_config('catering_history.fingerprint', pg_temp.history_fingerprint(), false);

CREATE OR REPLACE FUNCTION pg_temp.check_history(p_after boolean)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  owner_  constant uuid := '6c8a428c-386b-40f9-9758-c643b7219815';
  admin_  constant uuid := 'c0d216ea-941b-44fc-b19c-f330fb9a4efd';
  sale_   constant uuid := 'bcfc52ef-740f-40b1-8b24-d533585dcb4a';
  marker  constant text := 'probe-history-owner';
  v_expect constant text := 'authenticated: table no, description yes, actor no, created_at no, action_key no, event_id no, id no; anon: table no, description no';
  v_p1    constant text := 'P1 who may update which history columns';
  -- The line every test names, looked up here by this session and passed in
  -- as a literal id, and the booking it belongs to.
  v_line  uuid;
  v_event uuid;
  v_priv  text;
BEGIN
  SELECT l.id, l.event_id INTO v_line, v_event
    FROM public.catering_event_activity_log l ORDER BY l.id LIMIT 1;
  IF v_line IS NULL OR v_event IS NULL THEN
    RAISE EXCEPTION 'no history line to test with. Nothing applied.';
  END IF;

  -- P1, the column rule as the database states it. has_column_privilege is
  -- true for a column when the role holds UPDATE on the whole table, so the
  -- expected line can only appear once the table-wide UPDATE is gone.
  v_priv := format('authenticated: table %s, description %s, actor %s, created_at %s, action_key %s, event_id %s, id %s; anon: table %s, description %s',
    CASE WHEN has_table_privilege('authenticated', 'public.catering_event_activity_log', 'UPDATE') THEN 'yes' ELSE 'no' END,
    CASE WHEN has_column_privilege('authenticated', 'public.catering_event_activity_log', 'description', 'UPDATE') THEN 'yes' ELSE 'no' END,
    CASE WHEN has_column_privilege('authenticated', 'public.catering_event_activity_log', 'actor', 'UPDATE') THEN 'yes' ELSE 'no' END,
    CASE WHEN has_column_privilege('authenticated', 'public.catering_event_activity_log', 'created_at', 'UPDATE') THEN 'yes' ELSE 'no' END,
    CASE WHEN has_column_privilege('authenticated', 'public.catering_event_activity_log', 'action_key', 'UPDATE') THEN 'yes' ELSE 'no' END,
    CASE WHEN has_column_privilege('authenticated', 'public.catering_event_activity_log', 'event_id', 'UPDATE') THEN 'yes' ELSE 'no' END,
    CASE WHEN has_column_privilege('authenticated', 'public.catering_event_activity_log', 'id', 'UPDATE') THEN 'yes' ELSE 'no' END,
    CASE WHEN has_table_privilege('anon', 'public.catering_event_activity_log', 'UPDATE') THEN 'yes' ELSE 'no' END,
    CASE WHEN has_column_privilege('anon', 'public.catering_event_activity_log', 'description', 'UPDATE') THEN 'yes' ELSE 'no' END);
  IF NOT p_after THEN
    PERFORM pg_temp.note(format('before  %s — %s', v_p1, v_priv));
  ELSIF v_priv IS DISTINCT FROM v_expect THEN
    RAISE EXCEPTION '% — got "%", expected "%". Nothing applied.', v_p1, v_priv, v_expect;
  ELSE
    PERFORM pg_temp.note(format('ok      %s — %s', v_p1, v_priv));
  END IF;

  -- Everyone the tests name can read the line, so "blocked" below is the
  -- policy, not a row the account cannot see.
  PERFORM pg_temp.t(p_after, 'R1 owner reads the test line', owner_, 'owner',
    format($q$SELECT id FROM public.catering_event_activity_log WHERE id = %L$q$, v_line), 'rows=1');
  PERFORM pg_temp.t(p_after, 'R2 admin reads the test line', admin_, 'admin',
    format($q$SELECT id FROM public.catering_event_activity_log WHERE id = %L$q$, v_line), 'rows=1');
  PERFORM pg_temp.t(p_after, 'R3 sale reads the test line', sale_, 'sales',
    format($q$SELECT id FROM public.catering_event_activity_log WHERE id = %L$q$, v_line), 'rows=1');

  -- 1. The rows: negative controls, admin and sales.
  PERFORM pg_temp.t(p_after, 'E1 sale rewrites the text', sale_, 'sales',
    format($q$UPDATE public.catering_event_activity_log SET description = %L WHERE id = %L$q$, marker, v_line), 'blocked');
  PERFORM pg_temp.t(p_after, 'E2 sale deletes the line', sale_, 'sales',
    format($q$DELETE FROM public.catering_event_activity_log WHERE id = %L$q$, v_line), 'blocked');
  PERFORM pg_temp.t(p_after, 'E3 admin rewrites the text', admin_, 'admin',
    format($q$UPDATE public.catering_event_activity_log SET description = %L WHERE id = %L$q$, marker, v_line), 'blocked');
  PERFORM pg_temp.t(p_after, 'E4 admin deletes the line', admin_, 'admin',
    format($q$DELETE FROM public.catering_event_activity_log WHERE id = %L$q$, v_line), 'blocked');

  -- 2. The columns: negative controls, the OWNER, the one account the rows
  -- rule now lets through; and sales once, to show the rule is not per role.
  PERFORM pg_temp.t(p_after, 'E5 owner changes who wrote the line', owner_, 'owner',
    format($q$UPDATE public.catering_event_activity_log SET actor = %L WHERE id = %L$q$, owner_, v_line), 'no-privilege');
  PERFORM pg_temp.t(p_after, 'E6 owner changes when it was written', owner_, 'owner',
    format($q$UPDATE public.catering_event_activity_log SET created_at = created_at - interval '1 day' WHERE id = %L$q$, v_line), 'no-privilege');
  PERFORM pg_temp.t(p_after, 'E7 owner changes what kind of line it is', owner_, 'owner',
    format($q$UPDATE public.catering_event_activity_log SET action_key = action_key WHERE id = %L$q$, v_line), 'no-privilege');
  PERFORM pg_temp.t(p_after, 'E8 owner moves the line to a booking', owner_, 'owner',
    format($q$UPDATE public.catering_event_activity_log SET event_id = event_id WHERE id = %L$q$, v_line), 'no-privilege');
  PERFORM pg_temp.t(p_after, 'E9 owner changes the line''s id', owner_, 'owner',
    format($q$UPDATE public.catering_event_activity_log SET id = id WHERE id = %L$q$, v_line), 'no-privilege');
  PERFORM pg_temp.t(p_after, 'E10 sale changes who wrote the line', sale_, 'sales',
    format($q$UPDATE public.catering_event_activity_log SET actor = %L WHERE id = %L$q$, sale_, v_line), 'no-privilege');

  -- 3. Positive controls: the owner's two buttons, as the app sends them
  -- (the text column only, and the changed row read back).
  PERFORM pg_temp.t(p_after, 'E11 owner rewrites the text', owner_, 'owner',
    format($q$UPDATE public.catering_event_activity_log SET description = %L WHERE id = %L AND event_id = %L RETURNING id$q$,
      marker, v_line, v_event), 'rows=1');
  PERFORM pg_temp.t(p_after, 'E12 owner deletes the line', owner_, 'owner',
    format($q$DELETE FROM public.catering_event_activity_log WHERE id = %L AND event_id = %L RETURNING id$q$,
      v_line, v_event), 'rows=1');

  -- 4. The insert rule, unchanged: each line names its caller and carries
  -- the time of its own insert.
  PERFORM pg_temp.t(p_after, 'I1 sale adds its own line', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, v_event, sale_, marker), 'rows=1');
  PERFORM pg_temp.t(p_after, 'I2 sale adds a line under the owner''s name', sale_, 'sales',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, v_event, owner_, marker), 'denied');
  PERFORM pg_temp.t(p_after, 'I3 owner adds a backdated line under its own name', owner_, 'owner',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description, created_at)
              VALUES (%L, %L, 'edited', %L, now() - interval '1 day')$q$, v_event, owner_, marker), 'denied');
  PERFORM pg_temp.t(p_after, 'I4 owner adds its own line', owner_, 'owner',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, v_event, owner_, marker), 'rows=1');
  PERFORM pg_temp.t(p_after, 'I5 admin adds its own line', admin_, 'admin',
    format($q$INSERT INTO public.catering_event_activity_log (event_id, actor, action_key, description)
              VALUES (%L, %L, 'edited', %L)$q$, v_event, admin_, marker), 'rows=1');
END
$fn$;

SELECT pg_temp.check_history(false);

-- 1. The rows: the owner alone may update or delete a history line.
DROP POLICY IF EXISTS catering_activity_log_no_update ON public.catering_event_activity_log;
DROP POLICY IF EXISTS catering_activity_log_no_delete ON public.catering_event_activity_log;

DROP POLICY IF EXISTS catering_activity_log_owner_update ON public.catering_event_activity_log;
CREATE POLICY catering_activity_log_owner_update ON public.catering_event_activity_log
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.is_owner_only())
  WITH CHECK (public.is_owner_only());

DROP POLICY IF EXISTS catering_activity_log_owner_delete ON public.catering_event_activity_log;
CREATE POLICY catering_activity_log_owner_delete ON public.catering_event_activity_log
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.is_owner_only());

-- 2. The columns: an update may change the text and nothing else, whoever
-- sends it.
REVOKE UPDATE ON public.catering_event_activity_log FROM anon, authenticated;
GRANT UPDATE (description) ON public.catering_event_activity_log TO authenticated;

SELECT pg_temp.check_history(true);

-- Nothing the tests wrote remains: every line is as it was before the first
-- run (the table has been held since then), and no line carries the marker.
DO $do$
BEGIN
  IF pg_temp.history_fingerprint() IS DISTINCT FROM current_setting('catering_history.fingerprint', true) THEN
    RAISE EXCEPTION 'the history changed during the tests: % before, % after. Nothing applied.',
      current_setting('catering_history.fingerprint', true), pg_temp.history_fingerprint();
  END IF;
  IF EXISTS (SELECT 1 FROM public.catering_event_activity_log WHERE description = 'probe-history-owner') THEN
    RAISE EXCEPTION 'a test line is still there. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      every history line is as it was before the tests (' || pg_temp.history_fingerprint() || '), and no probe line remains');
  PERFORM set_config('catering_history.fingerprint', '', false);
END
$do$;

COMMIT;

-- ── The result: copy this table back whole ─────────────────────────────────
--
-- This session's test helpers are dropped first. batch_result() then prints
-- the recorded lines and clears the setting that held them.

DROP FUNCTION IF EXISTS
  pg_temp.check_history(boolean),
  pg_temp.t(boolean, text, uuid, text, text, text),
  pg_temp.probe(uuid, text),
  pg_temp.history_fingerprint(),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ Before it runs — in the app (the buttons are already deployed) ═══════
--
-- 0. As the owner, open any booking's ประวัติการแก้ไข, press แก้ไข on a line,
--    change nothing and press บันทึก: it says "ทำไม่สำเร็จ — …", and the
--    line is unchanged.
--
-- ═══ After it runs — in the app ════════════════════════════════════════════
--
-- Use a throwaway booking, so no real history is changed:
-- 1. Create a test booking dated well in the future and save it (do not
--    issue a quotation). Its history has one line, สร้างการจอง.
-- 2. As the owner, open it: change that line's text and save. The new text
--    shows, with the same name and time. Then press ลบ, then ยืนยันลบ: the
--    line is gone.
-- 3. As admin or sales, open the same booking: its history shows no แก้ไข
--    or ลบ buttons.
-- 4. Delete the test booking.
