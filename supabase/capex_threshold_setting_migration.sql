-- ============================================================================
-- The CapEx question's threshold: one column on app_settings (queue item 9)
-- ============================================================================
-- Run once in the Supabase SQL editor, THE WHOLE FILE in one go. One
-- transaction: it records what is live, adds the column, tests the result AS
-- REAL ACCOUNTS with every test write rolled back, and rolls the whole thing
-- back if anything disagrees. Safe to re-run — the column is added IF NOT
-- EXISTS and the constraint only when missing, so a second run changes
-- nothing and prints the same table.
--
-- THE ONLY SQL the four items of 2026-09-18 need. Item 34 (the hidden-menu
-- allowlist), item 13 (the coffee-items rename) and item 4 (resuming a POS
-- upload) are code alone. Item 13 was checked for a stored path in
-- particular: no table comment, column default or row anywhere holds the
-- route, and the two mentions in the applied seed are a comment and a RAISE
-- EXCEPTION message.
--
-- WHAT IT CHANGES
--   app_settings gains capex_threshold NUMERIC NOT NULL DEFAULT 20000, with a
--   CHECK that it is not negative. The table holds exactly one row (id = 1),
--   so that row gains the default: 20,000, the figure the restaurant already
--   works to. NO EXISTING VALUE IS READ OR WRITTEN — the only data change is
--   the new column's default arriving on that row, which is the point.
--
-- WHY A COLUMN, NOT A TABLE
--   app_settings is the one settings row this app has: read by every
--   signed-in account (app_settings_read_all) and written by the owner's
--   screen alone. A new table would need its own RLS; this file creates no
--   table at all, temporary or otherwise.
--
-- THE GAP THIS DOES NOT CLOSE — stated plainly, because it is about who may
-- change the threshold, and Nik's answer was "the owner, not an admin":
--   app_settings_owner_write is USING (is_owner()), and is_owner() has meant
--   owner OR admin since migrations/006_owner_role.sql. So an admin's direct
--   PostgREST update reaches this column, exactly as it reaches q_factor_pct
--   today. On screen they cannot: updateCapexThreshold is requireOwner(), and
--   the input renders read-only for them.
--   Queue item 23's file — q_factor_owner_only_migration.sql, written,
--   reviewed and HELD to ride with the HR rebuild — moves that policy to
--   is_owner_only() and closes it for the WHOLE TABLE, this column with it.
--   This file does not run it: held is a decision, not an oversight.
--   Test 5 below reports which of the two states is live, so the table says
--   so rather than this comment going stale.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE: one ALTER TABLE ... ADD COLUMN,
-- one ALTER TABLE ... ADD CONSTRAINT, one COMMENT ON COLUMN. Anything else is
-- unexpected. It creates no table, drops nothing, and deletes nothing.
-- ============================================================================

BEGIN;

-- ── Test scaffolding: notes in a session setting, never a table ────────────

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  -- chr(30), not a newline: a note can itself span lines and must stay one row.
  PERFORM set_config('capex_setting.log',
    COALESCE(current_setting('capex_setting.log', true), '')
      || COALESCE(p_line, '(empty note)') || chr(30), false);
END
$fn$;

