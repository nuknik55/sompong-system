-- ============================================================================
-- Permissions batch, 2026-09-17: four independent parts in one file.
-- ============================================================================
-- Run once in the Supabase SQL editor, the WHOLE FILE in one go. It touches
-- no data. Each part is its own transaction: it records what it finds, makes
-- its change, then tests the result AS REAL ACCOUNTS before COMMIT, and
-- rolls back on any disagreement. Every test write is rolled back.
--
-- THE RESULT is the table the last statement prints: one line per finding
-- and per test, before and after. Copy it back whole. (The same lines are
-- also raised as NOTICEs, which the SQL editor may not show.) If a part
-- fails, the editor shows that error instead, and the table is not printed;
-- the one exception is part D being refused permission on storage, which
-- is written into the table as "PART D NOT APPLIED".
--
--   A. profiles        an admin can no longer make itself owner, reach an
--                      hr login, or touch the owner's row (item 29, 1–3)
--   B. expense_entries only the owner writes owner-only accounts (790), and
--      + coa           only the owner changes such an account (item 29, 4)
--   C. pending_changes a request about a prep is hidden from whoever may not
--                      see that prep, as the approval queue already hides it,
--                      and only editors file requests, about preps they can
--                      see (item 31)
--   D. storage         sop-photos stays public to READ; uploads are limited
--                      by role and file name; nobody overwrites or deletes
--                      through the API (item 30, decision 2)
--
-- NOT IN THIS FILE: supply orders (item 29 #5). The owner decided staff will
-- place orders with a head approving them, so the fix there is an approval
-- step, not a permission wall; it is its own piece of work.
--
-- ── INDEPENDENT: THE PARTS NEED NOTHING FROM EACH OTHER OR FROM A DEPLOY ───
--
-- Each part changes different tables, and each admits every write the app
-- makes today through a screen, with the app as deployed before or after
-- the matching code change. So the file can run before or after that deploy.
--
-- But part A does NOT close the whole team-management hole on its own.
-- Renaming a login and resetting a password are service-role calls that no
-- table policy sees; only the code change (owner/team/actions.ts, same day)
-- stops an admin doing them to the owner or an hr account. Part B likewise
-- backs up the checks the code change adds to accounting/actions.ts.
--
-- If a part fails, the parts before it have committed and the parts after it
-- have not run. Every part is safe to run again, so after a fix the whole
-- file is simply run again.
--
-- ── WHY RESTRICTIVE POLICIES ───────────────────────────────────────────────
--
-- The live database may hold policies the repo does not show (item 25 is
-- exactly that question for profiles, and storage policies can be edited in
-- the dashboard). Ordinary (permissive) policies are OR-ed, so a new one can
-- only ADD access and an unknown one would reopen what this file narrows.
-- A RESTRICTIVE policy is AND-ed with every permissive one, whatever exists.
-- So parts A to C add restrictive policies and leave the existing ones as
-- they are; the existing read policies stay as they are too.
--
-- ── HOW THE CHECKS CAN FAIL ────────────────────────────────────────────────
--
-- Every test runs twice, before and after the change. The "before" lines are
-- printed, not judged; on a first run they SHOW the hole (for example
-- "before  A1 admin makes itself owner — admin rows=1"), which is what proves
-- the test can see it. The "after" lines are judged. Each test prints the
-- role it actually ran as, and a wrong role stops the file: a failed
-- impersonation must not pass as a zero. Accounts are named by id, as
-- literals, so a lookup hidden by the very policy under test cannot turn
-- into NULL and answer "no". The negative controls come from the population
-- each rule is about: ADMINS for parts A and B, an admin with no prep grants
-- for part C, and staff for part D. Each has a positive control in the same
-- population, so "admins are refused" is told apart from "everything is
-- refused".
--
-- Accounts used (checked first):
--   Owner   6c8a428c-386b-40f9-9758-c643b7219815  owner
--   admin   c0d216ea-941b-44fc-b19c-f330fb9a4efd  admin, no prep grants
--   อู๋     f19d0fee-4c9a-4084-9479-92a908f30169  admin, no prep grants
--   เฮง     8c4c865a-1ebe-4363-817a-fb3779a3c048  admin, grant on กะทิราดข้าวเหนียว
--   Editor  b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f  editor, no prep grants
--   เวช     ef2075c7-9fbc-4c66-8dd1-6528bb810786  editor, grant on กะทิราดข้าวเหนียว
--   HR      379a49df-8ff7-4110-af6c-701cd8dca6aa  hr
--   sale    bcfc52ef-740f-40b1-8b24-d533585dcb4a  sales
--   Staff   b0ec6eca-650e-4adc-9503-316c1dd1afec  staff
-- กะทิราดข้าวเหนียว is prep fc8c4a24-5c9d-4569-9e40-113f4a2ae07c.
-- ============================================================================


-- ── The results table, for this session only ───────────────────────────────

DROP TABLE IF EXISTS pg_temp.batch_log;
CREATE TEMP TABLE batch_log (n bigserial PRIMARY KEY, line text NOT NULL);

CREATE OR REPLACE FUNCTION pg_temp.note(p_line text)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE '%', p_line;
  INSERT INTO pg_temp.batch_log (line) VALUES (p_line);
END
$fn$;


-- ── Step 0: the accounts are who the checks say, and what is live ──────────

DO $do$
DECLARE
  r      record;
  v_bad  int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('6c8a428c-386b-40f9-9758-c643b7219815'::uuid, 'owner',  'Owner',  NULL::boolean),
      ('c0d216ea-941b-44fc-b19c-f330fb9a4efd'::uuid, 'admin',  'admin',  false),
      ('f19d0fee-4c9a-4084-9479-92a908f30169'::uuid, 'admin',  'อู๋',    false),
      ('8c4c865a-1ebe-4363-817a-fb3779a3c048'::uuid, 'admin',  'เฮง',    true),
      ('b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f'::uuid, 'editor', 'Editor', false),
      ('ef2075c7-9fbc-4c66-8dd1-6528bb810786'::uuid, 'editor', 'เวช',    true),
      ('379a49df-8ff7-4110-af6c-701cd8dca6aa'::uuid, 'hr',     'HR',     NULL),
      ('bcfc52ef-740f-40b1-8b24-d533585dcb4a'::uuid, 'sales',  'sale',   NULL),
      ('b0ec6eca-650e-4adc-9503-316c1dd1afec'::uuid, 'staff',  'Staff',  NULL)
    ) AS v(id, role, name, granted)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.id AND p.role = r.role) THEN
      RAISE WARNING 'account % (%) is no longer %', r.name, r.id, r.role;
      v_bad := v_bad + 1;
    END IF;
    IF r.granted IS NOT NULL AND r.granted IS DISTINCT FROM EXISTS (
         SELECT 1 FROM public.prep_recipe_access a
          WHERE a.profile_id = r.id
            AND a.prep_recipe_id = 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c') THEN
      RAISE WARNING 'account % should % a grant on กะทิราดข้าวเหนียว', r.name,
        CASE WHEN r.granted THEN 'hold' ELSE 'not hold' END;
      v_bad := v_bad + 1;
    END IF;
  END LOOP;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% account(s) changed since 2026-09-17, and the checks below depend on them. Nothing applied.', v_bad;
  END IF;

  PERFORM pg_temp.note('live current_role(): ' || pg_get_functiondef('public.current_role()'::regprocedure));
  PERFORM pg_temp.note('live is_owner_only(): ' || pg_get_functiondef('public.is_owner_only()'::regprocedure));
  PERFORM pg_temp.note('live can_see_prep(): ' || pg_get_functiondef('public.can_see_prep(uuid)'::regprocedure));

  FOR r IN
    SELECT schemaname, tablename, policyname, permissive, cmd, roles, qual, with_check
      FROM pg_policies
     WHERE (schemaname = 'public' AND tablename IN ('profiles', 'expense_entries', 'coa', 'pending_changes'))
        OR (schemaname = 'storage' AND tablename = 'objects')
     ORDER BY 1, 2, 3
  LOOP
    PERFORM pg_temp.note(format('existing: %s.%s.%s [%s %s] TO %s USING %s WITH CHECK %s',
      r.schemaname, r.tablename, r.policyname, r.permissive, r.cmd, r.roles,
      coalesce(r.qual, '-'), coalesce(r.with_check, '-')));
  END LOOP;

  FOR r IN
    SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
     WHERE conrelid IN ('public.profiles'::regclass, 'public.pending_changes'::regclass)
       AND contype = 'c'
  LOOP
    PERFORM pg_temp.note(format('check constraint: %s %s', r.conname, r.def));
  END LOOP;
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
-- PART A. profiles (queue item 29, 1–3)
-- ============================================================================
--
-- The repo's only write policy is profiles_owner_write, FOR ALL, USING and
-- WITH CHECK is_owner(), and is_owner() means owner OR admin. So an admin
-- could, with one direct call:
--   - set its OWN role to owner (the owner-row triggers in 007 only guard a
--     row that is ALREADY owner), and then, as an owner, demote or delete the
--     real owner;
--   - set any other row's role to hr, which reads every employee's pay;
--   - rename or re-link the owner's, an hr account's or another admin's row;
--   - insert a profile with role owner for a login that has none.
--
-- The rule below is the one the team screen shows and owner/team/actions.ts
-- now enforces (src/lib/team-rules.ts):
--   owner  any row, any role (the 007 triggers still keep the last owner);
--   admin  its own row and staff, editor and sales rows; may give only the
--          roles admin, sales, editor and staff; deletes only staff, editor
--          and sales rows; never inserts.
-- The owner's own limits on the screen (no re-role of an owner row, no
-- self-delete) are app rules only; the database keeps the owner's reach.
-- So is the rule that keeps an admin off any account holding prep grants:
-- what it protects is the login (a password reset), which is a service-role
-- call no table policy sees.
--
-- New logins are unaffected: handle_new_user() inserts the profile as its
-- owner, which row-level security does not apply to.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.check_a(p_after boolean)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  owner_  constant uuid := '6c8a428c-386b-40f9-9758-c643b7219815';
  admin_  constant uuid := 'c0d216ea-941b-44fc-b19c-f330fb9a4efd';
  oo_     constant uuid := 'f19d0fee-4c9a-4084-9479-92a908f30169';
  hr_     constant uuid := '379a49df-8ff7-4110-af6c-701cd8dca6aa';
  sales_  constant uuid := 'bcfc52ef-740f-40b1-8b24-d533585dcb4a';
  staff_  constant uuid := 'b0ec6eca-650e-4adc-9503-316c1dd1afec';
