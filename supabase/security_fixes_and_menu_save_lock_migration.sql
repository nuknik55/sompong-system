-- ═══════════════════════════════════════════════════════════════════════════
-- security_fixes_and_menu_save_lock_migration.sql — SECOND VERSION
--
-- NOT APPLIED. The first version (03a3a17) stopped at S2 on 2026-09-26 with
-- "Nothing applied": live pos_price_aliases has no row, and the tests
-- required live rows. This version's tests make their OWN rows inside the
-- block that always rolls back, and it carries Nik's decisions of
-- 2026-09-26 (SOP writes for editors too; salaries for owner and hr only;
-- staff see ingredient names and units, never purchase prices). One
-- transaction: it applies entirely, or nothing.
--
-- EXPECTED RESULT: 124 rows, every line starting "ok", "survey",
-- "note" or "skip", the last one:
--   row count verified: 123 evidence rows emitted, as expected (this line makes 124)
-- Anything that starts "FAIL" stops the file and NOTHING is applied.
--
-- WHAT IT DOES (each is tested below as the real accounts, rolled back):
--  1. Queue item 48: catering_save_event_menus (the menu page's save) locks
--     the booking row first (FOR UPDATE), the lock catering_save_booking_prices
--     already takes, so the two saves wait for each other. md5-guarded
--     against the body 224848f applied.
--  2. Sign-up (audit C1): handle_new_user() gave EVERY new login a 'staff'
--     profile, and public sign-up was found on. It now makes a profile only
--     for the app's own <username>@staff.local logins (the team page's).
--     md5-guarded against migrations/0001_init.sql.
--  3. A login with no profile (audit H3): the read policies that asked only
--     "signed in" now ask for a profile (public.current_role() IS NOT NULL).
--  4. SOPs (audit H1; Nik 2026-09-26): the SOP tables were writable by EVERY
--     signed-in account. Now owner, admin and EDITOR write (เวช writes SOPs).
--  5. Purchase-price history (audit H2): owner, admin and editor read it.
--  6. suppliers and pos_price_aliases (audit H4): their live policies are
--     printed, then replaced by owner/admin read and write.
--  7. templates and template_items: written by owner, admin and editor.
--  8. anon may no longer EXECUTE the seven functions that write.
--  9. prevent_owner_role_change / prevent_owner_delete: SET search_path.
-- 10. sop-photos takes JPEG only, at most 2 MB a file.
-- 11. SALARIES, OWNER AND HR ONLY (Nik 2026-09-26). employees keeps its rows
--     for admin (attendance, leave, schedules, the team page), but its four
--     pay columns — base_salary, position_allowance, social_security_monthly,
--     daily_wage — are no longer selectable by any signed-in account; owner
--     and hr read them through the new view employee_pay. payroll_periods and
--     payroll_entries were already owner/hr (hr_role_patch.sql); tested here.
-- 12. STAFF SEE NO PURCHASE PRICES (Nik 2026-09-26). ingredients keeps its rows
--     for staff (names, units, par levels: ordering, templates, recipes), but
--     purchase_cost, receive_qty and yield_qty are no longer selectable by any
--     signed-in account; owner, admin and editor read them through the new
--     view ingredient_costs. prep_unit_costs() (every prep's cost) and the POS
--     receipt costs (pos_receipt_deliveries) drop staff. prep_unit_costs is
--     md5-guarded against prep_recipe_access_migration.sql.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE — the complete list; anything
-- else is unexpected:
--   CREATE OR REPLACE FUNCTION public.catering_save_event_menus, public.handle_new_user, public.prep_unit_costs
--   CREATE OR REPLACE VIEW public.employee_pay, public.ingredient_costs
--   ALTER FUNCTION public.prevent_owner_role_change, public.prevent_owner_delete (search_path only)
--   DROP POLICY "sop write auth", "sop notes write auth", "sop steps write auth",
--     ingredient_price_history_read_all, pos_receipt_deliveries_select (re-made
--     without staff), EVERY policy on public.suppliers and public.pos_price_aliases,
--     and every NON-SELECT policy on public.templates and public.template_items
--     (each named in a survey row before it is dropped)
--   ALTER POLICY (USING only) on the read policies listed in Step 2
--   ALTER TABLE public.suppliers / public.pos_price_aliases ENABLE ROW LEVEL SECURITY
--   REVOKE ALL ON public.suppliers, public.pos_price_aliases FROM anon
--   REVOKE SELECT ON public.employees, public.ingredients FROM PUBLIC, anon,
--     authenticated, then GRANT SELECT on every column but the pay / cost ones
--   REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon (the seven in 8)
--   UPDATE storage.buckets (one row: sop-photos' size and type limits)
-- The tests write inside a block that always rolls back, on rows they make
-- there; each test write touches one row, except the sign-up test, whose
-- auth.users row fires the trigger under test.
--
-- DEPLOY ORDER: THE CODE FIRST, then this file. The app must read pay and
-- purchase costs through the new views before the columns close:
-- `c88c44a` (salaries) and `d9829c4` (ingredient costs) do, and fall back to
-- the old reads while the views do not exist. Push them, check the deploy,
-- then run this. After it: the branch commit that moves the template writes
-- to the user's session (it needs the policies of 7).
--
-- FROM NOW ON: a column added to public.employees or public.ingredients is
-- NOT readable by the app until a GRANT SELECT (that_column) ... TO
-- authenticated says so (the table-wide SELECT is gone). Say which side of
-- the line a new column is on when you add it.
--
-- Never "Run and enable RLS": every table this touches already has RLS, and a
-- policy the editor invents is not one anyone reviewed.
-- ═══════════════════════════════════════════════════════════════════════════

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
      IF SQLERRM LIKE 'permission denied for view %' THEN
        RETURN COALESCE(v_role, '?') || ' denied:' || substring(SQLERRM from 'permission denied for view ([[:alnum:]_]+)');
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

-- One line: a table's row security, what anon may do, and every policy on it.
CREATE OR REPLACE FUNCTION pg_temp.survey(p_table text)
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT format('survey  %s before: row security %s; anon may %s; %s polic%s%s', p_table,
           CASE WHEN c.relrowsecurity THEN 'on' ELSE 'OFF' END,
           COALESCE(NULLIF(concat_ws(',',
             CASE WHEN has_table_privilege('anon', c.oid, 'SELECT') THEN 'select' END,
             CASE WHEN has_table_privilege('anon', c.oid, 'INSERT') THEN 'insert' END,
             CASE WHEN has_table_privilege('anon', c.oid, 'UPDATE') THEN 'update' END,
             CASE WHEN has_table_privilege('anon', c.oid, 'DELETE') THEN 'delete' END), ''), 'nothing'),
           (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = p_table),
           CASE WHEN (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = p_table) = 1 THEN 'y' ELSE 'ies' END,
           COALESCE(': ' || (SELECT string_agg(format('"%s" %s %s TO %s USING (%s) CHECK (%s)', p.policyname, p.permissive, p.cmd,
                                 array_to_string(p.roles, ','), COALESCE(p.qual, '-'), COALESCE(p.with_check, '-')), '; ' ORDER BY p.policyname)
                               FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = p_table), ''))
    FROM pg_class c WHERE c.oid = to_regclass('public.' || p_table);
$fn$;

-- ── Step 0: what is there, before anything changes ─────────────────────────

DO $do$
DECLARE
  v_t    text;
  v_md5  text;
  v_id   uuid;
  v_role text;
  v_line text;
  v_n    bigint;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['public.profiles', 'public.menus', 'public.menu_sops', 'public.menu_sop_steps',
      'public.menu_sop_ingredient_notes', 'public.ingredients', 'public.ingredient_price_history', 'public.suppliers',
      'public.pos_price_aliases', 'public.templates', 'public.template_items', 'public.catering_events',
      'public.maintenance_reports', 'public.coa', 'public.employees', 'public.payroll_periods', 'public.payroll_entries',
      'public.prep_recipes', 'public.pos_receipt_deliveries', 'storage.buckets'] LOOP
    IF to_regclass(v_t) IS NULL THEN
      RAISE EXCEPTION 'FAIL    S0 % does not exist. Nothing applied.', v_t;
    END IF;
  END LOOP;
  -- suppliers and pos_price_aliases get row security switched on below; the
  -- others must have it already, or a policy or column change means nothing.
  FOREACH v_t IN ARRAY ARRAY['public.templates', 'public.template_items', 'public.menu_sops', 'public.menu_sop_steps',
      'public.menu_sop_ingredient_notes', 'public.ingredient_price_history', 'public.profiles', 'public.menus',
      'public.employees', 'public.payroll_periods', 'public.payroll_entries', 'public.ingredients', 'public.pos_receipt_deliveries'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_t)) THEN
      RAISE EXCEPTION 'FAIL    S0 % has row security OFF. Nothing applied.', v_t;
    END IF;
  END LOOP;
  -- The columns this file takes away must be there, or the grant below would
  -- quietly leave a real pay or cost column readable under another name.
  IF (SELECT count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'employees'
         AND c.column_name IN ('base_salary', 'position_allowance', 'social_security_monthly', 'daily_wage')) <> 4
     OR (SELECT count(*) FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = 'ingredients'
            AND c.column_name IN ('purchase_cost', 'receive_qty', 'yield_qty')) <> 3 THEN
    RAISE EXCEPTION 'FAIL    S0 employees lacks one of its four pay columns, or ingredients one of its three cost columns. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      S0 the tables this file reads or changes exist, row security is on where it relies on it, and the four pay and three cost columns are where it expects them');

  -- The three functions replaced: the bodies the files applied, or this file's own (a re-run).
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.catering_save_event_menus(uuid, jsonb)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('e778edbac45e5ca9f9800e7841b89be7', 'b22c172dbb7b62403ded306f86e6b11e') THEN
    RAISE EXCEPTION 'FAIL    S1 catering_save_event_menus is not the body catering_typed_dishes_per_head_and_maintenance_migration.sql applied (md5 %): read it live before replacing it (AGENTS.md, rule 4). Nothing applied.', COALESCE(v_md5, 'missing');
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('e2cb9d70f85ff5b7243ac555a6836b43', 'b832816dd984aa38c095fae9cff91651') THEN
    RAISE EXCEPTION 'FAIL    S1 handle_new_user is not the body migrations/0001_init.sql applied (md5 %): read it live before replacing it (AGENTS.md, rule 4). Nothing applied.', COALESCE(v_md5, 'missing');
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.prep_unit_costs()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('5c592e15e3f312b7d90354d9ffebd977', '05ac62a2674d1f5b0b9ef06460cf5c5b') THEN
    RAISE EXCEPTION 'FAIL    S1 prep_unit_costs is not the body prep_recipe_access_migration.sql applied (md5 %): read it live before replacing it (AGENTS.md, rule 4). Nothing applied.', COALESCE(v_md5, 'missing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g
                  WHERE g.tgname = 'on_auth_user_created' AND g.tgrelid = to_regclass('auth.users') AND NOT g.tgisinternal) THEN
    RAISE EXCEPTION 'FAIL    S1 the trigger on_auth_user_created on auth.users is missing: new logins would get no profile at all. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      S1 catering_save_event_menus, handle_new_user and prep_unit_costs are the bodies the files applied (md5), or this file''s own; on_auth_user_created fires handle_new_user');

  -- One account per role, to test as. The tests make every ROW they need;
  -- the accounts they cannot make (a profile needs a login).
  FOREACH v_role IN ARRAY ARRAY['owner', 'admin', 'editor', 'staff', 'hr', 'sales'] LOOP
    SELECT p.id INTO v_id FROM public.profiles p WHERE p.role = v_role ORDER BY p.id LIMIT 1;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'FAIL    S2 no % account to test as. Nothing applied.', v_role;
    END IF;
    PERFORM set_config('sec.' || v_role, v_id::text, false);
  END LOOP;
  -- Counts and fingerprints, to prove after that nothing the tests did stayed.
  -- Compared, never printed: suppliers hold bank details, employees pay.
  PERFORM set_config('sec.n_steps',     (SELECT count(*) FROM public.menu_sop_steps)::text, false);
  PERFORM set_config('sec.n_sops',      (SELECT count(*) FROM public.menu_sops)::text, false);
  PERFORM set_config('sec.n_notes',     (SELECT count(*) FROM public.menu_sop_ingredient_notes)::text, false);
  PERFORM set_config('sec.n_hist',      (SELECT count(*) FROM public.ingredient_price_history)::text, false);
  PERFORM set_config('sec.n_suppliers', (SELECT count(*) FROM public.suppliers)::text, false);
  PERFORM set_config('sec.n_aliases',   (SELECT count(*) FROM public.pos_price_aliases)::text, false);
  PERFORM set_config('sec.n_templates', (SELECT count(*) FROM public.templates)::text, false);
  PERFORM set_config('sec.n_titems',    (SELECT count(*) FROM public.template_items)::text, false);
  PERFORM set_config('sec.n_menus',     (SELECT count(*) FROM public.menus)::text, false);
  PERFORM set_config('sec.n_profiles',  (SELECT count(*) FROM public.profiles)::text, false);
  PERFORM set_config('sec.n_events',    (SELECT count(*) FROM public.catering_events)::text, false);
  PERFORM set_config('sec.n_emp',       (SELECT count(*) FROM public.employees)::text, false);
  PERFORM set_config('sec.n_pe',        (SELECT count(*) FROM public.payroll_entries)::text, false);
  PERFORM set_config('sec.n_pp',        (SELECT count(*) FROM public.payroll_periods)::text, false);
  PERFORM set_config('sec.n_ing',       (SELECT count(*) FROM public.ingredients)::text, false);
  PERFORM set_config('sec.n_prep',      (SELECT count(*) FROM public.prep_recipes)::text, false);
  PERFORM set_config('sec.n_del',       (SELECT count(*) FROM public.pos_receipt_deliveries)::text, false);
  PERFORM set_config('sec.fp_steps',     (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.menu_sop_steps t), false);
  PERFORM set_config('sec.fp_suppliers', (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.suppliers t), false);
  PERFORM set_config('sec.fp_templates', (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.templates t), false);
  PERFORM set_config('sec.fp_titems',    (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.template_items t), false);
  PERFORM set_config('sec.fp_profiles',  (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.profiles t), false);
  PERFORM set_config('sec.fp_events',    (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.catering_events t), false);
  PERFORM set_config('sec.fp_emp',       (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.employees t), false);
  PERFORM set_config('sec.fp_ing',       (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.ingredients t), false);
  PERFORM pg_temp.note('ok      S2 test accounts found for owner, admin, editor, staff, hr and sales; counts and fingerprints recorded (the tests make their own rows)');

  -- THE LIVE POLICIES of the four tables made outside the repo, printed
  -- before any of them is dropped: the record no file has. One line each.
  PERFORM pg_temp.note(pg_temp.survey('suppliers'));
  PERFORM pg_temp.note(pg_temp.survey('pos_price_aliases'));
  PERFORM pg_temp.note(pg_temp.survey('templates'));
  PERFORM pg_temp.note(pg_temp.survey('template_items'));
  -- And the salary and cost tables this file narrows.
  PERFORM pg_temp.note(pg_temp.survey('employees'));
  PERFORM pg_temp.note(pg_temp.survey('payroll_entries'));
  PERFORM pg_temp.note(pg_temp.survey('pos_receipt_deliveries'));
  SELECT format('survey  sop-photos bucket before: public %s, file_size_limit %s, allowed_mime_types %s',
           b.public, COALESCE(b.file_size_limit::text, 'none'), COALESCE(array_to_string(b.allowed_mime_types, ','), 'any'))
    INTO v_line FROM storage.buckets b WHERE b.id = 'sop-photos';
  IF v_line IS NULL THEN
    RAISE EXCEPTION 'FAIL    S3 the sop-photos bucket is missing. Nothing applied.';
  END IF;
  PERFORM pg_temp.note(v_line);
  -- Logins with no profile: they pass every policy that asks only "signed in", until Step 2.
  BEGIN
    SELECT count(*) INTO v_n FROM auth.users u WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);
    v_line := format('survey  logins with no profile: %s (each read what "signed in" allowed until this file)', v_n);
  EXCEPTION WHEN insufficient_privilege THEN
    v_line := 'survey  logins with no profile: not readable by this role here';
  END;
  PERFORM pg_temp.note(v_line);
  PERFORM pg_temp.note(format('note    before: SOPs %s, SOP steps %s, price history %s, suppliers %s, POS aliases %s, templates %s, template lines %s, menus %s, profiles %s, employees %s, payroll lines %s, ingredients %s, preps %s, POS receipts %s',
    current_setting('sec.n_sops'), current_setting('sec.n_steps'), current_setting('sec.n_hist'),
    current_setting('sec.n_suppliers'), current_setting('sec.n_aliases'), current_setting('sec.n_templates'),
    current_setting('sec.n_titems'), current_setting('sec.n_menus'), current_setting('sec.n_profiles'),
    current_setting('sec.n_emp'), current_setting('sec.n_pe'), current_setting('sec.n_ing'), current_setting('sec.n_prep'), current_setting('sec.n_del')));