CREATE OR REPLACE FUNCTION pg_temp.batch_result()
RETURNS TABLE (n bigint, line text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_log text := COALESCE(current_setting('capex_setting.log', true), '');
BEGIN
  PERFORM set_config('capex_setting.log', '', false);
  RETURN QUERY
    SELECT r.i, r.l
      FROM regexp_split_to_table(v_log, chr(30)) WITH ORDINALITY AS r(l, i)
     WHERE r.l <> ''
     ORDER BY r.i;
END
$fn$;

-- Runs one statement as one account and ALWAYS rolls it back: the block
-- raises a private SQLSTATE and catches it, so a subtransaction abort undoes
-- the write and the impersonation together. Returns the identity it actually
-- ran as, first, so a failed impersonation cannot pass as a zero.
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
    WHEN insufficient_privilege THEN
      RETURN COALESCE(v_role, '?') || ' denied';
    WHEN OTHERS THEN
      RETURN COALESCE(v_role, '?') || ' error ' || SQLSTATE || ' ' || SQLERRM;
  END;
END
$fn$;

-- One assertion. Raises — so the whole file rolls back — when the account it
-- ran as is not the account meant, or the answer is not one of p_want.
CREATE OR REPLACE FUNCTION pg_temp.t(p_label text, p_who uuid, p_role text, p_sql text, p_want text[])
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_got  text := pg_temp.probe(p_who, p_sql);
  v_role text := split_part(v_got, ' ', 1);
  v_res  text := substr(v_got, length(split_part(v_got, ' ', 1)) + 2);
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

-- ── Step 0: what is live now, and the accounts the tests need ──────────────

DO $do$
DECLARE
  v_rows   bigint;
  v_owner  uuid;
  v_admin  uuid;
  v_has    boolean;
BEGIN
  PERFORM 'public.current_role()'::regprocedure;   -- raises if it is missing

  IF to_regclass('public.app_settings') IS NULL THEN
    RAISE EXCEPTION 'app_settings does not exist. Nothing changed.';
  END IF;

  SELECT relrowsecurity INTO v_has FROM pg_class WHERE oid = 'public.app_settings'::regclass;
  IF v_has IS NOT TRUE THEN
    RAISE EXCEPTION 'app_settings does not have row level security enabled. Nothing changed.';
  END IF;

  SELECT count(*) INTO v_rows FROM public.app_settings;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'app_settings holds % rows; this file expects exactly one (id = 1). Nothing changed.', v_rows;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE id = 1) THEN
    RAISE EXCEPTION 'the one app_settings row is not id = 1. Nothing changed.';
  END IF;

  -- The test accounts, by role. An absence must fail loudly here rather than
  -- becoming a NULL that every later check quietly passes.
  SELECT id INTO v_owner FROM public.profiles WHERE role = 'owner' ORDER BY id LIMIT 1;
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF v_owner IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'need one owner and one admin profile to test as; found owner %, admin %. Nothing changed.',
      v_owner, v_admin;
  END IF;
  PERFORM set_config('capex_setting.owner', v_owner::text, false);
  PERFORM set_config('capex_setting.admin', v_admin::text, false);

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'app_settings' AND column_name = 'capex_threshold'
  ) INTO v_has;
  PERFORM pg_temp.note(format('before  capex_threshold exists: %s (a re-run says true)', v_has));
  PERFORM pg_temp.note(format('before  app_settings_owner_write calls is_owner_only(): %s (queue item 23; false until its held file runs)',
    EXISTS (SELECT 1 FROM pg_depend d
              JOIN pg_policy pol ON pol.oid = d.objid
             WHERE d.classid = 'pg_policy'::regclass
               AND d.refclassid = 'pg_proc'::regclass
               AND d.refobjid = 'public.is_owner_only()'::regprocedure
               AND pol.polrelid = 'public.app_settings'::regclass
               AND pol.polname = 'app_settings_owner_write')));
END
$do$;

-- ── Step 1: the column ─────────────────────────────────────────────────────

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS capex_threshold NUMERIC NOT NULL DEFAULT 20000;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.app_settings'::regclass
       AND conname = 'app_settings_capex_threshold_nonneg'
  ) THEN
    ALTER TABLE public.app_settings
      ADD CONSTRAINT app_settings_capex_threshold_nonneg CHECK (capex_threshold >= 0);
  END IF;
END
$do$;

COMMENT ON COLUMN public.app_settings.capex_threshold IS
  'Baht. Above this, บันทึกรายวัน asks whether a purchase in G400 (ซ่อมบำรุง) or '
  'G800 (อุปกรณ์) is a new asset and belongs in CapEx (G990). A WARNING only: '
  'nothing is blocked and nothing is reclassified. 0 turns the question off. '
  'Owner-set on /owner (updateCapexThreshold, requireOwner). Queue item 9.';

-- ── Step 2: tests, as real accounts, every write rolled back ───────────────

DO $do$
DECLARE
  v_owner uuid := current_setting('capex_setting.owner')::uuid;
  v_admin uuid := current_setting('capex_setting.admin')::uuid;
  v_col    record;
  v_value  numeric;
  v_before numeric;