BEGIN
  -- Negative controls: an admin.
  PERFORM pg_temp.t(p_after, 'A1 admin makes itself owner', admin_, 'admin',
    format($q$UPDATE public.profiles SET role = 'owner' WHERE id = %L$q$, admin_), 'denied');
  PERFORM pg_temp.t(p_after, 'A2 admin moves Staff to hr', admin_, 'admin',
    format($q$UPDATE public.profiles SET role = 'hr' WHERE id = %L$q$, staff_), 'denied');
  PERFORM pg_temp.t(p_after, 'A3 admin edits the owner''s row', admin_, 'admin',
    format($q$UPDATE public.profiles SET full_name = full_name WHERE id = %L$q$, owner_), 'blocked');
  PERFORM pg_temp.t(p_after, 'A4 admin edits the hr account', admin_, 'admin',
    format($q$UPDATE public.profiles SET full_name = full_name WHERE id = %L$q$, hr_), 'blocked');
  PERFORM pg_temp.t(p_after, 'A5 admin re-roles another admin', admin_, 'admin',
    format($q$UPDATE public.profiles SET role = 'staff' WHERE id = %L$q$, oo_), 'blocked');
  PERFORM pg_temp.t(p_after, 'A6 admin deletes the hr account', admin_, 'admin',
    format($q$DELETE FROM public.profiles WHERE id = %L$q$, hr_), 'blocked');
  PERFORM pg_temp.t(p_after, 'A7 admin inserts an owner profile', admin_, 'admin',
    $q$INSERT INTO public.profiles (id, full_name, role) VALUES (gen_random_uuid(), 'probe', 'owner')$q$, 'denied');
  -- Positive controls: the same admin, on what the screen lets it do.
  PERFORM pg_temp.t(p_after, 'A8 admin edits Staff', admin_, 'admin',
    format($q$UPDATE public.profiles SET full_name = full_name WHERE id = %L$q$, staff_), 'rows=1');
  PERFORM pg_temp.t(p_after, 'A9 admin moves Staff to editor', admin_, 'admin',
    format($q$UPDATE public.profiles SET role = 'editor' WHERE id = %L$q$, staff_), 'rows=1');
  PERFORM pg_temp.t(p_after, 'A10 admin makes Staff an admin', admin_, 'admin',
    format($q$UPDATE public.profiles SET role = 'admin' WHERE id = %L$q$, staff_), 'rows=1');
  PERFORM pg_temp.t(p_after, 'A11 admin edits its own row', admin_, 'admin',
    format($q$UPDATE public.profiles SET full_name = full_name WHERE id = %L$q$, admin_), 'rows=1');
  PERFORM pg_temp.t(p_after, 'A12 admin deletes the sales account', admin_, 'admin',
    format($q$DELETE FROM public.profiles WHERE id = %L$q$, sales_), 'soft allowed');
  -- The owner keeps its reach.
  PERFORM pg_temp.t(p_after, 'A13 owner moves Staff to hr', owner_, 'owner',
    format($q$UPDATE public.profiles SET role = 'hr' WHERE id = %L$q$, staff_), 'rows=1');
  PERFORM pg_temp.t(p_after, 'A14 owner edits the hr account', owner_, 'owner',
    format($q$UPDATE public.profiles SET full_name = full_name WHERE id = %L$q$, hr_), 'rows=1');
  PERFORM pg_temp.t(p_after, 'A15 owner edits an admin', owner_, 'owner',
    format($q$UPDATE public.profiles SET full_name = full_name WHERE id = %L$q$, oo_), 'rows=1');
  -- Reads are not changed.
  PERFORM pg_temp.t(p_after, 'A16 admin still lists every account', admin_, 'admin',
    $q$SELECT id FROM public.profiles$q$, format('rows=%s', (SELECT count(*) FROM public.profiles)));