END
$do$;

-- ── Step 1: the functions ──────────────────────────────────────────────────

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
  -- Queue item 48 (2026-09-25): the booking row is locked FIRST — the lock
  -- catering_save_booking_prices takes — so a menu-page save and a
  -- booking-screen save of one booking wait for each other instead of
  -- interleaving (a set charge found gone and inserted twice, or a new price
  -- written back to the old one). It is also the existence check.
  PERFORM 1 FROM public.catering_events e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Audit C1 (2026-09-25): public sign-up was found on, and this made EVERY
  -- new login a 'staff' profile. A profile is now made only for the app's
  -- own logins, <username>@staff.local, which the team page creates (its
  -- createUser then sets the name and role). Any other new login gets no
  -- profile, and a login with no profile reads nothing (Step 2).
  IF lower(COALESCE(new.email, '')) NOT LIKE '%@staff.local' THEN
    RETURN new;
  END IF;
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'full_name', new.email), 'staff');
  RETURN new;
END
$fn$;

CREATE OR REPLACE FUNCTION public.prep_unit_costs()
RETURNS TABLE (prep_recipe_id uuid, unit_cost numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH RECURSIVE
  -- Mirrors rawUnitCost() in src/lib/costing.ts, branch for branch.
  raw_cost AS (
    SELECT i.id,
           CASE
             WHEN i.purchase_cost IS NULL THEN NULL
             WHEN i.yield_qty IS NULL OR i.yield_qty = 0 OR COALESCE(i.receive_qty, 1) = 0
               THEN CASE WHEN COALESCE(i.receive_qty, 1) > 0
                         THEN i.purchase_cost / COALESCE(i.receive_qty, 1)
                         ELSE i.purchase_cost END
             ELSE CASE WHEN (i.yield_qty / COALESCE(i.receive_qty, 1)) > 0
                       THEN i.purchase_cost / (i.yield_qty / COALESCE(i.receive_qty, 1))
                       ELSE NULL END
           END AS unit_cost
      FROM public.ingredients i
     WHERE i.is_prep = false
  ),
  -- One row per (prep, component) at every depth. The LEFT JOIN is what makes
  -- a prep with NO items emit a single NULL-ingredient row instead of
  -- vanishing — vanishing would read as "costs nothing".
  expanded AS (
    SELECT p.id             AS root_id,
           pi.ingredient_id AS ingredient_id,
           CASE WHEN p.batch_yield_qty > 0 AND pi.id IS NOT NULL
                THEN pi.quantity / p.batch_yield_qty END AS factor,
           1                AS depth
      FROM public.prep_recipes p
      LEFT JOIN public.prep_recipe_items pi ON pi.prep_recipe_id = p.id
    UNION ALL
    SELECT e.root_id,
           pi.ingredient_id,
           CASE WHEN p2.batch_yield_qty > 0 AND pi.id IS NOT NULL
                THEN e.factor * (pi.quantity / p2.batch_yield_qty) END,
           e.depth + 1
      FROM expanded e
      JOIN public.ingredients  ing ON ing.id = e.ingredient_id AND ing.is_prep
      JOIN public.prep_recipes p2  ON p2.id  = ing.prep_recipe_id
      LEFT JOIN public.prep_recipe_items pi ON pi.prep_recipe_id = p2.id
     WHERE e.depth < 10
  ),
  leaf AS (
    SELECT e.root_id,
           CASE
             -- a prep with no items, at any depth
             WHEN e.ingredient_id IS NULL THEN NULL
             -- an internal node: its children carry the value, it carries none
             WHEN ing.is_prep AND ing.prep_recipe_id IS NOT NULL AND e.depth < 10 THEN 0
             -- a prep with no recipe, or a branch that hit the depth cap
             WHEN ing.is_prep THEN NULL
             -- a raw leaf; NULL if unpriced, or if any ancestor yield was <= 0
             ELSE e.factor * rc.unit_cost
           END AS contribution
      FROM expanded e
      LEFT JOIN public.ingredients ing ON ing.id = e.ingredient_id
      LEFT JOIN raw_cost           rc ON rc.id  = e.ingredient_id
  )
  SELECT p.id,
         CASE WHEN bool_or(l.contribution IS NULL) THEN NULL
              ELSE sum(l.contribution) END
    FROM public.prep_recipes p
    LEFT JOIN leaf l ON l.root_id = p.id
   -- Staff see no purchase prices (Nik, 2026-09-26): a prep's cost is one.
   WHERE public.current_role() IN ('owner', 'admin', 'editor')
   GROUP BY p.id;
$fn$;

DO $do$
DECLARE
  v_f text;
BEGIN
  v_f := 'public.prevent_owner_role_change()';
  IF to_regprocedure(v_f) IS NULL THEN
    PERFORM pg_temp.note(format('skip    L3 %s is not there live: nothing to pin', v_f));
  ELSE
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_f);
    PERFORM pg_temp.note(format('ok      L3 %s (SECURITY DEFINER) runs with search_path = public', v_f));
  END IF;
  v_f := 'public.prevent_owner_delete()';
  IF to_regprocedure(v_f) IS NULL THEN
    PERFORM pg_temp.note(format('skip    L3 %s is not there live: nothing to pin', v_f));
  ELSE
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', v_f);
    PERFORM pg_temp.note(format('ok      L3 %s (SECURITY DEFINER) runs with search_path = public', v_f));
  END IF;