BEGIN
  -- 1. The column is what the app expects to read.
  SELECT data_type, is_nullable, column_default INTO v_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'app_settings' AND column_name = 'capex_threshold';
  IF v_col IS NULL OR v_col.data_type <> 'numeric' OR v_col.is_nullable <> 'NO'
     OR v_col.column_default IS DISTINCT FROM '20000' THEN
    RAISE EXCEPTION 'FAIL    capex_threshold is % / nullable % / default %, expected numeric / NO / 20000. Nothing applied.',
      COALESCE(v_col.data_type, '(absent)'), COALESCE(v_col.is_nullable, '-'), COALESCE(v_col.column_default, '-');
  END IF;
  PERFORM pg_temp.note('ok      capex_threshold is numeric, NOT NULL, default 20000');

  -- 2. The settings row carries a usable figure. NOT asserted to be 20000:
  --    on a re-run the owner may already have changed it, and that is not a
  --    failure. It is printed, so the value is on the record either way.
  SELECT capex_threshold INTO v_value FROM public.app_settings WHERE id = 1;
  IF v_value IS NULL OR v_value < 0 THEN
    RAISE EXCEPTION 'FAIL    the settings row holds %, which the app cannot use. Nothing applied.', v_value;
  END IF;
  v_before := v_value;
  PERFORM pg_temp.note(format('ok      the settings row reads %s (20000 on a first run)', v_value));

  -- 3. POSITIVE CONTROL — the owner can write it. The UPDATE sets the value
  --    to itself, so even a control that passes changes nothing.
  PERFORM pg_temp.t('owner can set the threshold', v_owner, 'owner',
    'UPDATE public.app_settings SET capex_threshold = capex_threshold WHERE id = 1',
    ARRAY['rows=1']);

  -- 4. The CHECK refuses a negative threshold, as the owner. Its own negative
  --    control: the same account that just succeeded above.
  PERFORM pg_temp.t('a negative threshold is refused', v_owner, 'owner',
    'UPDATE public.app_settings SET capex_threshold = -1 WHERE id = 1',
    ARRAY['check-refused']);

  -- 5. WHO ELSE REACHES IT — this line is the state of queue item 23, not a
  --    verdict on this file. 'rows=1' is today: app_settings_owner_write
  --    calls is_owner(), which admits admins, so an admin's direct API call
  --    lands (the screen still refuses them). 'rows=0' means item 23's held
  --    migration has since run and the column is owner-only at the database
  --    too. Anything else is a surprise and fails.
  PERFORM pg_temp.t('admin, by direct call (item 23: rows=1 until its held file runs)', v_admin, 'admin',
    'UPDATE public.app_settings SET capex_threshold = capex_threshold WHERE id = 1',
    ARRAY['rows=1', 'rows=0']);

  -- 6. An admin must still READ it: /owner shows the figure to admins,
  --    read-only, and the daily page needs it to ask the question at all.
  PERFORM pg_temp.t('admin can read the threshold', v_admin, 'admin',
    'SELECT capex_threshold FROM public.app_settings WHERE id = 1',
    ARRAY['rows=1']);

  -- 7. Nothing the tests did survived them: the figure read before the
  --    writes and the figure read after them are the same one.
  SELECT capex_threshold INTO v_value FROM public.app_settings WHERE id = 1;
  IF v_value IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'FAIL    a test write survived: the threshold was %, it is now %. Nothing applied.',
      v_before, v_value;
  END IF;
  PERFORM pg_temp.note(format('ok      after the tests the threshold is still %s — every test write rolled back', v_value));
END
$do$;

COMMIT;

-- ── The result: copy this table back whole ─────────────────────────────────

DROP FUNCTION IF EXISTS
  pg_temp.t(text, uuid, text, text, text[]),
  pg_temp.probe(uuid, text),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs — in the app ════════════════════════════════════════════
--
-- 1. As the OWNER, open /owner. Beside Q-factor there is
--    "เตือน CapEx เมื่อเกิน" reading 20000. Change it to 1000, press บันทึก.
-- 2. Open บันทึกรายวัน, add a row: account 810 Supply - ครัว, amount 2000.
--    An amber note appears above บันทึก naming the row and the amount, and
--    the save button still works. Save it — the entry is stored in 810,
--    unchanged, because the question is a question.
-- 3. Change that row's account to 110 ผักสด: the note disappears (food is
--    out of scope). Change it back, then to 410 ค่าอุปกรณ์ซ่อม: it returns.
-- 4. Edit a saved entry into the same shape: the note appears under its
--    detail box while it is open for editing.
-- 5. Set the threshold back to 20000 on /owner. Delete the test entry.
-- 6. As the ADMIN, open /owner: the figure shows, greyed, with no บันทึก
--    button beside it.