END
$fn$;

SELECT pg_temp.check_a(false);

DROP POLICY IF EXISTS profiles_scope_insert ON public.profiles;
CREATE POLICY profiles_scope_insert ON public.profiles
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.is_owner_only());

DROP POLICY IF EXISTS profiles_scope_update ON public.profiles;
CREATE POLICY profiles_scope_update ON public.profiles
  AS RESTRICTIVE FOR UPDATE TO public
  USING (
    public.is_owner_only()
    OR (public.current_role() = 'admin'
        AND (id = auth.uid() OR role IN ('staff', 'editor', 'sales')))
  )
  WITH CHECK (
    public.is_owner_only()
    OR (public.current_role() = 'admin'
        AND role IN ('admin', 'sales', 'editor', 'staff'))
  );

DROP POLICY IF EXISTS profiles_scope_delete ON public.profiles;
CREATE POLICY profiles_scope_delete ON public.profiles
  AS RESTRICTIVE FOR DELETE TO public
  USING (
    public.is_owner_only()
    OR (public.current_role() = 'admin' AND role IN ('staff', 'editor', 'sales'))
  );

SELECT pg_temp.check_a(true);

COMMIT;


-- ============================================================================
-- PART B. expense_entries and coa: owner-only accounts (queue item 29, 4)
-- ============================================================================
--
-- expense_all admits every admin to every entry, so the app's is_sensitive
-- checks were the only layer, and three of four writes had none. coa_all
-- admits every admin to every account, so an admin could also clear 790's
-- is_sensitive flag and then write it freely.
--
-- Now, for anyone but the owner:
--   expense_entries  no insert, update or delete of an entry whose account is
--                    not an OPEN one (exists, and is not is_sensitive), before
--                    or after the change;
--   coa              no insert, update or delete of an is_sensitive account,
--                    and no marking an account is_sensitive.
-- READS ARE UNCHANGED, deliberately. Admins still read 790's rows, which is
-- how the "มีรายการที่ไม่แสดง N รายการ" notices count them; whether those
-- notices should exist at all is an open question for the owner.
--
-- The owner's imports (budget69, outsource) write 790 and pass. The POS
-- import, which admins run, writes only 650, 752 and 753.

BEGIN;

CREATE OR REPLACE FUNCTION public.coa_is_open(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- An unknown or NULL code is not open: sensitivity that cannot be read is
  -- not assumed away.
  SELECT COALESCE((SELECT NOT c.is_sensitive FROM public.coa c WHERE c.code = p_code), false);
$fn$;

COMMENT ON FUNCTION public.coa_is_open(text) IS
  'TRUE when the account exists and is not is_sensitive. Used by the '
  'owner-only-account policies on expense_entries (permissions_batch_2026_09_17.sql).';

CREATE OR REPLACE FUNCTION pg_temp.check_b(p_after boolean)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  owner_  constant uuid := '6c8a428c-386b-40f9-9758-c643b7219815';
  admin_  constant uuid := 'c0d216ea-941b-44fc-b19c-f330fb9a4efd';
  v_open  text;
  n_open  bigint;
  n_790   bigint;
BEGIN
  -- The open account with the most entries, and the sensitive entry count,
  -- read as the file's own role, which row-level security does not limit.
  SELECT e.coa_code, count(*) INTO v_open, n_open
    FROM public.expense_entries e JOIN public.coa c ON c.code = e.coa_code
   WHERE NOT c.is_sensitive
   GROUP BY e.coa_code ORDER BY count(*) DESC, e.coa_code LIMIT 1;
  SELECT count(*) INTO n_790 FROM public.expense_entries WHERE coa_code = '790';
  IF p_after AND (n_790 = 0 OR n_open IS NULL) THEN
    RAISE EXCEPTION 'part B needs entries in 790 and in an open account to test anything (790: %, open: %). Nothing applied.', n_790, n_open;
  END IF;

  -- Negative controls: an admin.
  PERFORM pg_temp.t(p_after, 'B1 admin edits 790 entries', admin_, 'admin',
    $q$UPDATE public.expense_entries SET amount = amount WHERE coa_code = '790'$q$, 'blocked');
  PERFORM pg_temp.t(p_after, 'B2 admin deletes 790 entries', admin_, 'admin',
    $q$DELETE FROM public.expense_entries WHERE coa_code = '790'$q$, 'blocked');
  PERFORM pg_temp.t(p_after, 'B3 admin adds a 790 entry', admin_, 'admin',
    $q$INSERT INTO public.expense_entries (entry_date, coa_code, amount, payment_method) VALUES ('2026-09-01', '790', 1, 'cash')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'B4 admin moves an entry into 790', admin_, 'admin',
    format($q$UPDATE public.expense_entries SET coa_code = '790'
               WHERE id = (SELECT id FROM public.expense_entries WHERE coa_code = %L ORDER BY id LIMIT 1)$q$, v_open), 'denied');
  PERFORM pg_temp.t(p_after, 'B5 admin moves 790 entries out', admin_, 'admin',
    format($q$UPDATE public.expense_entries SET coa_code = %L WHERE coa_code = '790'$q$, v_open), 'blocked');
  PERFORM pg_temp.t(p_after, 'B6 admin clears 790''s owner-only flag', admin_, 'admin',
    $q$UPDATE public.coa SET is_sensitive = false WHERE code = '790'$q$, 'blocked');
  PERFORM pg_temp.t(p_after, 'B7 admin marks an open account owner-only', admin_, 'admin',
    format($q$UPDATE public.coa SET is_sensitive = true WHERE code = %L$q$, v_open), 'denied');
  PERFORM pg_temp.t(p_after, 'B8 admin renames 790', admin_, 'admin',
    $q$UPDATE public.coa SET name = name WHERE code = '790'$q$, 'blocked');
  PERFORM pg_temp.t(p_after, 'B9 admin deletes 790', admin_, 'admin',
    $q$DELETE FROM public.coa WHERE code = '790'$q$, 'blocked');
  PERFORM pg_temp.t(p_after, 'B10 admin adds an owner-only account', admin_, 'admin',
    $q$INSERT INTO public.coa (code, name, group_code, group_name, sort_order, is_sensitive)
       VALUES ('probe-b10', 'probe', 'G700', 'บริหาร (G&A)', 99999, true)$q$, 'denied');
  -- Positive controls: the same admin, on open accounts.
  PERFORM pg_temp.t(p_after, format('B11 admin edits %s entries', v_open), admin_, 'admin',
    format($q$UPDATE public.expense_entries SET amount = amount WHERE coa_code = %L$q$, v_open), format('rows=%s', n_open));
  PERFORM pg_temp.t(p_after, format('B12 admin adds a %s entry', v_open), admin_, 'admin',
    format($q$INSERT INTO public.expense_entries (entry_date, coa_code, amount, payment_method) VALUES ('2026-09-01', %L, 1, 'cash')$q$, v_open), 'rows=1');
  PERFORM pg_temp.t(p_after, format('B13 admin renames account %s', v_open), admin_, 'admin',
    format($q$UPDATE public.coa SET name = name WHERE code = %L$q$, v_open), 'rows=1');
  PERFORM pg_temp.t(p_after, 'B14 admin adds an open account', admin_, 'admin',
    $q$INSERT INTO public.coa (code, name, group_code, group_name, sort_order, is_sensitive)
       VALUES ('probe-b14', 'probe', 'G700', 'บริหาร (G&A)', 99999, false)$q$, 'rows=1');
  -- Reads unchanged.
  PERFORM pg_temp.t(p_after, 'B15 admin still reads 790 entries', admin_, 'admin',
    $q$SELECT id FROM public.expense_entries WHERE coa_code = '790'$q$, format('rows=%s', n_790));
  -- The owner keeps its reach.
  PERFORM pg_temp.t(p_after, 'B16 owner edits 790 entries', owner_, 'owner',
    $q$UPDATE public.expense_entries SET amount = amount WHERE coa_code = '790'$q$, format('rows=%s', n_790));
  PERFORM pg_temp.t(p_after, 'B17 owner renames 790', owner_, 'owner',
    $q$UPDATE public.coa SET name = name WHERE code = '790'$q$, 'rows=1');
END
$fn$;

SELECT pg_temp.check_b(false);

DROP POLICY IF EXISTS expense_open_accounts_insert ON public.expense_entries;
CREATE POLICY expense_open_accounts_insert ON public.expense_entries
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.is_owner_only() OR public.coa_is_open(coa_code));