END
$do$;

-- ── Step 2: the policies, grants and views ─────────────────────────────────

DO $do$
DECLARE
  v_p   text[];
  v_n   int := 0;
BEGIN
  -- H1 and Nik 2026-09-26: SOP writes, owner, admin and editor.
  FOREACH v_p SLICE 1 IN ARRAY ARRAY[
      ARRAY['menu_sops', 'sop write auth', 'sop_write'],
      ARRAY['menu_sop_ingredient_notes', 'sop notes write auth', 'sop_notes_write'],
      ARRAY['menu_sop_steps', 'sop steps write auth', 'sop_steps_write']] LOOP
    IF EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = v_p[1] AND p.policyname = v_p[2]) THEN
      EXECUTE format('DROP POLICY %I ON public.%I', v_p[2], v_p[1]);
      v_n := v_n + 1;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_p[3], v_p[1]);
    EXECUTE format($q$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.current_role() IN ('owner', 'admin', 'editor')) WITH CHECK (public.current_role() IN ('owner', 'admin', 'editor'))$q$, v_p[3], v_p[1]);
  END LOOP;
  PERFORM pg_temp.note(format('ok      P0 SOP writes: %s of the three "… write auth" policies were there and are dropped; sop_write, sop_notes_write and sop_steps_write (owner, admin, editor) in place', v_n));

  -- H2: the purchase-price history, owner, admin and editor.
  DROP POLICY IF EXISTS ingredient_price_history_read_all ON public.ingredient_price_history;
  DROP POLICY IF EXISTS ingredient_price_history_select ON public.ingredient_price_history;
  CREATE POLICY ingredient_price_history_select ON public.ingredient_price_history FOR SELECT TO authenticated
    USING (public.current_role() IN ('owner', 'admin', 'editor'));
  PERFORM pg_temp.note('ok      Q0 price history: read by owner, admin and editor only (ingredient_price_history_select)');

  -- 12: the POS receipt costs, owner, admin and editor (staff dropped).
  DROP POLICY IF EXISTS pos_receipt_deliveries_select ON public.pos_receipt_deliveries;
  CREATE POLICY pos_receipt_deliveries_select ON public.pos_receipt_deliveries FOR SELECT TO authenticated
    USING (public.current_role() IN ('owner', 'admin', 'editor'));
  PERFORM pg_temp.note('ok      D0 POS receipt costs: read by owner, admin and editor only (pos_receipt_deliveries_select)');
END
$do$;

-- H3: every read policy that asked only "signed in" asks for a profile.
DO $do$
DECLARE
  v_p    text[];
  v_cmd  text;
  v_done text;
  v_none text;
BEGIN
  FOREACH v_p SLICE 1 IN ARRAY ARRAY[
      ARRAY['menus', 'menus_read_all'], ARRAY['app_settings', 'app_settings_read_all'],
      ARRAY['pos_sales_aliases', 'pos_sales_aliases_read_all'], ARRAY['stations', 'stations_select'],
      ARRAY['station_ingredients', 'station_ingredients_select'], ARRAY['order_sessions', 'order_sessions_select'],
      ARRAY['order_items', 'order_items_select'], ARRAY['order_item_changes', 'order_item_changes_select'],
      ARRAY['templates', 'templates_select'], ARRAY['template_items', 'template_items_select'],
      ARRAY['maintenance_reports', 'maint_read'], ARRAY['coa', 'coa_select'],
      ARRAY['pos_import_meta', 'pos_import_meta_read'], ARRAY['profiles', 'auth_read_profiles'],
      ARRAY['menu_sops', 'sop read all'], ARRAY['menu_sop_ingredient_notes', 'sop notes read all'],
      ARRAY['menu_sop_steps', 'sop steps read all']] LOOP
    SELECT p.cmd INTO v_cmd FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = v_p[1] AND p.policyname = v_p[2];
    IF v_cmd IS NULL THEN
      v_none := concat_ws(', ', v_none, format('%s."%s"', v_p[1], v_p[2]));
    ELSIF v_cmd <> 'SELECT' THEN
      RAISE EXCEPTION 'FAIL    R0 %."%" is a % policy, not a read: narrowing its USING would change who writes. Nothing applied.', v_p[1], v_p[2], v_cmd;
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING (public.current_role() IS NOT NULL)', v_p[2], v_p[1]);
      v_done := concat_ws(', ', v_done, format('%s."%s"', v_p[1], v_p[2]));
    END IF;
  END LOOP;
  PERFORM pg_temp.note(format('ok      R0 now need a profile: %s. Not there live, nothing to narrow: %s', COALESCE(v_done, 'none'), COALESCE(v_none, 'none')));
END
$do$;

-- H4 and M1: suppliers and POS aliases for owner and admin; templates written
-- by owner, admin and editor. Every policy dropped was printed in Step 0.
DO $do$
DECLARE
  v_t     text;
  v_pol   record;
  v_names text;
  v_msg   text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_t IN ARRAY ARRAY['suppliers', 'pos_price_aliases'] LOOP
    v_names := NULL;
    FOR v_pol IN SELECT p.policyname FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = v_t ORDER BY p.policyname LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_pol.policyname, v_t);
      v_names := concat_ws(', ', v_names, '"' || v_pol.policyname || '"');
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_t);
    EXECUTE format($q$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (public.current_role() IN ('owner', 'admin'))$q$, v_t || '_select', v_t);
    EXECUTE format($q$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
      USING (public.current_role() IN ('owner', 'admin')) WITH CHECK (public.current_role() IN ('owner', 'admin'))$q$, v_t || '_write', v_t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', v_t);
    v_msg := v_msg || format('ok      V0 %s: dropped %s; row security on; %s_select and %s_write (owner, admin) in place; anon holds no privilege',
      v_t, COALESCE(v_names, 'no policy (there was none)'), v_t, v_t);
  END LOOP;
  PERFORM pg_temp.note(v_msg[1]);
  PERFORM pg_temp.note(v_msg[2]);
  v_msg := ARRAY[]::text[];

  FOREACH v_t IN ARRAY ARRAY['templates', 'template_items'] LOOP
    v_names := NULL;
    FOR v_pol IN SELECT p.policyname FROM pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = v_t AND p.cmd <> 'SELECT' ORDER BY p.policyname LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_pol.policyname, v_t);
      v_names := concat_ws(', ', v_names, '"' || v_pol.policyname || '"');
    END LOOP;
    EXECUTE format($q$CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
      WITH CHECK (public.current_role() IN ('owner', 'admin', 'editor'))$q$, v_t || '_insert_heads', v_t);
    EXECUTE format($q$CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
      USING (public.current_role() IN ('owner', 'admin', 'editor')) WITH CHECK (public.current_role() IN ('owner', 'admin', 'editor'))$q$, v_t || '_update_heads', v_t);
    EXECUTE format($q$CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
      USING (public.current_role() IN ('owner', 'admin', 'editor'))$q$, v_t || '_delete_heads', v_t);
    v_msg := v_msg || format('ok      W0 %s: dropped the write policies %s; %s_insert_heads, _update_heads and _delete_heads (owner, admin, editor) in place',
      v_t, COALESCE(v_names, '(there were none)'), v_t);
  END LOOP;
  PERFORM pg_temp.note(v_msg[1]);
  PERFORM pg_temp.note(v_msg[2]);
END
$do$;

-- 11 and 12: the pay columns and the purchase-cost columns close, for every
-- signed-in account; the rest of each table stays readable under its row
-- policies. The two views hand the closed columns back to whom Nik named.
DO $do$
DECLARE
  v_cols text;
BEGIN
  REVOKE SELECT ON public.employees FROM PUBLIC, anon, authenticated;
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'employees'
     AND c.column_name NOT IN ('base_salary', 'position_allowance', 'social_security_monthly', 'daily_wage');
  EXECUTE format('GRANT SELECT (%s) ON public.employees TO authenticated', v_cols);
  PERFORM pg_temp.note(format('ok      M0 employees: signed-in accounts read every column but base_salary, position_allowance, social_security_monthly and daily_wage (%s)', v_cols));

  REVOKE SELECT ON public.ingredients FROM PUBLIC, anon, authenticated;
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position) INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'ingredients'
     AND c.column_name NOT IN ('purchase_cost', 'receive_qty', 'yield_qty');
  EXECUTE format('GRANT SELECT (%s) ON public.ingredients TO authenticated', v_cols);
  PERFORM pg_temp.note(format('ok      N0 ingredients: signed-in accounts read every column but purchase_cost, receive_qty and yield_qty (%s)', v_cols));
END
$do$;

-- The views run as their owner (the file's own role), so the columns are
-- there for them; each answers only the roles named, and security_barrier
-- keeps a caller's own conditions from being evaluated before that test.
CREATE OR REPLACE VIEW public.employee_pay WITH (security_barrier = true) AS
  SELECT e.id AS employee_id, e.base_salary, e.position_allowance, e.social_security_monthly, e.daily_wage
    FROM public.employees e
   WHERE public.current_role() IN ('owner', 'hr');
REVOKE ALL ON public.employee_pay FROM PUBLIC, anon;
GRANT SELECT ON public.employee_pay TO authenticated, service_role;
COMMENT ON VIEW public.employee_pay IS
  'The four pay figures of every employee, for owner and hr only (Nik, 2026-09-26). The columns themselves are not selectable by signed-in accounts. security_fixes_and_menu_save_lock_migration.sql.';

CREATE OR REPLACE VIEW public.ingredient_costs WITH (security_barrier = true) AS
  SELECT i.id AS ingredient_id, i.purchase_cost, i.receive_qty, i.yield_qty
    FROM public.ingredients i
   WHERE public.current_role() IN ('owner', 'admin', 'editor');
REVOKE ALL ON public.ingredient_costs FROM PUBLIC, anon;
GRANT SELECT ON public.ingredient_costs TO authenticated, service_role;
COMMENT ON VIEW public.ingredient_costs IS
  'Every ingredient''s purchase cost, for owner, admin and editor only (Nik, 2026-09-26: staff see names and units). The columns themselves are not selectable by signed-in accounts. security_fixes_and_menu_save_lock_migration.sql.';

-- Functions that write: signed-in accounts only (every overload).
DO $do$
DECLARE
  v_name text;
  v_fn   regprocedure;
  v_n    int;
  v_done text;
  v_none text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['import_pos_month', 'import_budget69_month', 'import_outsource_month',
      'next_catering_quote_seq', 'catering_copy_set_menu', 'catering_save_booking_prices', 'catering_save_event_menus'] LOOP
    v_n := 0;
    FOR v_fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = v_name LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_fn);
      v_n := v_n + 1;
    END LOOP;
    IF v_n = 0 THEN
      v_none := concat_ws(', ', v_none, v_name);
    ELSE
      v_done := concat_ws(', ', v_done, v_name || CASE WHEN v_n = 1 THEN '' ELSE ' (' || v_n || ' overloads)' END);
    END IF;
  END LOOP;
  PERFORM pg_temp.note(format('ok      E0 anon may not execute, signed-in accounts still may: %s. Not there live: %s', COALESCE(v_done, 'none'), COALESCE(v_none, 'none')));