DROP POLICY IF EXISTS expense_open_accounts_update ON public.expense_entries;
CREATE POLICY expense_open_accounts_update ON public.expense_entries
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.is_owner_only() OR public.coa_is_open(coa_code))
  WITH CHECK (public.is_owner_only() OR public.coa_is_open(coa_code));

DROP POLICY IF EXISTS expense_open_accounts_delete ON public.expense_entries;
CREATE POLICY expense_open_accounts_delete ON public.expense_entries
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.is_owner_only() OR public.coa_is_open(coa_code));

DROP POLICY IF EXISTS coa_sensitive_owner_insert ON public.coa;
CREATE POLICY coa_sensitive_owner_insert ON public.coa
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.is_owner_only() OR NOT is_sensitive);

DROP POLICY IF EXISTS coa_sensitive_owner_update ON public.coa;
CREATE POLICY coa_sensitive_owner_update ON public.coa
  AS RESTRICTIVE FOR UPDATE TO public
  USING      (public.is_owner_only() OR NOT is_sensitive)
  WITH CHECK (public.is_owner_only() OR NOT is_sensitive);

DROP POLICY IF EXISTS coa_sensitive_owner_delete ON public.coa;
CREATE POLICY coa_sensitive_owner_delete ON public.coa
  AS RESTRICTIVE FOR DELETE TO public
  USING (public.is_owner_only() OR NOT is_sensitive);

SELECT pg_temp.check_b(true);

COMMIT;