END
$do$;

-- ST-1: the sop-photos bucket takes what the app sends and nothing bigger.
DO $do$
DECLARE
  v_n bigint;
BEGIN
  UPDATE storage.buckets SET file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg']
   WHERE id = 'sop-photos';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL    B0 the sop-photos bucket was not updated (% rows). Nothing applied.', v_n;
  END IF;
  PERFORM pg_temp.note('ok      B0 sop-photos: JPEG only, at most 2 MB a file (the app sends 1200 px JPEGs at quality 0.8)');
END
$do$;

-- ── Step 4: tests, as the real accounts, on rows they make, all rolled back ──

DO $do$
DECLARE
  owner_  uuid := current_setting('sec.owner')::uuid;
  admin_  uuid := current_setting('sec.admin')::uuid;
  editor_ uuid := current_setting('sec.editor')::uuid;
  staff_  uuid := current_setting('sec.staff')::uuid;
  hr_     uuid := current_setting('sec.hr')::uuid;
  sales_  uuid := current_setting('sec.sales')::uuid;
  -- A login with no profile row: a uuid no profile has. Signed in as far as
  -- the database can tell (the probe sets its claims), current_role() NULL.
  nobody_ uuid := gen_random_uuid();
  v_event uuid;   -- a probe booking
  v_menu  uuid;   -- a probe menu, for the probe SOP
  v_sop   uuid;   -- a probe SOP
  v_step  uuid;   -- its step
  v_ing   uuid;   -- a probe ingredient, priced
  v_alias uuid;   -- a probe POS alias
  v_sup   uuid;   -- a probe supplier
  v_tpl   uuid;   -- a probe template
  v_titem uuid;   -- its line
  v_emp   uuid;   -- a probe employee, paid
  v_per   uuid;   -- a probe payroll period
  v_del   uuid;   -- a probe POS receipt line
  v_u1    uuid := gen_random_uuid();
  v_u2    uuid := gen_random_uuid();
  -- Counts taken after the probe rows exist, as the file's own role.
  n_steps bigint; n_hist bigint; n_menus bigint; n_profiles bigint; n_maint bigint;
  n_tpl bigint; n_titems bigint; n_sup bigint; n_alias bigint; n_emp bigint; n_pe bigint;
  n_pp bigint; n_ing bigint; n_nonprep bigint; n_prep bigint; n_del bigint;
  v_src   text;
  v_log   text;
BEGIN
  BEGIN
    -- ── The rows the tests need, made here (never live data's) ──
    INSERT INTO public.catering_events (event_date, location_type, venue, booking_type, status, detail_note)
    VALUES (DATE '2099-03-02', 'in_house', 'air_shared', 'catering', 'confirmed', 'probe-sec') RETURNING id INTO v_event;
    INSERT INTO public.menus (name, selling_price) VALUES ('probe-sec ' || gen_random_uuid(), 0) RETURNING id INTO v_menu;
    INSERT INTO public.menu_sops (menu_id) VALUES (v_menu) RETURNING id INTO v_sop;
    INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (v_sop, 'prep', 1, 'probe-sec') RETURNING id INTO v_step;
    INSERT INTO public.ingredients (name, purchase_cost, receive_qty) VALUES ('probe-sec ' || gen_random_uuid(), 10, 1) RETURNING id INTO v_ing;
    UPDATE public.ingredients SET purchase_cost = 11 WHERE id = v_ing;   -- its trigger writes one price-history row
    INSERT INTO public.pos_price_aliases (pos_ingredient_name, ingredient_id) VALUES ('probe-sec ' || gen_random_uuid(), v_ing) RETURNING id INTO v_alias;
    INSERT INTO public.suppliers (name) VALUES ('probe-sec') RETURNING id INTO v_sup;
    INSERT INTO public.templates (name) VALUES ('probe-sec') RETURNING id INTO v_tpl;
    INSERT INTO public.template_items (template_id, ingredient_id) VALUES (v_tpl, v_ing) RETURNING id INTO v_titem;
    INSERT INTO public.employees (full_name, base_salary) VALUES ('probe-sec', 12345) RETURNING id INTO v_emp;
    INSERT INTO public.payroll_periods (period_year, period_month, period_half) VALUES (2099, 1, 'first') RETURNING id INTO v_per;
    INSERT INTO public.payroll_entries (payroll_period_id, employee_id) VALUES (v_per, v_emp);
    INSERT INTO public.pos_receipt_deliveries (material_code, material_name, document_number, document_date, unit_name, qty, total_cost_inc_vat, total_cost_exc_vat)
    VALUES ('PROBE-SEC', 'probe-sec', 'PROBE-SEC-' || gen_random_uuid(), DATE '2099-01-01', 'x', 1, 1, 1) RETURNING id INTO v_del;
    SELECT count(*) INTO n_steps FROM public.menu_sop_steps;
    SELECT count(*) INTO n_hist FROM public.ingredient_price_history;
    SELECT count(*) INTO n_menus FROM public.menus;
    SELECT count(*) INTO n_profiles FROM public.profiles;
    SELECT count(*) INTO n_maint FROM public.maintenance_reports;
    SELECT count(*) INTO n_tpl FROM public.templates;
    SELECT count(*) INTO n_titems FROM public.template_items;
    SELECT count(*) INTO n_sup FROM public.suppliers;
    SELECT count(*) INTO n_alias FROM public.pos_price_aliases;
    SELECT count(*) INTO n_emp FROM public.employees;
    SELECT count(*) INTO n_pe FROM public.payroll_entries;
    SELECT count(*) INTO n_pp FROM public.payroll_periods;
    SELECT count(*) INTO n_ing FROM public.ingredients;
    SELECT count(*) INTO n_nonprep FROM public.ingredients WHERE NOT is_prep;
    SELECT count(*) INTO n_prep FROM public.prep_recipes;
    SELECT count(*) INTO n_del FROM public.pos_receipt_deliveries;
    IF n_hist = 0 OR n_alias = 0 OR n_pe = 0 THEN
      RAISE EXCEPTION 'FAIL    T0 a probe row was not made (price history %, aliases %, payroll lines %): the tests would prove nothing. Nothing applied.', n_hist, n_alias, n_pe;
    END IF;
    PERFORM pg_temp.note('ok      T0 the probe rows are made (a booking, a menu with an SOP and a step, a priced ingredient with its price-history row, a POS alias, a supplier, a template with a line, a paid employee with a payroll line, a POS receipt line)');

    -- ── Item 48: the menu-page save locks the booking first ──
    SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('public.catering_save_event_menus(uuid, jsonb)');
    IF position('FROM public.catering_events e WHERE e.id = p_event_id FOR UPDATE' IN v_src) = 0
       OR position('FROM public.catering_events e WHERE e.id = p_event_id FOR UPDATE' IN v_src) > position('INSERT INTO' IN v_src)
       OR position('FROM public.catering_events e WHERE e.id = p_event_id FOR UPDATE' IN v_src) > position('UPDATE public.' IN v_src) THEN
      RAISE EXCEPTION 'FAIL    F1 catering_save_event_menus does not lock the booking row before its first write. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      F1 catering_save_event_menus locks the booking row (FOR UPDATE) before its first write, as catering_save_booking_prices does');
    PERFORM pg_temp.t('F2 sales calls the menu-page save', sales_, 'sales',
      format($q$SELECT public.catering_save_event_menus(%L::uuid, '[]'::jsonb)$q$, v_event), ARRAY['refused']);
    PERFORM pg_temp.said('F2', 'เฉพาะเจ้าของร้านและผู้จัดการ');
    PERFORM pg_temp.t('F3 owner saves a booking that does not exist', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L::uuid, '[]'::jsonb)$q$, gen_random_uuid()), ARRAY['refused']);
    PERFORM pg_temp.said('F3', 'ไม่พบข้อมูลงาน');
    PERFORM pg_temp.t('F4 owner: the lock is taken, and the save goes on to its next check', owner_, 'owner',
      format($q$SELECT public.catering_save_event_menus(%L::uuid, '[]'::jsonb)$q$, v_event), ARRAY['refused']);
    PERFORM pg_temp.said('F4', 'ไม่มีรายการที่เปลี่ยนแปลง');
    PERFORM pg_temp.t('F5 admin: the same', admin_, 'admin',
      format($q$SELECT public.catering_save_event_menus(%L::uuid, '[]'::jsonb)$q$, v_event), ARRAY['refused']);
    PERFORM pg_temp.said('F5', 'ไม่มีรายการที่เปลี่ยนแปลง');

    -- ── SOPs: owner, admin and editor write ──
    PERFORM pg_temp.t('P1 staff rewrites an SOP step', staff_, 'staff',
      format('UPDATE public.menu_sop_steps SET text = text WHERE id = %L', v_step), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('P2 editor rewrites an SOP step (เวช writes SOPs)', editor_, 'editor',
      format('UPDATE public.menu_sop_steps SET text = text WHERE id = %L', v_step), ARRAY['rows=1']);
    PERFORM pg_temp.t('P3 editor adds an SOP step', editor_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'cook', 2, 'probe-sec')$q$, v_sop), ARRAY['rows=1']);
    PERFORM pg_temp.t('P4 sales deletes an SOP step', sales_, 'sales',
      format('DELETE FROM public.menu_sop_steps WHERE id = %L', v_step), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('P5 hr adds an SOP step', hr_, 'hr',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'prep', 3, 'probe-sec')$q$, v_sop), ARRAY['denied']);
    PERFORM pg_temp.t('P6 staff rewrites an SOP', staff_, 'staff',
      format('UPDATE public.menu_sops SET updated_at = updated_at WHERE id = %L', v_sop), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('P7 admin rewrites an SOP step', admin_, 'admin',
      format('UPDATE public.menu_sop_steps SET text = text WHERE id = %L', v_step), ARRAY['rows=1']);
    PERFORM pg_temp.t('P8 owner deletes an SOP step', owner_, 'owner',
      format('DELETE FROM public.menu_sop_steps WHERE id = %L', v_step), ARRAY['rows=1']);
    PERFORM pg_temp.t('P9 staff still reads every SOP step', staff_, 'staff',
      'SELECT id FROM public.menu_sop_steps', ARRAY['rows=' || n_steps]);
    PERFORM pg_temp.t('P10 a login with no profile reads no SOP step', nobody_, 'no-profile',
      'SELECT id FROM public.menu_sop_steps', ARRAY['rows=0']);

    -- ── Purchase-price history ──
    PERFORM pg_temp.t('Q1 sales reads the price history', sales_, 'sales', 'SELECT id FROM public.ingredient_price_history', ARRAY['rows=0']);
    PERFORM pg_temp.t('Q2 staff reads the price history', staff_, 'staff', 'SELECT id FROM public.ingredient_price_history', ARRAY['rows=0']);
    PERFORM pg_temp.t('Q3 hr reads the price history', hr_, 'hr', 'SELECT id FROM public.ingredient_price_history', ARRAY['rows=0']);
    PERFORM pg_temp.t('Q4 a login with no profile reads the price history', nobody_, 'no-profile', 'SELECT id FROM public.ingredient_price_history', ARRAY['rows=0']);
    PERFORM pg_temp.t('Q5 editor reads the price history (the ingredients screen)', editor_, 'editor',
      'SELECT id FROM public.ingredient_price_history', ARRAY['rows=' || n_hist]);
    PERFORM pg_temp.t('Q6 admin reads the price history', admin_, 'admin',
      'SELECT id FROM public.ingredient_price_history', ARRAY['rows=' || n_hist]);

    -- ── A login with no profile ──
    PERFORM pg_temp.t('R1 a login with no profile reads the menus', nobody_, 'no-profile', 'SELECT id FROM public.menus', ARRAY['rows=0']);
    PERFORM pg_temp.t('R2 staff reads the menus', staff_, 'staff', 'SELECT id FROM public.menus', ARRAY['rows=' || n_menus]);
    PERFORM pg_temp.t('R3 a login with no profile lists the accounts', nobody_, 'no-profile', 'SELECT id FROM public.profiles', ARRAY['rows=0']);
    PERFORM pg_temp.t('R4 sales lists the accounts (the live read everyone has)', sales_, 'sales',
      'SELECT id FROM public.profiles', ARRAY['rows=' || n_profiles]);
    PERFORM pg_temp.t('R5 a login with no profile reads แจ้งซ่อม', nobody_, 'no-profile', 'SELECT id FROM public.maintenance_reports', ARRAY['rows=0']);
    PERFORM pg_temp.t('R6 staff reads แจ้งซ่อม', staff_, 'staff', 'SELECT id FROM public.maintenance_reports', ARRAY['rows=' || n_maint]);
    PERFORM pg_temp.t('R7 a login with no profile reads the chart of accounts', nobody_, 'no-profile', 'SELECT code FROM public.coa', ARRAY['rows=0']);
    PERFORM pg_temp.t('R8 a login with no profile reads the order templates', nobody_, 'no-profile', 'SELECT id FROM public.templates', ARRAY['rows=0']);
    PERFORM pg_temp.t('R9 hr reads the order templates', hr_, 'hr', 'SELECT id FROM public.templates', ARRAY['rows=' || n_tpl]);

    -- ── Suppliers (bank details) and POS aliases ──
    PERFORM pg_temp.t('V1 staff reads the suppliers', staff_, 'staff', 'SELECT id FROM public.suppliers', ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('V2 sales reads the suppliers', sales_, 'sales', 'SELECT id FROM public.suppliers', ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('V3 editor reads the suppliers', editor_, 'editor', 'SELECT id FROM public.suppliers', ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('V4 hr reads the suppliers', hr_, 'hr', 'SELECT id FROM public.suppliers', ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('V5 a visitor who is not signed in reads the suppliers', NULL, 'anon', 'SELECT id FROM public.suppliers', ARRAY['denied']);
    PERFORM pg_temp.t('V6 admin reads the suppliers (the accounting screen)', admin_, 'admin', 'SELECT id FROM public.suppliers', ARRAY['rows=' || n_sup]);
    PERFORM pg_temp.t('V7 owner reads the suppliers', owner_, 'owner', 'SELECT id FROM public.suppliers', ARRAY['rows=' || n_sup]);
    PERFORM pg_temp.t('V8 staff changes a supplier', staff_, 'staff',
      format('UPDATE public.suppliers SET name = name WHERE id = %L', v_sup), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('V9 admin changes a supplier', admin_, 'admin',
      format('UPDATE public.suppliers SET name = name WHERE id = %L', v_sup), ARRAY['rows=1']);
    PERFORM pg_temp.t('V10 editor reads the POS aliases', editor_, 'editor', 'SELECT id FROM public.pos_price_aliases', ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('V11 staff deletes a POS alias', staff_, 'staff',
      format('DELETE FROM public.pos_price_aliases WHERE id = %L', v_alias), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('V12 admin reads the POS aliases (the POS import)', admin_, 'admin', 'SELECT id FROM public.pos_price_aliases', ARRAY['rows=' || n_alias]);
    PERFORM pg_temp.t('V13 admin changes a POS alias', admin_, 'admin',
      format('UPDATE public.pos_price_aliases SET pos_ingredient_name = pos_ingredient_name WHERE id = %L', v_alias), ARRAY['rows=1']);

    -- ── Templates: written by owner, admin and editor ──
    PERFORM pg_temp.t('W1 staff makes a template', staff_, 'staff', $q$INSERT INTO public.templates (name) VALUES ('probe-sec')$q$, ARRAY['denied']);
    PERFORM pg_temp.t('W2 sales makes a template', sales_, 'sales', $q$INSERT INTO public.templates (name) VALUES ('probe-sec')$q$, ARRAY['denied']);
    PERFORM pg_temp.t('W3 editor makes a template', editor_, 'editor', $q$INSERT INTO public.templates (name) VALUES ('probe-sec')$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('W4 staff changes a template line', staff_, 'staff',
      format('UPDATE public.template_items SET default_qty = default_qty WHERE id = %L', v_titem), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('W5 editor changes a template line', editor_, 'editor',
      format('UPDATE public.template_items SET default_qty = default_qty WHERE id = %L', v_titem), ARRAY['rows=1']);
    PERFORM pg_temp.t('W6 hr deletes a template line', hr_, 'hr',
      format('DELETE FROM public.template_items WHERE id = %L', v_titem), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('W7 admin deletes a template line', admin_, 'admin',
      format('DELETE FROM public.template_items WHERE id = %L', v_titem), ARRAY['rows=1']);

    -- ── Salaries: owner and hr only ──
    PERFORM pg_temp.t('M1 admin lists the employees (attendance, leave, schedules)', admin_, 'admin',
      'SELECT id, employee_code, full_name, nickname, phone, department_id, position, employment_type, hire_date, start_date, weekly_day_off, citizenship_type, is_active, takes_bookings, sort_order, al_quota_override, probation_end_date FROM public.employees',
      ARRAY['rows=' || n_emp]);
    PERFORM pg_temp.t('M2 admin reads a salary', admin_, 'admin', 'SELECT base_salary FROM public.employees', ARRAY['denied']);
    PERFORM pg_temp.t('M3 admin reads a daily wage', admin_, 'admin', 'SELECT daily_wage FROM public.employees', ARRAY['denied']);
    PERFORM pg_temp.t('M4 admin reads social security', admin_, 'admin', 'SELECT social_security_monthly FROM public.employees', ARRAY['denied']);
    PERFORM pg_temp.t('M5 admin reads the pay view', admin_, 'admin', 'SELECT employee_id FROM public.employee_pay', ARRAY['rows=0']);
    PERFORM pg_temp.t('M6 hr reads the pay view', hr_, 'hr', 'SELECT employee_id, base_salary FROM public.employee_pay', ARRAY['rows=' || n_emp]);
    PERFORM pg_temp.t('M7 owner reads the pay view', owner_, 'owner', 'SELECT employee_id, daily_wage FROM public.employee_pay', ARRAY['rows=' || n_emp]);
    PERFORM pg_temp.t('M8 hr reads a salary from the table itself (the view is the way)', hr_, 'hr', 'SELECT base_salary FROM public.employees', ARRAY['denied']);
    PERFORM pg_temp.t('M9 staff reads the pay view', staff_, 'staff', 'SELECT employee_id FROM public.employee_pay', ARRAY['rows=0']);
    PERFORM pg_temp.t('M10 admin reads the payroll lines', admin_, 'admin', 'SELECT id FROM public.payroll_entries', ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('M11 admin reads the payroll periods', admin_, 'admin', 'SELECT id FROM public.payroll_periods', ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('M12 hr reads the payroll lines', hr_, 'hr', 'SELECT id FROM public.payroll_entries', ARRAY['rows=' || n_pe]);
    PERFORM pg_temp.t('M13 hr sets a salary (the employee page)', hr_, 'hr',
      format('UPDATE public.employees SET base_salary = 20000 WHERE id = %L', v_emp), ARRAY['rows=1']);
    PERFORM pg_temp.t('M14 admin sets a salary', admin_, 'admin',
      format('UPDATE public.employees SET base_salary = 20000 WHERE id = %L', v_emp), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('M15 a visitor reads the pay view', NULL, 'anon', 'SELECT employee_id FROM public.employee_pay', ARRAY['denied']);

    -- ── Staff: ingredient names and units, no purchase prices ──
    PERFORM pg_temp.t('N1 staff reads the stock list (names, units, par levels: ordering)', staff_, 'staff',
      'SELECT id, name, name_mm, category, par_level, safety_note, purchase_unit_label, usage_unit FROM public.ingredients WHERE NOT is_prep',
      ARRAY['rows=' || n_nonprep]);
    PERFORM pg_temp.t('N2 staff runs the recipe pages'' ingredient read', staff_, 'staff',
      'SELECT id, name, category, is_prep, purchase_unit_label, usage_unit, prep_recipe_id, par_level FROM public.ingredients',
      ARRAY['rows=' || n_ing]);
    PERFORM pg_temp.t('N3 staff runs a template''s ingredient read', staff_, 'staff',
      'SELECT t.id, i.name, i.category, i.usage_unit, i.purchase_unit_label FROM public.template_items t JOIN public.ingredients i ON i.id = t.ingredient_id',
      ARRAY['rows=' || n_titems]);
    PERFORM pg_temp.t('N4 staff reads a purchase price', staff_, 'staff', 'SELECT purchase_cost FROM public.ingredients', ARRAY['denied']);
    PERFORM pg_temp.t('N5 staff reads a yield', staff_, 'staff', 'SELECT yield_qty FROM public.ingredients', ARRAY['denied']);
    PERFORM pg_temp.t('N6 staff reads the cost view', staff_, 'staff', 'SELECT ingredient_id FROM public.ingredient_costs', ARRAY['rows=0']);
    PERFORM pg_temp.t('N7 editor reads the cost view', editor_, 'editor', 'SELECT ingredient_id, purchase_cost FROM public.ingredient_costs', ARRAY['rows=' || n_ing]);
    PERFORM pg_temp.t('N8 admin reads the cost view', admin_, 'admin', 'SELECT ingredient_id, receive_qty FROM public.ingredient_costs', ARRAY['rows=' || n_ing]);
    PERFORM pg_temp.t('N9 sales reads the cost view', sales_, 'sales', 'SELECT ingredient_id FROM public.ingredient_costs', ARRAY['rows=0']);
    PERFORM pg_temp.t('N10 staff asks every prep''s cost', staff_, 'staff', 'SELECT * FROM public.prep_unit_costs()', ARRAY['rows=0']);
    PERFORM pg_temp.t('N11 editor asks every prep''s cost', editor_, 'editor', 'SELECT * FROM public.prep_unit_costs()', ARRAY['rows=' || n_prep]);
    PERFORM pg_temp.t('N12 staff reads the POS receipt costs', staff_, 'staff', 'SELECT id FROM public.pos_receipt_deliveries', ARRAY['rows=0']);
    PERFORM pg_temp.t('N13 editor reads the POS receipt costs', editor_, 'editor', 'SELECT id FROM public.pos_receipt_deliveries', ARRAY['rows=' || n_del]);
    PERFORM pg_temp.t('N14 admin sets a purchase price (the ingredients page)', admin_, 'admin',
      format('UPDATE public.ingredients SET purchase_cost = 12 WHERE id = %L', v_ing), ARRAY['rows=1']);

    -- ── Functions that write: not for anon ──
    PERFORM pg_temp.t('E1 a visitor calls the menu-page save', NULL, 'anon',
      format($q$SELECT public.catering_save_event_menus(%L::uuid, '[]'::jsonb)$q$, v_event), ARRAY['no-execute']);
    PERFORM pg_temp.t('E2 a visitor takes a quotation number', NULL, 'anon',
      $q$SELECT public.next_catering_quote_seq('9912')$q$, ARRAY['no-execute']);
    PERFORM pg_temp.t('E3 owner takes a quotation number (signed-in accounts keep it)', owner_, 'owner',
      $q$SELECT public.next_catering_quote_seq('9912')$q$, ARRAY['rows=1']);

    -- Last: U2 makes a profile, which would change the counts the tests above expect.
    BEGIN
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_u1, 'probe-' || v_u1 || '@example.com', '{"full_name": "probe"}'::jsonb);
      IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_u1) THEN
        RAISE EXCEPTION 'FAIL    U1 a login signed up with an outside address got a profile. Nothing applied.';
      END IF;
      PERFORM pg_temp.note('ok      U1 a new login with an outside address (a public sign-up) gets NO profile');
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES (v_u2, 'probe-' || v_u2 || '@staff.local', '{"full_name": "probe"}'::jsonb);
      IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_u2 AND p.role = 'staff') THEN
        RAISE EXCEPTION 'FAIL    U2 a login the team page makes (<username>@staff.local) got no profile: creating accounts would break. Nothing applied.';
      END IF;
      PERFORM pg_temp.note('ok      U2 a new <username>@staff.local login (the team page''s) gets its staff profile, which createUser then sets');
    EXCEPTION WHEN insufficient_privilege THEN
      PERFORM pg_temp.note('skip    U1 this role may not insert into auth.users here: the rule is checked by its text instead (K3)');
      PERFORM pg_temp.note('skip    U2 as U1');
    END;

    v_log := current_setting('orders.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('orders.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back, the probe rows with them');
  END;
END
$do$;

-- ── Step 5: nothing the tests did survived them, the state is as written, and the file reported ──

DO $do$
DECLARE
  v_rows bigint;
  v_name text;
  -- Every row the file is supposed to emit, counted by the checker's rule
  -- (a t() or a note() is one row). Change a test, change this.
  c_expected constant bigint := 123;
BEGIN
  IF (SELECT count(*) FROM public.menu_sop_steps)::text <> current_setting('sec.n_steps')
     OR (SELECT count(*) FROM public.menu_sops)::text <> current_setting('sec.n_sops')
     OR (SELECT count(*) FROM public.ingredient_price_history)::text <> current_setting('sec.n_hist')
     OR (SELECT count(*) FROM public.suppliers)::text <> current_setting('sec.n_suppliers')
     OR (SELECT count(*) FROM public.pos_price_aliases)::text <> current_setting('sec.n_aliases')
     OR (SELECT count(*) FROM public.templates)::text <> current_setting('sec.n_templates')
     OR (SELECT count(*) FROM public.template_items)::text <> current_setting('sec.n_titems')
     OR (SELECT count(*) FROM public.profiles)::text <> current_setting('sec.n_profiles')
     OR (SELECT count(*) FROM public.catering_events)::text <> current_setting('sec.n_events')
     OR (SELECT count(*) FROM public.menus)::text <> current_setting('sec.n_menus')
     OR (SELECT count(*) FROM public.employees)::text <> current_setting('sec.n_emp')
     OR (SELECT count(*) FROM public.payroll_entries)::text <> current_setting('sec.n_pe')
     OR (SELECT count(*) FROM public.payroll_periods)::text <> current_setting('sec.n_pp')
     OR (SELECT count(*) FROM public.ingredients)::text <> current_setting('sec.n_ing')
     OR (SELECT count(*) FROM public.pos_receipt_deliveries)::text <> current_setting('sec.n_del')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.menu_sop_steps t) <> current_setting('sec.fp_steps')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.suppliers t) <> current_setting('sec.fp_suppliers')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.templates t) <> current_setting('sec.fp_templates')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.template_items t) <> current_setting('sec.fp_titems')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.profiles t) <> current_setting('sec.fp_profiles')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.catering_events t) <> current_setting('sec.fp_events')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.employees t) <> current_setting('sec.fp_emp')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.ingredients t) <> current_setting('sec.fp_ing') THEN
    RAISE EXCEPTION 'FAIL    K0 a count or a fingerprint changed: a test write or a probe row survived. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K0 every count and fingerprint as before (SOPs, steps, price history, suppliers, aliases, templates, template lines, profiles, bookings, menus, employees, payroll, ingredients, POS receipts)');

  SELECT string_agg(p.tablename || '."' || p.policyname || '"', ', ') INTO v_name
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename IN ('menu_sops', 'menu_sop_steps', 'menu_sop_ingredient_notes')
     AND p.permissive = 'PERMISSIVE' AND p.cmd <> 'SELECT'
     AND p.policyname NOT IN ('sop_write', 'sop_notes_write', 'sop_steps_write');
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    K1 another write policy is on the SOP tables: % — it would still let others write. Nothing applied.', v_name;
  END IF;
  PERFORM pg_temp.note('ok      K1 the SOP tables: no write policy but sop_write, sop_notes_write and sop_steps_write (owner, admin, editor)');

  SELECT string_agg('"' || p.policyname || '"', ', ') INTO v_name
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'ingredient_price_history' AND p.permissive = 'PERMISSIVE'
     AND p.cmd IN ('SELECT', 'ALL') AND p.policyname <> 'ingredient_price_history_select';
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    K2 another read policy is on the price history: %. Nothing applied.', v_name;
  END IF;
  PERFORM pg_temp.note('ok      K2 the price history: no read policy but ingredient_price_history_select');

  IF position('@staff.local' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.handle_new_user()'))) = 0
     OR position('''staff''' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.prep_unit_costs()'))) > 0 THEN
    RAISE EXCEPTION 'FAIL    K3 handle_new_user or prep_unit_costs is not the new body. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K3 handle_new_user makes a profile only for <username>@staff.local; prep_unit_costs no longer answers staff');

  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename IN ('suppliers', 'pos_price_aliases')) <> 4
     OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'suppliers' AND p.policyname = 'suppliers_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'suppliers' AND p.policyname = 'suppliers_write')
     OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'pos_price_aliases' AND p.policyname = 'pos_price_aliases_select')
     OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'pos_price_aliases' AND p.policyname = 'pos_price_aliases_write')
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.suppliers'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.pos_price_aliases'::regclass)
     OR has_table_privilege('anon', 'public.suppliers', 'SELECT') OR has_table_privilege('anon', 'public.suppliers', 'UPDATE')
     OR has_table_privilege('anon', 'public.pos_price_aliases', 'SELECT') OR has_table_privilege('anon', 'public.pos_price_aliases', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL    K4 suppliers or pos_price_aliases are not as written. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K4 suppliers and pos_price_aliases: exactly the owner/admin read and write policies, row security on, no privilege for anon');

  SELECT string_agg(p.tablename || '."' || p.policyname || '"', ', ') INTO v_name
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename IN ('templates', 'template_items')
     AND p.permissive = 'PERMISSIVE' AND p.cmd <> 'SELECT'
     AND p.policyname NOT IN ('templates_insert_heads', 'templates_update_heads', 'templates_delete_heads',
                              'template_items_insert_heads', 'template_items_update_heads', 'template_items_delete_heads');
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    K5 another write policy is on the templates: %. Nothing applied.', v_name;
  END IF;
  PERFORM pg_temp.note('ok      K5 templates and template_items: no write policy but the heads'' insert, update and delete');

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_name
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('import_pos_month', 'import_budget69_month', 'import_outsource_month', 'next_catering_quote_seq',
                       'catering_copy_set_menu', 'catering_save_booking_prices', 'catering_save_event_menus')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    K6 executable by anon, or no longer by signed-in accounts: %. Nothing applied.', v_name;
  END IF;
  PERFORM pg_temp.note('ok      K6 the seven functions that write: not executable by anon, still by signed-in accounts');

  IF NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'sop-photos' AND b.file_size_limit = 2097152
                   AND b.allowed_mime_types = ARRAY['image/jpeg']) THEN
    RAISE EXCEPTION 'FAIL    K7 the sop-photos limits are not set. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K7 sop-photos: JPEG only, 2 MB');

  -- K8: the closed columns are closed for every signed-in account and anon,
  -- and the rest of each table is open to signed-in accounts.
  IF has_column_privilege('authenticated', 'public.employees', 'base_salary', 'SELECT')
     OR has_column_privilege('authenticated', 'public.employees', 'position_allowance', 'SELECT')
     OR has_column_privilege('authenticated', 'public.employees', 'social_security_monthly', 'SELECT')
     OR has_column_privilege('authenticated', 'public.employees', 'daily_wage', 'SELECT')
     OR has_column_privilege('anon', 'public.employees', 'base_salary', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.employees', 'full_name', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ingredients', 'purchase_cost', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ingredients', 'receive_qty', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ingredients', 'yield_qty', 'SELECT')
     OR has_column_privilege('anon', 'public.ingredients', 'purchase_cost', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.ingredients', 'name', 'SELECT')
     OR has_table_privilege('anon', 'public.employee_pay', 'SELECT')
     OR has_table_privilege('anon', 'public.ingredient_costs', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.employee_pay', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.ingredient_costs', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.employees', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.ingredients', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL    K8 the pay or cost columns, or their views, are not as written. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K8 the four pay and three cost columns: not selectable by signed-in accounts or anon; the other columns are; employee_pay and ingredient_costs readable by signed-in accounts only (each answers its own roles); the service key keeps the whole tables');

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
  pg_temp.survey(text),
  pg_temp.note(text);

SELECT n, line FROM pg_temp.batch_result() ORDER BY n;

-- ═══ After it runs ════════════════════════════════════════════════════════
--
-- 1. As hr open the employees and payroll pages (salaries shown); as admin
--    open attendance, leave and the schedule (no salary anywhere); as staff
--    open an order form, a template and a recipe (names, no prices); as
--    editor save an SOP; as admin open the ingredients page (prices shown).
-- 2. Then push the branch commit that moves the template writes to the
--    user's session (it needs the policies of 7).