-- ============================================================================
-- PART C. pending_changes: prep requests follow prep visibility (item 31)
-- ============================================================================
--
-- The approval queue, the header badge, approveChange and rejectChange hide
-- or refuse a request about a prep the viewer may not see. The table's own
-- read policy ("pending read", 006) admitted every admin to every row, and a
-- recipe_edit request carries the prep's whole item list, so an admin with
-- no grant could read a hidden recipe from its requests by a direct call.
--
-- pending_change_prep_id() is the SQL twin of prepIdOfChange()
-- (src/lib/pending-prep-id.ts). The check below runs it on the same cases as
-- src/lib/pending-prep-id.test.ts. Change the two together.
--
-- EDITORS ARE GATED TOO. An editor whose grant was revoked no longer reads
-- that prep's requests, including their own. The app saves a request with
-- INSERT ... RETURNING, which is checked against this read policy; every
-- editor save path checks canSeePrep first, so this refuses only a save made
-- in the moment a grant is revoked, and then with an error, not silently.
--
-- A prep id that is not a uuid is visible to the owner only, and cannot
-- break the read (the cast is guarded). An admin who approves or rejects a
-- hidden request now gets "ไม่พบรายการนี้" from the database's side; the app
-- already refused it before reaching the table.
--
-- A prep_delete whose prep NO LONGER EXISTS is visible to every reader. It
-- carries only the prep's id and name. Without this, an admin with the grant
-- who approves a deletion loses sight of the request the moment the prep
-- (and with it, by cascade, the grant) is deleted, so the approval could not
-- mark it approved. Found by the review, 2026-09-17.
--
-- NEW REQUESTS: only an editor files one (every app path that saves a
-- request is an editor's), and only about a prep that editor can see NOW:
-- pending_change_fileable() is the read rule WITHOUT the exception above,
-- or an editor could file a deletion for a prep that does not exist yet and
-- that nobody will ever grant them. Until now any signed-in account could
-- insert any request, with any payload, and an insert that does not read
-- the row back is not checked against a read policy at all.
--
-- CHANGED REQUESTS: a request's type, target and payload can no longer be
-- rewritten after filing. UPDATE is granted only on the four columns that
-- approving or rejecting writes (status, admin_note, resolved_at,
-- resolved_by); nothing else in the app updates this table.
--
-- None of the 157 requests on 2026-09-17 is about a prep, so the check uses
-- eleven synthetic requests, inserted and removed inside this transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.pending_change_prep_id(
  p_change_type text, p_target_id text, p_payload jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE p_change_type
    WHEN 'recipe_edit' THEN
      CASE WHEN p_payload -> 'target' = '"menu"'::jsonb THEN NULL
           ELSE COALESCE(CASE WHEN jsonb_typeof(p_payload -> 'parentId') = 'string'
                              THEN p_payload ->> 'parentId' END, p_target_id) END
    WHEN 'prep_yield_edit' THEN
      COALESCE(CASE WHEN jsonb_typeof(p_payload -> 'parentId') = 'string'
                    THEN p_payload ->> 'parentId' END, p_target_id)
    WHEN 'prep_delete' THEN
      COALESCE(CASE WHEN jsonb_typeof(p_payload -> 'prepId') = 'string'
                    THEN p_payload ->> 'prepId' END, p_target_id)
    WHEN 'prep_create' THEN
      CASE WHEN jsonb_typeof(p_payload -> 'duplicatedFrom') = 'string'
           THEN p_payload ->> 'duplicatedFrom' END
  END;
$fn$;

COMMENT ON FUNCTION public.pending_change_prep_id(text, text, jsonb) IS
  'The prep a pending change is about, or NULL. SQL twin of prepIdOfChange() '
  'in src/lib/pending-prep-id.ts; change both together.';

-- Whether a prep row exists, whoever asks. A caller's own read of
-- prep_recipes hides the preps it may not see, so "not found" through it
-- would mean "hidden" as often as "gone".
CREATE OR REPLACE FUNCTION public.prep_recipe_exists(p_prep_recipe_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.prep_recipes WHERE id = p_prep_recipe_id);
$fn$;

CREATE OR REPLACE FUNCTION public.pending_change_visible(
  p_change_type text, p_target_id text, p_payload jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN s.pid IS NULL THEN true
    -- The order of the WHENs guards the casts below: a malformed id must
    -- hide the row, not break the read for everyone.
    WHEN s.pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN public.is_owner_only()
    -- A deletion whose prep is already gone (see the part's header).
    WHEN p_change_type = 'prep_delete' AND NOT public.prep_recipe_exists(s.pid::uuid)
      THEN true
    ELSE COALESCE(public.can_see_prep(s.pid::uuid), false)
  END
  FROM (SELECT public.pending_change_prep_id(p_change_type, p_target_id, p_payload) AS pid) s;
$fn$;

COMMENT ON FUNCTION public.pending_change_visible(text, text, jsonb) IS
  'FALSE when a pending change is about a prep the caller may not see. '
  'Used by the pending_prep_visibility policy (permissions_batch_2026_09_17.sql).';

-- The rule for FILING: as pending_change_visible, without the exception for
-- a deletion whose prep does not exist. A CASE, so the cast is guarded.
CREATE OR REPLACE FUNCTION public.pending_change_fileable(
  p_change_type text, p_target_id text, p_payload jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN s.pid IS NULL THEN true
    WHEN s.pid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN false
    ELSE COALESCE(public.can_see_prep(s.pid::uuid), false)
  END
  FROM (SELECT public.pending_change_prep_id(p_change_type, p_target_id, p_payload) AS pid) s;
$fn$;

COMMENT ON FUNCTION public.pending_change_fileable(text, text, jsonb) IS
  'May the caller file this pending change? Used by the pending_editor_files '
  'policy (permissions_batch_2026_09_17.sql).';

-- The same cases as src/lib/pending-prep-id.test.ts.
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('recipe_edit on a prep', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
        '{"target":"prep","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c'),
      ('recipe_edit on a menu', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
        '{"target":"menu","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', NULL),
      ('recipe_edit, target not exactly menu', 'recipe_edit', '11111111-1111-4111-8111-111111111111',
        '{"target":"Prep","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c'),
      ('recipe_edit with no target', 'recipe_edit', '11111111-1111-4111-8111-111111111111',
        '{"parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c'),
      ('recipe_edit, parentId not a string', 'recipe_edit', '11111111-1111-4111-8111-111111111111',
        '{"target":"prep","parentId":5}', '11111111-1111-4111-8111-111111111111'),
      ('recipe_edit, parentId not a uuid', 'recipe_edit', '11111111-1111-4111-8111-111111111111',
        '{"target":"prep","parentId":"nope"}', 'nope'),
      ('recipe_edit, empty parentId', 'recipe_edit', '11111111-1111-4111-8111-111111111111',
        '{"target":"prep","parentId":""}', ''),
      ('recipe_edit, JSON null payload', 'recipe_edit', '11111111-1111-4111-8111-111111111111',
        'null', '11111111-1111-4111-8111-111111111111'),
      ('recipe_edit, array payload', 'recipe_edit', '11111111-1111-4111-8111-111111111111',
        '[1,2]', '11111111-1111-4111-8111-111111111111'),
      ('prep_yield_edit writes parentId', 'prep_yield_edit', '11111111-1111-4111-8111-111111111111',
        '{"parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c'),
      ('prep_yield_edit, no parentId', 'prep_yield_edit', '11111111-1111-4111-8111-111111111111',
        '{}', '11111111-1111-4111-8111-111111111111'),
      ('prep_delete on prepId', 'prep_delete', '11111111-1111-4111-8111-111111111111',
        '{"prepId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c'),
      ('prep_delete, no prepId', 'prep_delete', '11111111-1111-4111-8111-111111111111',
        '{}', '11111111-1111-4111-8111-111111111111'),
      ('a duplicate prep is about its source', 'prep_create', 'dup:x',
        '{"duplicatedFrom":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c'),
      ('a new prep is about nothing', 'prep_create', 'new:x', '{"name":"x"}', NULL),
      ('duplicatedFrom not a string', 'prep_create', 'dup:x', '{"duplicatedFrom":7}', NULL),
      ('a menu duplicate', 'menu_create', 'dup:x',
        '{"duplicatedFrom":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', NULL),
      ('other types', 'ingredient_edit', '11111111-1111-4111-8111-111111111111',
        '{"target":"prep","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","prepId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}', NULL)
    ) AS v(label, change_type, target_id, payload, want)
  LOOP
    IF public.pending_change_prep_id(r.change_type, r.target_id, r.payload::jsonb) IS DISTINCT FROM r.want THEN
      RAISE EXCEPTION 'pending_change_prep_id disagrees with prepIdOfChange on "%": % instead of %. Nothing applied.',
        r.label, public.pending_change_prep_id(r.change_type, r.target_id, r.payload::jsonb), r.want;
    END IF;
  END LOOP;
  PERFORM pg_temp.note('ok      pending_change_prep_id agrees with prepIdOfChange on 18 cases');
END
$do$;

-- Eleven synthetic requests from เวช, all about กะทิราดข้าวเหนียว unless noted:
--   c1 recipe_edit, target prep            c6 prep_create, duplicate
--   c2 recipe_edit, target "Prep"          c7 prep_create, new (about no prep)
--   c3 recipe_edit, target menu (no prep)  c8 recipe_edit, parentId "nope"
--   c4 prep_yield_edit, target_id not a    c9 recipe_edit, JSON null payload,
--      uuid, parentId the prep                target_id the prep
--   c5 prep_delete                         c10 prep_delete of a prep that
--                                              does not exist (deleted)
--                                          c11 recipe_edit of that same
--                                              missing prep (stays hidden:
--                                              the exception is for
--                                              deletions only)
INSERT INTO public.pending_changes (id, editor_id, change_type, target_id, payload) VALUES
  ('c3100000-0000-4000-8000-000000000001', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
    '{"target":"prep","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","items":[]}'),
  ('c3100000-0000-4000-8000-000000000002', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
    '{"target":"Prep","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","items":[]}'),
  ('c3100000-0000-4000-8000-000000000003', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
    '{"target":"menu","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","items":[]}'),
  ('c3100000-0000-4000-8000-000000000004', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'prep_yield_edit', 'probe-not-a-uuid',
    '{"parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","qty":1,"unit":"g"}'),
  ('c3100000-0000-4000-8000-000000000005', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'prep_delete', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
    '{"prepId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}'),
  ('c3100000-0000-4000-8000-000000000006', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'prep_create', 'dup:probe',
    '{"name":"probe","duplicatedFrom":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c"}'),
  ('c3100000-0000-4000-8000-000000000007', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'prep_create', 'new:probe',
    '{"name":"probe"}'),
  ('c3100000-0000-4000-8000-000000000008', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'recipe_edit', 'probe-not-a-uuid',
    '{"target":"prep","parentId":"nope","items":[]}'),
  ('c3100000-0000-4000-8000-000000000009', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
    'null'),
  ('c3100000-0000-4000-8000-000000000010', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'prep_delete', 'c31000de-0000-4000-8000-00000000dead',
    '{"prepId":"c31000de-0000-4000-8000-00000000dead","prepName":"probe"}'),
  ('c3100000-0000-4000-8000-000000000011', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'recipe_edit', 'c31000de-0000-4000-8000-00000000dead',
    '{"target":"prep","parentId":"c31000de-0000-4000-8000-00000000dead","items":[]}');

DO $do$
BEGIN
  IF public.prep_recipe_exists('c31000de-0000-4000-8000-00000000dead') THEN
    RAISE EXCEPTION 'the "deleted prep" id used by c10 exists. Nothing applied.';
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION pg_temp.check_c(p_after boolean)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  owner_   constant uuid := '6c8a428c-386b-40f9-9758-c643b7219815';
  admin_   constant uuid := 'c0d216ea-941b-44fc-b19c-f330fb9a4efd';
  oo_      constant uuid := 'f19d0fee-4c9a-4084-9479-92a908f30169';
  heng_    constant uuid := '8c4c865a-1ebe-4363-817a-fb3779a3c048';
  editor_  constant uuid := 'b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f';
  wech_    constant uuid := 'ef2075c7-9fbc-4c66-8dd1-6528bb810786';
  staff_   constant uuid := 'b0ec6eca-650e-4adc-9503-316c1dd1afec';
  synth    constant text := $q$SELECT id FROM public.pending_changes WHERE id::text LIKE 'c3100000-0000-4000-8000-%'$q$;
  n_real   bigint;
BEGIN
  SELECT count(*) INTO n_real FROM public.pending_changes WHERE id::text NOT LIKE 'c3100000-0000-4000-8000-%';

  -- Negative controls: admins with no grant see only c3, c7 and c10 (not
  -- c11: a missing prep hides every request but a deletion).
  PERFORM pg_temp.t(p_after, 'C1 admin (no grant) reads the synthetic requests', admin_, 'admin', synth, 'rows=3');
  PERFORM pg_temp.t(p_after, 'C2 อู๋ (no grant) reads the synthetic requests', oo_, 'admin', synth, 'rows=3');
  PERFORM pg_temp.t(p_after, 'C3 admin (no grant) updates a hidden request', admin_, 'admin',
    $q$UPDATE public.pending_changes SET admin_note = admin_note WHERE id = 'c3100000-0000-4000-8000-000000000001'$q$, 'blocked');
  PERFORM pg_temp.t(p_after, 'C4 Editor (no grant) saves a prep request, read back', editor_, 'editor',
    $q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
       VALUES ('b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
               '{"target":"prep","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","items":[]}') RETURNING id$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'C5 staff files a request', staff_, 'staff',
    $q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
       VALUES ('b0ec6eca-650e-4adc-9503-316c1dd1afec', 'menu_delete', 'probe', '{"menuName":"probe"}')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'C6 Editor (no grant) files a prep request, not read back', editor_, 'editor',
    $q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
       VALUES ('b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f', 'prep_delete', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
               '{"prepId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","prepName":"probe"}')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'C7 Editor (no grant) files a deletion of a prep that does not exist', editor_, 'editor',
    $q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
       VALUES ('b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f', 'prep_delete', 'c31000de-0000-4000-8000-00000000dead',
               '{"prepId":"c31000de-0000-4000-8000-00000000dead","prepName":"probe"}')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'C8 เวช (grant) files a deletion of a prep that does not exist', wech_, 'editor',
    $q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
       VALUES ('ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'prep_delete', 'c31000de-0000-4000-8000-00000000dead',
               '{"prepId":"c31000de-0000-4000-8000-00000000dead","prepName":"probe"}')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'C9 admin (no grant) rewrites a request it can see', admin_, 'admin',
    $q$UPDATE public.pending_changes SET payload = payload WHERE id = 'c3100000-0000-4000-8000-000000000003'$q$, 'no-privilege');
  -- Positive controls: an admin WITH the grant sees all but c8 (no uuid)
  -- and c11 (a missing prep); the owner sees all eleven; the editor who
  -- wrote them, with the grant, as เฮง does; and every real request is
  -- still there for an admin.
  PERFORM pg_temp.t(p_after, 'C10 เฮง (grant) reads the synthetic requests', heng_, 'admin', synth, 'rows=9');
  PERFORM pg_temp.t(p_after, 'C11 owner reads the synthetic requests', owner_, 'owner', synth, 'rows=11');
  PERFORM pg_temp.t(p_after, 'C12 เวช (grant, author) reads the synthetic requests', wech_, 'editor', synth, 'rows=9');
  -- Approving or rejecting writes the status: the same admins, same command.
  PERFORM pg_temp.t(p_after, 'C13 เฮง (grant) updates a prep request', heng_, 'admin',
    $q$UPDATE public.pending_changes SET admin_note = admin_note WHERE id = 'c3100000-0000-4000-8000-000000000001'$q$, 'rows=1');
  PERFORM pg_temp.t(p_after, 'C14 admin (no grant) updates a menu request', admin_, 'admin',
    $q$UPDATE public.pending_changes SET admin_note = admin_note WHERE id = 'c3100000-0000-4000-8000-000000000003'$q$, 'rows=1');
  PERFORM pg_temp.t(p_after, 'C15 เฮง resolves a deletion whose prep is gone', heng_, 'admin',
    $q$UPDATE public.pending_changes SET admin_note = admin_note WHERE id = 'c3100000-0000-4000-8000-000000000010'$q$, 'rows=1');
  PERFORM pg_temp.t(p_after, 'C16 Editor (no grant) files a menu request, not read back', editor_, 'editor',
    $q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
       VALUES ('b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f', 'menu_delete', 'probe', '{"menuName":"probe"}')$q$, 'rows=1');
  PERFORM pg_temp.t(p_after, 'C17 เวช saves a prep request, read back', wech_, 'editor',
    $q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
       VALUES ('ef2075c7-9fbc-4c66-8dd1-6528bb810786', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
               '{"target":"prep","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","items":[]}') RETURNING id$q$, 'rows=1');
  PERFORM pg_temp.t(p_after, 'C18 Editor saves a menu request, read back', editor_, 'editor',
    $q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
       VALUES ('b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f', 'recipe_edit', 'fc8c4a24-5c9d-4569-9e40-113f4a2ae07c',
               '{"target":"menu","parentId":"fc8c4a24-5c9d-4569-9e40-113f4a2ae07c","items":[]}') RETURNING id$q$, 'rows=1');
  PERFORM pg_temp.t(p_after, 'C19 admin (no grant) reads every real request', admin_, 'admin',
    $q$SELECT id FROM public.pending_changes WHERE id::text NOT LIKE 'c3100000-0000-4000-8000-%'$q$, format('rows=%s', n_real));
END
$fn$;

SELECT pg_temp.check_c(false);

DROP POLICY IF EXISTS pending_prep_visibility ON public.pending_changes;
CREATE POLICY pending_prep_visibility ON public.pending_changes
  AS RESTRICTIVE FOR SELECT TO public
  USING (public.pending_change_visible(change_type, target_id, payload));

DROP POLICY IF EXISTS pending_editor_files ON public.pending_changes;
CREATE POLICY pending_editor_files ON public.pending_changes
  AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (
    public.current_role() = 'editor'
    AND public.pending_change_fileable(change_type, target_id, payload)
  );

REVOKE UPDATE ON public.pending_changes FROM anon, authenticated;
GRANT UPDATE (status, admin_note, resolved_at, resolved_by) ON public.pending_changes TO authenticated;

SELECT pg_temp.check_c(true);

DO $do$
DECLARE
  v_n bigint;
BEGIN
  DELETE FROM public.pending_changes WHERE id::text LIKE 'c3100000-0000-4000-8000-%';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 11 THEN
    RAISE EXCEPTION 'removed % synthetic requests, expected 11. Nothing applied.', v_n;
  END IF;
  PERFORM pg_temp.note('ok      the 11 synthetic requests are removed');
END
$do$;

COMMIT;


-- ============================================================================
-- PART D. storage: who may upload to sop-photos (item 30, decision 2)
-- ============================================================================
--
-- Reads stay public (the owner's decision, 2026-09-17). The three write
-- policies in migrations/004_sop_module.sql let any signed-in account
-- upload, OVERWRITE or DELETE any file in the bucket.
--
-- The app only ever uploads, from the browser, each file under a new name at
-- the top of the bucket (sop-photo-upload.tsx, upsert false). It never
-- overwrites, deletes, moves or copies. So:
--   upload   <digits>-<letters/digits>.jpg              SOP step photos:
--              owner, admin, editor (the SOP edit page's guard; an editor
--              uploads before the request is approved)
--            maint-<digits>-<letters/digits>.jpg        a maintenance report:
--              every role (every role can file one)
--            maint-after-<digits>-<letters/digits>.jpg  the "done" photo:
--              owner, admin, editor (who may mark a report done)
--   overwrite, delete   nobody, through the API. The service key (scripts)
--            is not subject to these policies.
-- A name is chosen by the browser, so this ties a NAME PATTERN to a role; it
-- does not tie a file to a report. The 58 files in sop-<uuid>/ folders were
-- not written by the app and are only read.
--
-- TWO SEPARATE TRANSACTIONS on purpose: the function first, then the
-- policies. If this database does not let the SQL editor change policies on
-- storage.objects ("must be owner of table objects"), parts A to C and the
-- function have already committed. Then make the change in the dashboard
-- (Storage → Policies), in this order:
--   1. add, for authenticated, INSERT:
--        bucket_id = 'sop-photos' AND public.sop_photo_upload_allowed(name)
--   2. delete the three "sop photos auth ..." policies;
--   3. check the list the dashboard shows: NO other INSERT, UPDATE or DELETE
--      policy may cover sop-photos. The dashboard cannot make the
--      restrictive caps below, so this check is what replaces them.
--
-- The upload checks here insert catalogue rows directly, which is not how
-- the storage service uploads. Where that differs, a check prints NOT
-- DEMONSTRATED instead of stopping, and the uploads at the end of this file
-- are the proof. A check that finds an upload REFUSED where it must work, or
-- a write ALLOWED where it must not, still stops the file.

BEGIN;

DO $do$
BEGIN
  PERFORM pg_temp.note(format('privileges on storage.objects: authenticated insert %s, update %s, delete %s; anon insert %s',
    has_table_privilege('authenticated', 'storage.objects', 'INSERT'),
    has_table_privilege('authenticated', 'storage.objects', 'UPDATE'),
    has_table_privilege('authenticated', 'storage.objects', 'DELETE'),
    has_table_privilege('anon', 'storage.objects', 'INSERT')));
END
$do$;

CREATE OR REPLACE FUNCTION public.sop_photo_upload_allowed(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(CASE
    WHEN p_name ~ '^maint-after-[0-9]+-[0-9a-z]*\.jpg$'
      THEN public.current_role() IN ('owner', 'admin', 'editor')
    WHEN p_name ~ '^maint-[0-9]+-[0-9a-z]*\.jpg$'
      THEN public.current_role() IN ('owner', 'admin', 'editor', 'staff', 'hr', 'sales')
    WHEN p_name ~ '^[0-9]+-[0-9a-z]*\.jpg$'
      THEN public.current_role() IN ('owner', 'admin', 'editor')
    ELSE false
  END, false);
$fn$;

COMMENT ON FUNCTION public.sop_photo_upload_allowed(text) IS
  'May the caller upload a file with this name to sop-photos? Name patterns '
  'are those sop-photo-upload.tsx generates. permissions_batch_2026_09_17.sql.';

COMMIT;

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.check_d(p_after boolean)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  admin_   constant uuid := 'c0d216ea-941b-44fc-b19c-f330fb9a4efd';
  editor_  constant uuid := 'b2b3ff09-54b7-4051-9d79-c6f8c5c2ad8f';
  sales_   constant uuid := 'bcfc52ef-740f-40b1-8b24-d533585dcb4a';
  staff_   constant uuid := 'b0ec6eca-650e-4adc-9503-316c1dd1afec';
  n_files  bigint;
BEGIN
  SELECT count(*) INTO n_files FROM storage.objects WHERE bucket_id = 'sop-photos';

  -- Negative controls: staff, who may upload a report photo and nothing else.
  PERFORM pg_temp.t(p_after, 'D1 staff uploads an SOP photo', staff_, 'staff',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', '1700000000000-probed1.jpg')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'D2 staff uploads a "done" photo', staff_, 'staff',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', 'maint-after-1700000000000-probed2.jpg')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'D3 staff uploads a file of its own naming', staff_, 'staff',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', 'probe-d3.png')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'D4 editor uploads into a folder', editor_, 'editor',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', 'x/1700000000000-probed4.jpg')$q$, 'denied');
  PERFORM pg_temp.t(p_after, 'D5 staff rewrites every photo', staff_, 'staff',
    $q$UPDATE storage.objects SET name = name WHERE bucket_id = 'sop-photos'$q$, 'soft blocked');
  PERFORM pg_temp.t(p_after, 'D6 editor rewrites every photo', editor_, 'editor',
    $q$UPDATE storage.objects SET name = name WHERE bucket_id = 'sop-photos'$q$, 'soft blocked');
  -- Newer storage versions refuse ANY direct delete unless this is set, which
  -- would hide what the policy does. Set for this one test only.
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  PERFORM pg_temp.t(p_after, 'D7 staff deletes every photo', staff_, 'staff',
    $q$DELETE FROM storage.objects WHERE bucket_id = 'sop-photos'$q$, 'soft blocked');
  PERFORM set_config('storage.allow_delete_query', '', true);
  PERFORM pg_temp.t(p_after, 'D8 no session uploads a report photo', NULL, 'anon',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', 'maint-1700000000000-probed8.jpg')$q$, 'soft denied');
  -- Positive controls: every upload the app makes, by the roles that make it.
  PERFORM pg_temp.t(p_after, 'D9 staff uploads a report photo', staff_, 'staff',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', 'maint-1700000000000-probed9.jpg')$q$, 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'D10 sales uploads a report photo', sales_, 'sales',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', 'maint-1700000000000-probed10.jpg')$q$, 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'D11 editor uploads an SOP photo', editor_, 'editor',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', '1700000000000-probed11.jpg')$q$, 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'D12 editor uploads a "done" photo', editor_, 'editor',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', 'maint-after-1700000000000-probed12.jpg')$q$, 'soft rows=1');
  PERFORM pg_temp.t(p_after, 'D13 admin uploads an SOP photo', admin_, 'admin',
    $q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos', '1700000000000-probed13.jpg')$q$, 'soft rows=1');
  -- Reads unchanged, with no session at all.
  PERFORM pg_temp.t(p_after, 'D14 no session lists every photo', NULL, 'anon',
    $q$SELECT id FROM storage.objects WHERE bucket_id = 'sop-photos'$q$, format('soft rows=%s', n_files));
END
$fn$;

SELECT pg_temp.check_d(false);

-- In a block, so that a refused permission on storage.objects is written
-- into the result instead of hiding it; the block's own changes are rolled
-- back. Only that error is caught: a failed check still stops the file.
DO $do$
BEGIN
  DROP POLICY IF EXISTS "sop photos auth upload" ON storage.objects;
  DROP POLICY IF EXISTS "sop photos auth update" ON storage.objects;
  DROP POLICY IF EXISTS "sop photos auth delete" ON storage.objects;

  DROP POLICY IF EXISTS "sop photos upload by role" ON storage.objects;
  CREATE POLICY "sop photos upload by role" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'sop-photos' AND public.sop_photo_upload_allowed(name));

  -- The caps: whatever other policy exists, these hold for this bucket.
  DROP POLICY IF EXISTS "sop photos upload cap" ON storage.objects;
  CREATE POLICY "sop photos upload cap" ON storage.objects
    AS RESTRICTIVE FOR INSERT TO public
    WITH CHECK (bucket_id <> 'sop-photos' OR public.sop_photo_upload_allowed(name));

  DROP POLICY IF EXISTS "sop photos no overwrite" ON storage.objects;
  CREATE POLICY "sop photos no overwrite" ON storage.objects
    AS RESTRICTIVE FOR UPDATE TO public
    USING (bucket_id <> 'sop-photos')
    WITH CHECK (bucket_id <> 'sop-photos');

  DROP POLICY IF EXISTS "sop photos no delete" ON storage.objects;
  CREATE POLICY "sop photos no delete" ON storage.objects
    AS RESTRICTIVE FOR DELETE TO public
    USING (bucket_id <> 'sop-photos');

  PERFORM pg_temp.check_d(true);
EXCEPTION
  WHEN insufficient_privilege THEN
    PERFORM pg_temp.note('PART D NOT APPLIED: ' || SQLERRM
      || ' — make the change in the dashboard (the steps are in part D''s header), then check the uploads.');
END
$do$;

COMMIT;

-- ── The result: copy this table back whole ─────────────────────────────────

SELECT n, line FROM pg_temp.batch_log ORDER BY n;

-- ═══ After it runs — in the app, as the people it is about ═════════════════
--
-- If the result has a "PART D NOT APPLIED" line, make part D's change in the
-- dashboard first (its header lists the steps).
--
-- The file has already tested each rule as the accounts above. These are the
-- paths it could not exercise the way the app does:
--
-- 1. Photos still SHOW: open any SOP with photos, and a maintenance report
--    with a photo.
-- 2. Uploads still WORK, the next time each happens for real (a test upload
--    would leave one more unused file behind):
--      - an SOP photo picked on an SOP edit page, by an editor or an admin;
--      - a photo on a new maintenance report, by a staff account;
--      - a "done" photo on a maintenance report.
--    A permission error on any of them: report it with the file name the
--    page shows; part D is the cause.
-- 3. The team page, as an admin: staff, editor and sales rows can still be
--    edited; the owner's, hr's and other admins' rows show no buttons, and
--    neither does เวช's, which holds prep grants (that part is the app's).
-- 4. Daily accounting, as an admin: saving and deleting an entry works as
--    before.
-- 5. The approval queue, as an admin: it lists the same requests as before.
