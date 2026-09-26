-- ═══════════════════════════════════════════════════════════════════════════
-- sop_visibility_and_editor_cost_switch_migration.sql
--
-- NOT APPLIED. Nik's decisions of 2026-09-26 (queue items 55, 56). One
-- transaction: it applies entirely, or nothing.
--
-- EXPECTED RESULT: 109 rows, every line starting "ok", "survey",
-- "note" or "skip", the last one:
--   row count verified: 108 evidence rows emitted, as expected (this line makes 109)
-- Anything that starts "FAIL" stops the file and NOTHING is applied.
--
-- WHAT IT DOES (each is tested below as the real accounts, rolled back):
--  A. PER-SOP "WHO CAN SEE". menu_sops.visibility: 'all' (ทุกคน, the
--     default, every SOP today) or 'chosen' (เฉพาะคนที่เลือก), with the chosen
--     accounts in the new table menu_sop_viewers. public.can_see_sop(id):
--     owner and admin always; anyone else with a profile when the SOP is
--     'all', or when they are chosen. RESTRICTIVE policies on menu_sops,
--     menu_sop_steps and menu_sop_ingredient_notes apply it to every read
--     and write, on top of the policies there now (writes stay owner, admin,
--     editor), so an editor edits only an SOP they can see. Only owner and
--     admin may set who sees an SOP: a trigger refuses anyone else a
--     visibility other than 'all' (on insert) or a change of it (on update),
--     and public.sop_set_visibility(sop, visibility, viewers) is the one
--     save of the setting, in one transaction, owner and admin only. A step
--     or note never moves to another SOP, nor an SOP to another menu, from
--     an app session; a restricted SOP is deleted by owner and admin only
--     (deleted and re-made, it would come back open to all). An SOP request
--     (pending_changes) about an SOP its sender may not see cannot be
--     filed, and its author stops reading it once the SOP is out of sight.
--  B. PER-EDITOR "เห็นต้นทุน". The new table profile_cost_access holds the
--     editors whose switch is on; only the owner switches it ON (Nik), and
--     only for an editor; any change of an account's role clears it. A
--     request that carries prices (an old ingredient edit) is read only by
--     those who see cost. public.can_see_cost(): owner and admin always, an
--     editor with the switch on, nobody else. It now decides the four ways
--     cost leaves the database: the view ingredient_costs (purchase price,
--     receive and yield quantities), the purchase-price history
--     (ingredient_price_history), the POS receipt costs
--     (pos_receipt_deliveries) and prep_unit_costs() (every prep's cost).
--     prep_unit_costs is md5-guarded against the body
--     security_fixes_and_menu_save_lock_migration.sql applied.
--     FIRST RUN ONLY: the switch is turned on for ธีรวัฒน์ and เวช (each
--     identified by id, name and role); แหงน and the "Editor" login stay
--     off. A re-run leaves the switches as Nik has set them.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE — the complete list; anything
-- else is unexpected:
--   CREATE OR REPLACE FUNCTION public.prep_unit_costs (replaced, md5-guarded)
--   CREATE OR REPLACE VIEW public.ingredient_costs (the same columns; its
--     condition becomes public.can_see_cost())
--   ALTER POLICY (USING only) ingredient_price_history_select,
--     pos_receipt_deliveries_select
--   REVOKE ALL ON the views ingredient_costs, employee_pay and
--     catering_staff_options FROM PUBLIC, anon, authenticated, then GRANT
--     SELECT: the three become read-only (ingredient_costs and employee_pay
--     were writable through by Supabase's default privileges; the staff list
--     joins two tables and never was; the app only reads them)
--   ALTER TABLE public.menu_sops ADD COLUMN visibility (NOT NULL DEFAULT
--     'all': every SOP stays open to everyone) and its CHECK
--   DROP POLICY IF EXISTS / DROP TRIGGER IF EXISTS of this file's OWN
--     policies and triggers, each re-created at once (a re-run)
--   CREATE TRIGGER profile_cost_access_clear ON public.profiles (AFTER UPDATE
--     OF role: any role change clears the switch), and two BEFORE UPDATE
--     triggers on menu_sop_steps and menu_sop_ingredient_notes (sop_id stays)
--   CREATE POLICY (RESTRICTIVE) pending_sop_fileable, pending_sop_visible,
--     pending_cost_fields_hidden on public.pending_changes
-- It deletes no row outside the tests, which write inside a block that
-- always rolls back, on rows they make there; each test write touches one
-- row, except sop_set_visibility (the SOP row and its chosen accounts).
--
-- DEPLOY ORDER: this file FIRST, then the branch sop-visibility-cost-switch
-- (the team page's switch, the SOP visibility panel and lock, the cost
-- screens for a switched-off editor), pushed as soon as the result is in.
-- The code live now keeps working after this runs: it reads the same view,
-- history, receipts and function, which answer a switched-off editor with
-- no rows; it does not yet show the switch or the SOP setting. ONE CAUTION
-- for the time between the two: the live ingredients page sends a row's
-- price fields with every edit, so an edit request from a switched-off
-- editor (แหงน, Editor) would carry empty prices. Approve no ingredient
-- edit from them until the branch is live: it sends no price fields for
-- them, the server drops any, and its approval drops the price fields of a
-- request from anyone who cannot see cost now.
--
-- RUN IT AT A QUIET TIME. It locks menu_sops while it runs (SOP pages wait a
-- few seconds), and it compares counts before and after: an app write that
-- lands meanwhile (a price import, an ingredient edit, a new menu) stops it
-- with "FAIL K0 ... Nothing applied" — then simply run it again.
--
-- Also true, and Nik's to know: the owner alone switches เห็นต้นทุน ON; an
-- admin who changes an editor's role and back turns it OFF (any role change
-- clears the switch), never on.
--
-- Never "Run and enable RLS": every table this touches has RLS, and the two
-- it creates switch it on themselves; a policy the editor invents is not one
-- anyone reviewed.
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
  v_name text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['public.profiles', 'public.menus', 'public.menu_recipe_items', 'public.menu_sops',
      'public.menu_sop_steps', 'public.menu_sop_ingredient_notes', 'public.ingredients', 'public.ingredient_costs',
      'public.ingredient_price_history', 'public.pos_receipt_deliveries', 'public.prep_recipes', 'public.pending_changes',
      'public.employee_pay', 'public.catering_staff_options'] LOOP
    IF to_regclass(v_t) IS NULL THEN
      RAISE EXCEPTION 'FAIL    S0 % does not exist. Nothing applied.', v_t;
    END IF;
  END LOOP;
  FOREACH v_t IN ARRAY ARRAY['public.profiles', 'public.menu_sops', 'public.menu_sop_steps', 'public.menu_sop_ingredient_notes',
      'public.ingredients', 'public.ingredient_price_history', 'public.pos_receipt_deliveries', 'public.pending_changes'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_t)) THEN
      RAISE EXCEPTION 'FAIL    S0 % has row security OFF. Nothing applied.', v_t;
    END IF;
  END LOOP;
  -- This file builds on security_fixes_and_menu_save_lock_migration.sql
  -- (applied 2026-09-26): the purchase price is closed as a column, and the
  -- policies this file changes or sits on top of exist by name.
  IF has_column_privilege('authenticated', 'public.ingredients', 'purchase_cost', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL    S0 signed-in accounts can still read ingredients.purchase_cost: security_fixes_and_menu_save_lock_migration.sql is not in place. Nothing applied.';
  END IF;
  SELECT string_agg(x.t || '.' || x.p, ', ') INTO v_name
    FROM (VALUES ('ingredient_price_history', 'ingredient_price_history_select'),
                 ('pos_receipt_deliveries', 'pos_receipt_deliveries_select'),
                 ('menu_sops', 'sop_write'), ('menu_sop_steps', 'sop_steps_write'),
                 ('menu_sop_ingredient_notes', 'sop_notes_write')) AS x(t, p)
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies q WHERE q.schemaname = 'public' AND q.tablename = x.t AND q.policyname = x.p);
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    S0 missing policies: % (security_fixes_and_menu_save_lock_migration.sql made them). Nothing applied.', v_name;
  END IF;
  PERFORM pg_temp.note('ok      S0 the tables this file reads or changes exist with row security on; the security migration of 2026-09-26 is in place (the purchase price closed as a column, its policies there by name)');

  -- The function replaced: the body the security migration applied, or this file's own (a re-run).
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.prep_unit_costs()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('05ac62a2674d1f5b0b9ef06460cf5c5b', '9bc07e8aad344ad0f131177fb6db0da4') THEN
    RAISE EXCEPTION 'FAIL    S1 prep_unit_costs is not the body security_fixes_and_menu_save_lock_migration.sql applied (md5 %): read it live before replacing it (AGENTS.md, rule 4). Nothing applied.', COALESCE(v_md5, 'missing');
  END IF;
  PERFORM pg_temp.note('ok      S1 prep_unit_costs is the body the security migration applied (md5), or this file''s own');

  -- A first run makes the switch table and turns on ธีรวัฒน์'s and เวช's
  -- switches; a re-run leaves every switch as it is.
  PERFORM set_config('vis.first', CASE WHEN to_regclass('public.profile_cost_access') IS NULL THEN 'yes' ELSE 'no' END, false);

  -- One account per role, to test as, and the three named editors: each
  -- by id, name and role, exactly, or the file stops.
  FOREACH v_role IN ARRAY ARRAY['owner', 'admin', 'staff', 'hr', 'sales'] LOOP
    SELECT p.id INTO v_id FROM public.profiles p WHERE p.role = v_role ORDER BY p.id LIMIT 1;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'FAIL    S2 no % account to test as. Nothing applied.', v_role;
    END IF;
    PERFORM set_config('vis.' || v_role, v_id::text, false);
  END LOOP;
  SELECT string_agg(x.n, ', ') INTO v_name
    FROM (VALUES ('3d865777-3469-4574-8aa9-71872413bea1'::uuid, 'ธีรวัฒน์'),
                 ('ef2075c7-9fbc-4c66-8dd1-6528bb810786'::uuid, 'เวช'),
                 ('af72b2ce-b812-403f-97cf-83875b5e477c'::uuid, 'แหงน')) AS x(id, n)
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.id AND p.full_name = x.n AND p.role = 'editor');
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    S2 not found as an editor with that id and name: %. Nothing applied.', v_name;
  END IF;
  -- Tested as: เวช, switch on (and chosen for the probe SOP); แหงน, switch off (not chosen).
  PERFORM set_config('vis.editor_on',  'ef2075c7-9fbc-4c66-8dd1-6528bb810786', false);
  PERFORM set_config('vis.editor_off', 'af72b2ce-b812-403f-97cf-83875b5e477c', false);

  -- Counts and fingerprints, to prove after that nothing the tests did stayed.
  PERFORM set_config('vis.n_sops',     (SELECT count(*) FROM public.menu_sops)::text, false);
  PERFORM set_config('vis.n_steps',    (SELECT count(*) FROM public.menu_sop_steps)::text, false);
  PERFORM set_config('vis.n_notes',    (SELECT count(*) FROM public.menu_sop_ingredient_notes)::text, false);
  PERFORM set_config('vis.n_menus',    (SELECT count(*) FROM public.menus)::text, false);
  PERFORM set_config('vis.n_ing',      (SELECT count(*) FROM public.ingredients)::text, false);
  PERFORM set_config('vis.n_hist',     (SELECT count(*) FROM public.ingredient_price_history)::text, false);
  PERFORM set_config('vis.n_del',      (SELECT count(*) FROM public.pos_receipt_deliveries)::text, false);
  PERFORM set_config('vis.n_profiles', (SELECT count(*) FROM public.profiles)::text, false);
  PERFORM set_config('vis.n_pending',  (SELECT count(*) FROM public.pending_changes)::text, false);
  PERFORM set_config('vis.fp_sops_cols', (SELECT md5(COALESCE(string_agg(row(t.id, t.menu_id, t.author_name, t.updated_at, t.demo_video_url, t.created_at)::text, '|' ORDER BY t.id), '')) FROM public.menu_sops t), false);
  PERFORM set_config('vis.fp_steps',    (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.menu_sop_steps t), false);
  PERFORM set_config('vis.fp_ing',      (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.ingredients t), false);
  PERFORM set_config('vis.fp_profiles', (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.profiles t), false);
  PERFORM pg_temp.note('ok      S2 test accounts found for owner, admin, staff, hr and sales; ธีรวัฒน์, เวช and แหงน found as editors by id and name; counts and fingerprints recorded (the tests make their own rows)');

  PERFORM pg_temp.note(pg_temp.survey('menu_sops'));
  PERFORM pg_temp.note(pg_temp.survey('menu_sop_steps'));
  PERFORM pg_temp.note(pg_temp.survey('menu_sop_ingredient_notes'));
  PERFORM pg_temp.note(pg_temp.survey('ingredient_price_history'));
  PERFORM pg_temp.note(pg_temp.survey('pos_receipt_deliveries'));
  PERFORM pg_temp.note(pg_temp.survey('pending_changes'));
  -- The three views: what signed-in accounts and anon may do through them
  -- besides reading. Supabase grants ALL on every new table and view to
  -- both by default, and a view writes to its table as the view's owner,
  -- past that table's own policies.
  PERFORM pg_temp.note(format('survey  views before: %s',
    (SELECT string_agg(format('%s (anon %s; signed-in %s)', v,
               COALESCE(NULLIF(concat_ws(',',
                 CASE WHEN has_table_privilege('anon', v, 'INSERT') THEN 'insert' END,
                 CASE WHEN has_table_privilege('anon', v, 'UPDATE') THEN 'update' END,
                 CASE WHEN has_table_privilege('anon', v, 'DELETE') THEN 'delete' END), ''), 'read only or nothing'),
               COALESCE(NULLIF(concat_ws(',',
                 CASE WHEN has_table_privilege('authenticated', v, 'INSERT') THEN 'insert' END,
                 CASE WHEN has_table_privilege('authenticated', v, 'UPDATE') THEN 'update' END,
                 CASE WHEN has_table_privilege('authenticated', v, 'DELETE') THEN 'delete' END), ''), 'read only')), '; ' ORDER BY v)
       FROM unnest(ARRAY['public.ingredient_costs', 'public.employee_pay', 'public.catering_staff_options']) AS v)));
  PERFORM pg_temp.note(format('survey  before: SOPs %s (steps %s, ingredient notes %s); editors %s; first run: %s',
    current_setting('vis.n_sops'), current_setting('vis.n_steps'), current_setting('vis.n_notes'),
    (SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name) FROM public.profiles p WHERE p.role = 'editor'),
    current_setting('vis.first')));
END
$do$;

-- ── Step 1: the เห็นต้นทุน switch ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profile_cost_access (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.profile_cost_access IS
  'An editor listed here has the เห็นต้นทุน switch ON (Nik, 2026-09-26): public.can_see_cost() lets them read purchase prices, the price history, POS receipt costs and prep costs. Owner and admin always can; nobody else ever. Only the owner switches it, only for an editor.';
ALTER TABLE public.profile_cost_access ENABLE ROW LEVEL SECURITY;
-- authenticated too: Supabase's default privileges grant it ALL on a new table.
REVOKE ALL ON public.profile_cost_access FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.profile_cost_access TO authenticated;
GRANT ALL ON public.profile_cost_access TO service_role;
DROP POLICY IF EXISTS profile_cost_access_select ON public.profile_cost_access;
CREATE POLICY profile_cost_access_select ON public.profile_cost_access FOR SELECT TO authenticated
  USING (public.current_role() IN ('owner', 'admin') OR profile_id = auth.uid());
DROP POLICY IF EXISTS profile_cost_access_insert ON public.profile_cost_access;
CREATE POLICY profile_cost_access_insert ON public.profile_cost_access FOR INSERT TO authenticated
  WITH CHECK (public.is_owner_only()
              AND granted_by IS NOT DISTINCT FROM auth.uid()
              AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = profile_cost_access.profile_id AND p.role = 'editor'));
DROP POLICY IF EXISTS profile_cost_access_delete ON public.profile_cost_access;
CREATE POLICY profile_cost_access_delete ON public.profile_cost_access FOR DELETE TO authenticated
  USING (public.is_owner_only());

CREATE OR REPLACE FUNCTION public.can_see_cost()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- Owner and admin always; an editor whose เห็นต้นทุน switch is on; nobody
  -- else, and never a login with no profile.
  SELECT COALESCE((
    SELECT p.role IN ('owner', 'admin')
           OR (p.role = 'editor' AND EXISTS (SELECT 1 FROM public.profile_cost_access a WHERE a.profile_id = p.id))
      FROM public.profiles p
     WHERE p.id = auth.uid()), false);
$fn$;
REVOKE EXECUTE ON FUNCTION public.can_see_cost() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_cost() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profile_cost_access_clear()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- The switch belongs to an editor. ANY change of role clears it, so an
  -- account made an editor always starts OFF, even when a switch row was
  -- left behind by a role change racing the owner's switch (review,
  -- 2026-09-26). Whoever changes the role (admin may, and admin may not
  -- touch the switch table, hence SECURITY DEFINER).
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    DELETE FROM public.profile_cost_access WHERE profile_id = NEW.id;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE EXECUTE ON FUNCTION public.profile_cost_access_clear() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS profile_cost_access_clear ON public.profiles;
CREATE TRIGGER profile_cost_access_clear
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profile_cost_access_clear();

-- The four ways cost leaves the database, each now asking can_see_cost().
CREATE OR REPLACE VIEW public.ingredient_costs WITH (security_barrier = true) AS
  SELECT i.id AS ingredient_id, i.purchase_cost, i.receive_qty, i.yield_qty
    FROM public.ingredients i
   WHERE public.can_see_cost();
-- THE THREE VIEWS ARE READ-ONLY (review, 2026-09-26). A view writes to its
-- table as the view's owner, past the table's own policies, and Supabase's
-- default privileges grant signed-in accounts ALL on every new view: an
-- editor could set a purchase price through ingredient_costs (bypassing the
-- ingredients write policy and the approval queue), sales could rename an
-- employee through catering_staff_options. The app only reads them.
REVOKE ALL ON public.ingredient_costs, public.employee_pay, public.catering_staff_options FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ingredient_costs, public.employee_pay, public.catering_staff_options TO authenticated;
GRANT SELECT ON public.ingredient_costs, public.employee_pay TO service_role;
COMMENT ON VIEW public.ingredient_costs IS
  'Purchase price, receive and yield quantities per ingredient, for public.can_see_cost() (owner, admin, an editor with the เห็นต้นทุน switch on); no rows for anyone else. The three columns are closed on ingredients itself.';

ALTER POLICY ingredient_price_history_select ON public.ingredient_price_history
  USING (public.can_see_cost());
ALTER POLICY pos_receipt_deliveries_select ON public.pos_receipt_deliveries
  USING (public.can_see_cost());

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
   -- A prep's cost is a cost: owner, admin, and an editor whose เห็นต้นทุน
   -- switch is on (Nik, 2026-09-26). Nobody else.
   WHERE public.can_see_cost()
   GROUP BY p.id;
$fn$;
REVOKE EXECUTE ON FUNCTION public.prep_unit_costs() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prep_unit_costs() TO authenticated;

-- ── Step 2: first run only, the switch on for ธีรวัฒน์ and เวช ─────────────

DO $do$
DECLARE
  v_n bigint;
BEGIN
  IF current_setting('vis.first') = 'yes' THEN
    INSERT INTO public.profile_cost_access (profile_id, granted_by)
    SELECT p.id, NULL
      FROM public.profiles p
     WHERE (p.id = '3d865777-3469-4574-8aa9-71872413bea1'::uuid AND p.full_name = 'ธีรวัฒน์' AND p.role = 'editor')
        OR (p.id = 'ef2075c7-9fbc-4c66-8dd1-6528bb810786'::uuid AND p.full_name = 'เวช' AND p.role = 'editor')
    ON CONFLICT (profile_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'FAIL    G1 the switch went on for % editors, expected 2 (ธีรวัฒน์, เวช). Nothing applied.', v_n;
    END IF;
    PERFORM pg_temp.note('ok      G1 first run: เห็นต้นทุน switched ON for ธีรวัฒน์ and เวช; every other editor (แหงน, Editor) off');
  ELSE
    PERFORM pg_temp.note(format('skip    G1 a re-run: the switches are left as they are (on for: %s)',
      COALESCE((SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name)
                  FROM public.profile_cost_access a JOIN public.profiles p ON p.id = a.profile_id), 'nobody')));
  END IF;
END
$do$;

-- ── Step 3: per-SOP "who can see" ──────────────────────────────────────────

ALTER TABLE public.menu_sops ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'all';
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.menu_sops'::regclass AND c.conname = 'menu_sops_visibility_check') THEN
    ALTER TABLE public.menu_sops ADD CONSTRAINT menu_sops_visibility_check CHECK (visibility IN ('all', 'chosen'));
  END IF;
END
$do$;
COMMENT ON COLUMN public.menu_sops.visibility IS
  '''all'' (ทุกคน, the default): everyone with a profile sees this SOP. ''chosen'' (เฉพาะคนที่เลือก): owner, admin and the accounts in menu_sop_viewers only. Set by owner and admin only (sop_set_visibility; the trigger menu_sops_visibility_guard refuses anyone else).';

CREATE TABLE IF NOT EXISTS public.menu_sop_viewers (
  sop_id     uuid NOT NULL REFERENCES public.menu_sops(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_by uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sop_id, profile_id)
);
COMMENT ON TABLE public.menu_sop_viewers IS
  'The accounts chosen to see an SOP whose visibility is ''chosen''. Owner and admin see every SOP and are never listed. Written by owner and admin only.';
ALTER TABLE public.menu_sop_viewers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_sop_viewers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.menu_sop_viewers TO authenticated;
GRANT ALL ON public.menu_sop_viewers TO service_role;
DROP POLICY IF EXISTS menu_sop_viewers_select ON public.menu_sop_viewers;
CREATE POLICY menu_sop_viewers_select ON public.menu_sop_viewers FOR SELECT TO authenticated
  USING (public.current_role() IN ('owner', 'admin') OR profile_id = auth.uid());
DROP POLICY IF EXISTS menu_sop_viewers_insert ON public.menu_sop_viewers;
CREATE POLICY menu_sop_viewers_insert ON public.menu_sop_viewers FOR INSERT TO authenticated
  WITH CHECK (public.current_role() IN ('owner', 'admin'));
DROP POLICY IF EXISTS menu_sop_viewers_delete ON public.menu_sop_viewers;
CREATE POLICY menu_sop_viewers_delete ON public.menu_sop_viewers FOR DELETE TO authenticated
  USING (public.current_role() IN ('owner', 'admin'));

-- THE rule, on an SOP row's own values. menu_sops' own policies ask it of
-- the row itself, so a row being inserted (not yet in the table, which an
-- INSERT ... ON CONFLICT or RETURNING checks against the read policy) is
-- judged by what it says; the trigger has already kept an editor's new row
-- at 'all' (review, 2026-09-26).
CREATE OR REPLACE FUNCTION public.sop_row_visible(p_id uuid, p_visibility text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- Owner and admin: every SOP. Anyone else with a profile: an SOP open to
  -- all ('all'), or one they are chosen for. A login with no profile: none.
  SELECT CASE
    WHEN public.current_role() IS NULL THEN false
    WHEN public.current_role() IN ('owner', 'admin') THEN true
    WHEN p_visibility = 'all' THEN true
    ELSE EXISTS (SELECT 1 FROM public.menu_sop_viewers v
                  WHERE v.sop_id = p_id AND v.profile_id = auth.uid())
  END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_row_visible(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_row_visible(uuid, text) TO authenticated, service_role;

-- The same rule by an SOP's id: its steps and notes ask it of their SOP.
CREATE OR REPLACE FUNCTION public.can_see_sop(p_sop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN public.current_role() IS NULL THEN false
    WHEN public.current_role() IN ('owner', 'admin') THEN true
    ELSE COALESCE((SELECT public.sop_row_visible(s.id, s.visibility) FROM public.menu_sops s WHERE s.id = p_sop), false)
  END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.can_see_sop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_sop(uuid) TO authenticated, service_role;

-- RESTRICTIVE: on top of the read policies (a profile) and the write
-- policies (owner, admin, editor) already there, never instead of them.
DROP POLICY IF EXISTS sop_visible_select ON public.menu_sops;
CREATE POLICY sop_visible_select ON public.menu_sops AS RESTRICTIVE FOR SELECT TO public
  USING (public.sop_row_visible(id, visibility));
DROP POLICY IF EXISTS sop_visible_update ON public.menu_sops;
CREATE POLICY sop_visible_update ON public.menu_sops AS RESTRICTIVE FOR UPDATE TO public
  USING (public.sop_row_visible(id, visibility));
DROP POLICY IF EXISTS sop_visible_delete ON public.menu_sops;
CREATE POLICY sop_visible_delete ON public.menu_sops AS RESTRICTIVE FOR DELETE TO public
  USING (public.sop_row_visible(id, visibility)
         AND (public.current_role() IN ('owner', 'admin') OR visibility = 'all'));
DROP POLICY IF EXISTS sop_steps_visible ON public.menu_sop_steps;
CREATE POLICY sop_steps_visible ON public.menu_sop_steps AS RESTRICTIVE FOR ALL TO public
  USING (public.can_see_sop(sop_id)) WITH CHECK (public.can_see_sop(sop_id));
DROP POLICY IF EXISTS sop_notes_visible ON public.menu_sop_ingredient_notes;
CREATE POLICY sop_notes_visible ON public.menu_sop_ingredient_notes AS RESTRICTIVE FOR ALL TO public
  USING (public.can_see_sop(sop_id)) WITH CHECK (public.can_see_sop(sop_id));

CREATE OR REPLACE FUNCTION public.menu_sops_visibility_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Who sees an SOP is set by owner and admin only. An editor may make an
  -- SOP (open to all) and edit one they can see, never change who sees it.
  -- No session at all (the SQL editor, the service key) is trusted.
  IF auth.uid() IS NOT NULL
     AND COALESCE(public.current_role(), '') NOT IN ('owner', 'admin')
     AND ((TG_OP = 'INSERT' AND NEW.visibility IS DISTINCT FROM 'all')
          OR (TG_OP = 'UPDATE' AND NEW.visibility IS DISTINCT FROM OLD.visibility)) THEN
    RAISE EXCEPTION 'เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่ตั้งได้ว่าใครเห็น SOP นี้';
  END IF;
  -- An SOP stays with its menu: moved under another menu, a restricted SOP
  -- would take its place where that menu's audience reads. The app never
  -- moves one; no session may.
  IF auth.uid() IS NOT NULL AND TG_OP = 'UPDATE' AND NEW.menu_id IS DISTINCT FROM OLD.menu_id THEN
    RAISE EXCEPTION 'ย้าย SOP ไปเมนูอื่นไม่ได้';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE EXECUTE ON FUNCTION public.menu_sops_visibility_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS menu_sops_visibility_guard ON public.menu_sops;
CREATE TRIGGER menu_sops_visibility_guard
  BEFORE INSERT OR UPDATE ON public.menu_sops
  FOR EACH ROW EXECUTE FUNCTION public.menu_sops_visibility_guard();

-- A step or note stays with its SOP: moved into an SOP open to all, a
-- restricted SOP's content would be read by everyone (review, 2026-09-26).
CREATE OR REPLACE FUNCTION public.menu_sop_child_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.sop_id IS DISTINCT FROM OLD.sop_id THEN
    RAISE EXCEPTION 'ย้ายขั้นตอนหรือหมายเหตุไปยัง SOP อื่นไม่ได้';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE EXECUTE ON FUNCTION public.menu_sop_child_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS menu_sop_steps_child_guard ON public.menu_sop_steps;
CREATE TRIGGER menu_sop_steps_child_guard
  BEFORE UPDATE ON public.menu_sop_steps
  FOR EACH ROW EXECUTE FUNCTION public.menu_sop_child_guard();
DROP TRIGGER IF EXISTS menu_sop_notes_child_guard ON public.menu_sop_ingredient_notes;
CREATE TRIGGER menu_sop_notes_child_guard
  BEFORE UPDATE ON public.menu_sop_ingredient_notes
  FOR EACH ROW EXECUTE FUNCTION public.menu_sop_child_guard();

CREATE OR REPLACE FUNCTION public.sop_set_visibility(p_sop uuid, p_visibility text, p_viewers uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_bad uuid;
BEGIN
  -- THE one save of who sees an SOP: its visibility and chosen accounts
  -- together, in one transaction. Runs under the caller's own policies.
  IF COALESCE(public.current_role(), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่ตั้งได้ว่าใครเห็น SOP นี้';
  END IF;
  IF p_visibility IS NULL OR p_visibility NOT IN ('all', 'chosen') THEN
    RAISE EXCEPTION 'การตั้งค่าไม่ถูกต้อง: ต้องเป็น ทุกคน หรือ เฉพาะคนที่เลือก';
  END IF;
  PERFORM 1 FROM public.menu_sops s WHERE s.id = p_sop FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบ SOP นี้';
  END IF;
  -- Chosen accounts must be real profiles. Owner and admin see every SOP:
  -- listed, they are dropped, not refused, so a chosen account promoted
  -- since never blocks the next save (review, 2026-09-26).
  SELECT v INTO v_bad
    FROM unnest(COALESCE(p_viewers, '{}'::uuid[])) AS v
   WHERE v IS NULL OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'บัญชีที่เลือกไม่ถูกต้อง';
  END IF;
  -- Only a real change touches the SOP row: every update of it moves the
  -- SOP's printed revision date (touch_updated_at).
  UPDATE public.menu_sops SET visibility = p_visibility WHERE id = p_sop AND visibility IS DISTINCT FROM p_visibility;
  IF p_visibility = 'all' THEN
    -- Open to all: no list is kept, so none can come back into force later.
    DELETE FROM public.menu_sop_viewers WHERE sop_id = p_sop;
    RETURN;
  END IF;
  DELETE FROM public.menu_sop_viewers w
   WHERE w.sop_id = p_sop
     AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p_viewers, '{}'::uuid[])) AS v
                       JOIN public.profiles p ON p.id = v
                      WHERE v = w.profile_id AND p.role NOT IN ('owner', 'admin'));
  INSERT INTO public.menu_sop_viewers (sop_id, profile_id)
  SELECT DISTINCT p_sop, v
    FROM unnest(COALESCE(p_viewers, '{}'::uuid[])) AS v
    JOIN public.profiles p ON p.id = v
   WHERE p.role NOT IN ('owner', 'admin')
  ON CONFLICT (sop_id, profile_id) DO NOTHING;
END
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_set_visibility(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_set_visibility(uuid, text, uuid[]) TO authenticated, service_role;

-- An SOP request follows the SOP (review, 2026-09-26). The approver sees
-- every SOP, so an approval cannot be refused by the database; instead a
-- request about an SOP its sender may not see cannot be FILED, and a
-- request's author stops reading it (its payload carries the SOP's text and
-- photo addresses) once the SOP is out of their sight. True for any other
-- request, for owner and admin, for a menu with no SOP, and for a target
-- that is not a menu id (the approval refuses that anyway).
CREATE OR REPLACE FUNCTION public.sop_request_allowed(p_change_type text, p_target text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN p_change_type IS NULL OR p_change_type NOT IN ('sop_upsert', 'sop_delete') THEN true
    WHEN public.current_role() IN ('owner', 'admin') THEN true
    WHEN p_target IS NULL OR p_target !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN true
    ELSE NOT EXISTS (SELECT 1 FROM public.menu_sops s
                      WHERE s.menu_id = p_target::uuid AND NOT public.can_see_sop(s.id))
  END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_request_allowed(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_request_allowed(text, text) TO authenticated, service_role;
DROP POLICY IF EXISTS pending_sop_fileable ON public.pending_changes;
CREATE POLICY pending_sop_fileable ON public.pending_changes AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.sop_request_allowed(change_type, target_id));
DROP POLICY IF EXISTS pending_sop_visible ON public.pending_changes;
CREATE POLICY pending_sop_visible ON public.pending_changes AS RESTRICTIVE FOR SELECT TO public
  USING (public.sop_request_allowed(change_type, target_id));

-- A request that carries prices is read only by those who see cost
-- (review, 2026-09-26). Until this branch, the ingredients page sent a row's
-- price boxes with every save, so every ingredient request an editor ever
-- filed holds real prices, and its author reads it: switched off, they would
-- still read them. Owner and admin (the approval queue) always see them.
DROP POLICY IF EXISTS pending_cost_fields_hidden ON public.pending_changes;
CREATE POLICY pending_cost_fields_hidden ON public.pending_changes AS RESTRICTIVE FOR SELECT TO public
  USING (change_type IS NULL
         OR change_type NOT IN ('ingredient_edit', 'ingredient_create')
         OR public.can_see_cost()
         OR NOT (COALESCE(payload -> 'fields', '{}'::jsonb) ?| ARRAY['purchase_cost', 'receive_qty', 'yield_qty']));

-- ── Step 4: tests, as the real accounts, on rows they make, all rolled back ──

DO $do$
DECLARE
  owner_ uuid := current_setting('vis.owner')::uuid;
  admin_ uuid := current_setting('vis.admin')::uuid;
  staff_ uuid := current_setting('vis.staff')::uuid;
  hr_    uuid := current_setting('vis.hr')::uuid;
  sales_ uuid := current_setting('vis.sales')::uuid;
  on_    uuid := current_setting('vis.editor_on')::uuid;    -- เวช: switch on, chosen for the probe SOP
  off_   uuid := current_setting('vis.editor_off')::uuid;   -- แหงน: switch off, not chosen
  -- A login with no profile row: a uuid no profile has.
  nobody_ uuid := gen_random_uuid();
  v_ing   uuid;   -- a probe ingredient, priced, with a price-history row
  v_menu1 uuid; v_sop1 uuid; v_step1 uuid;   -- a probe SOP for chosen accounts (เวช)
  v_menu2 uuid; v_sop2 uuid;                 -- a probe SOP open to all
  v_menu3 uuid; v_menu4 uuid;                -- probe menus with no SOP yet
  n_ing bigint; n_hist bigint; n_del bigint; n_prep bigint; n_lines bigint; n_switch bigint; n_emp bigint;
  v_log text;
BEGIN
  -- Recorded outside the block that rolls back, so Step 5 can compare.
  PERFORM set_config('vis.n_viewers', (SELECT count(*) FROM public.menu_sop_viewers)::text, false);
  PERFORM set_config('vis.n_switch', (SELECT count(*) FROM public.profile_cost_access)::text, false);
  BEGIN
    -- ── The rows the tests need, made here (never live data's) ──
    INSERT INTO public.ingredients (name, purchase_cost, receive_qty) VALUES ('probe-vis ' || gen_random_uuid(), 10, 1) RETURNING id INTO v_ing;
    UPDATE public.ingredients SET purchase_cost = 11 WHERE id = v_ing;   -- its trigger writes one price-history row
    INSERT INTO public.pos_receipt_deliveries (material_code, material_name, document_number, document_date, unit_name, qty, total_cost_inc_vat, total_cost_exc_vat)
    VALUES ('PROBE-VIS', 'probe-vis', 'PROBE-VIS-' || gen_random_uuid(), DATE '2099-01-01', 'x', 1, 1, 1);
    INSERT INTO public.menus (name, selling_price) VALUES ('probe-vis 1 ' || gen_random_uuid(), 0) RETURNING id INTO v_menu1;
    INSERT INTO public.menus (name, selling_price) VALUES ('probe-vis 2 ' || gen_random_uuid(), 0) RETURNING id INTO v_menu2;
    INSERT INTO public.menus (name, selling_price) VALUES ('probe-vis 3 ' || gen_random_uuid(), 0) RETURNING id INTO v_menu3;
    INSERT INTO public.menus (name, selling_price) VALUES ('probe-vis 4 ' || gen_random_uuid(), 0) RETURNING id INTO v_menu4;
    INSERT INTO public.menu_recipe_items (menu_id, ingredient_id, quantity) VALUES (v_menu1, v_ing, 1);
    INSERT INTO public.menu_sops (menu_id, visibility) VALUES (v_menu1, 'chosen') RETURNING id INTO v_sop1;
    INSERT INTO public.menu_sop_viewers (sop_id, profile_id) VALUES (v_sop1, on_);
    INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (v_sop1, 'prep', 1, 'probe-vis') RETURNING id INTO v_step1;
    INSERT INTO public.menu_sop_ingredient_notes (sop_id, ingredient_id, note) VALUES (v_sop1, v_ing, 'probe-vis');
    INSERT INTO public.menu_sops (menu_id) VALUES (v_menu2) RETURNING id INTO v_sop2;
    INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
    VALUES (off_, 'sop_upsert', v_menu1::text, '{"probe": "vis"}'::jsonb);
    -- Two old ingredient requests with prices in them, one by each editor.
    INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload)
    VALUES (off_, 'ingredient_edit', v_ing::text, jsonb_build_object('probe', 'vis', 'fields', jsonb_build_object('name', 'x', 'purchase_cost', 310, 'receive_qty', 1))),
           (on_,  'ingredient_edit', v_ing::text, jsonb_build_object('probe', 'vis', 'fields', jsonb_build_object('name', 'x', 'purchase_cost', 310, 'receive_qty', 1)));
    -- A switch row left behind on the hr account (a role change racing the owner's switch).
    INSERT INTO public.profile_cost_access (profile_id) VALUES (hr_) ON CONFLICT (profile_id) DO NOTHING;
    INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (v_sop2, 'prep', 1, 'probe-vis');
    -- The two switches as the tests need them, whatever Nik has set since.
    INSERT INTO public.profile_cost_access (profile_id) VALUES (on_) ON CONFLICT (profile_id) DO NOTHING;
    DELETE FROM public.profile_cost_access WHERE profile_id = off_;
    SELECT count(*) INTO n_ing FROM public.ingredients;
    SELECT count(*) INTO n_hist FROM public.ingredient_price_history;
    SELECT count(*) INTO n_del FROM public.pos_receipt_deliveries;
    SELECT count(*) INTO n_prep FROM public.prep_recipes;
    SELECT count(*) INTO n_lines FROM public.menu_recipe_items;
    SELECT count(*) INTO n_switch FROM public.profile_cost_access;
    SELECT count(*) INTO n_emp FROM public.employees;
    IF n_hist = 0 OR n_del = 0 THEN
      RAISE EXCEPTION 'FAIL    T0 a probe row was not made (price history %, POS receipt lines %): the tests would prove nothing. Nothing applied.', n_hist, n_del;
    END IF;
    PERFORM pg_temp.note('ok      T0 the probe rows are made (a priced ingredient with its price-history row, a POS receipt line, a recipe line, an SOP for chosen accounts with เวช chosen and a step and a note, an SOP open to all with a step, two menus with no SOP); เวช''s switch on, แหงน''s off');

    -- ── B. เห็นต้นทุน: the four ways cost leaves the database ──
    PERFORM pg_temp.t('C1 owner reads the cost view', owner_, 'owner', 'SELECT ingredient_id, purchase_cost FROM public.ingredient_costs', ARRAY['rows=' || n_ing]);
    PERFORM pg_temp.t('C2 admin reads the cost view', admin_, 'admin', 'SELECT ingredient_id, purchase_cost FROM public.ingredient_costs', ARRAY['rows=' || n_ing]);
    PERFORM pg_temp.t('C3 an editor with the switch ON (เวช) reads the cost view', on_, 'editor', 'SELECT ingredient_id, purchase_cost FROM public.ingredient_costs', ARRAY['rows=' || n_ing]);
    PERFORM pg_temp.t('C4 an editor with the switch OFF (แหงน) reads the cost view', off_, 'editor', 'SELECT ingredient_id, purchase_cost FROM public.ingredient_costs', ARRAY['rows=0']);
    PERFORM pg_temp.t('C5 staff reads the cost view', staff_, 'staff', 'SELECT ingredient_id FROM public.ingredient_costs', ARRAY['rows=0']);
    PERFORM pg_temp.t('C6 sales reads the cost view', sales_, 'sales', 'SELECT ingredient_id FROM public.ingredient_costs', ARRAY['rows=0']);
    PERFORM pg_temp.t('C7 a login with no profile reads the cost view', nobody_, 'no-profile', 'SELECT ingredient_id FROM public.ingredient_costs', ARRAY['rows=0']);
    PERFORM pg_temp.t('C7a hr reads the cost view', hr_, 'hr', 'SELECT ingredient_id FROM public.ingredient_costs', ARRAY['rows=0']);
    PERFORM pg_temp.t('C8 switch OFF: the purchase-price history', off_, 'editor', 'SELECT id FROM public.ingredient_price_history', ARRAY['rows=0']);
    PERFORM pg_temp.t('C9 switch ON: the purchase-price history', on_, 'editor', 'SELECT id FROM public.ingredient_price_history', ARRAY['rows=' || n_hist]);
    PERFORM pg_temp.t('C10 switch OFF: the POS receipt costs', off_, 'editor', 'SELECT id, total_cost_inc_vat FROM public.pos_receipt_deliveries', ARRAY['rows=0']);
    PERFORM pg_temp.t('C11 switch ON: the POS receipt costs', on_, 'editor', 'SELECT id, total_cost_inc_vat FROM public.pos_receipt_deliveries', ARRAY['rows=' || n_del]);
    PERFORM pg_temp.t('C12 switch OFF: every prep''s cost', off_, 'editor', 'SELECT * FROM public.prep_unit_costs()', ARRAY['rows=0']);
    PERFORM pg_temp.t('C13 switch ON: every prep''s cost', on_, 'editor', 'SELECT * FROM public.prep_unit_costs()', ARRAY['rows=' || n_prep]);
    PERFORM pg_temp.t('C14 staff: every prep''s cost (unchanged: none)', staff_, 'staff', 'SELECT * FROM public.prep_unit_costs()', ARRAY['rows=0']);
    PERFORM pg_temp.t('C15 switch OFF: a purchase price straight from ingredients', off_, 'editor', 'SELECT purchase_cost FROM public.ingredients', ARRAY['denied']);
    PERFORM pg_temp.t('C16 switch OFF: ingredient names and units (the ingredient screens still work)', off_, 'editor',
      'SELECT id, name, usage_unit, purchase_unit_label, category FROM public.ingredients', ARRAY['rows=' || n_ing]);
    PERFORM pg_temp.t('C17 switch OFF: recipe lines and their menus (the recipe screens still work)', off_, 'editor',
      'SELECT ri.id, ri.quantity, m.name FROM public.menu_recipe_items ri JOIN public.menus m ON m.id = ri.menu_id', ARRAY['rows=' || n_lines]);
    PERFORM pg_temp.t('C18 switch OFF: the editor switches itself on', off_, 'editor',
      format('INSERT INTO public.profile_cost_access (profile_id) VALUES (%L)', off_), ARRAY['denied']);
    PERFORM pg_temp.t('C19 switch ON: the editor switches itself off', on_, 'editor',
      format('DELETE FROM public.profile_cost_access WHERE profile_id = %L', on_), ARRAY['rows=0']);
    PERFORM pg_temp.t('C20 admin switches an editor on (only the owner may)', admin_, 'admin',
      format('INSERT INTO public.profile_cost_access (profile_id) VALUES (%L)', off_), ARRAY['denied']);
    PERFORM pg_temp.t('C21 owner switches a staff account on (editors only)', owner_, 'owner',
      format('INSERT INTO public.profile_cost_access (profile_id) VALUES (%L)', staff_), ARRAY['denied']);
    PERFORM pg_temp.t('C22 owner switches แหงน ON', owner_, 'owner',
      format('INSERT INTO public.profile_cost_access (profile_id) VALUES (%L)', off_), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('C23 แหงน, now on, reads the cost view', off_, 'editor', 'SELECT ingredient_id FROM public.ingredient_costs', ARRAY['rows=' || n_ing]);
    PERFORM pg_temp.t('C23a owner makes แหงน staff: the switch goes with the editor role', owner_, 'owner',
      format('UPDATE public.profiles SET role = %L WHERE id = %L', 'staff', off_), ARRAY['rows=1 check=0'],
      format('SELECT profile_id FROM public.profile_cost_access WHERE profile_id = %L', off_));
    PERFORM pg_temp.t('C23b a switch row left on the hr account: made an editor, it starts OFF', owner_, 'owner',
      format('UPDATE public.profiles SET role = %L WHERE id = %L', 'editor', hr_), ARRAY['rows=1 check=0'],
      format('SELECT profile_id FROM public.profile_cost_access WHERE profile_id = %L', hr_));
    PERFORM pg_temp.t('C24 owner switches แหงน OFF again', owner_, 'owner',
      format('DELETE FROM public.profile_cost_access WHERE profile_id = %L', off_), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('C25 แหงน, off again, reads the cost view', off_, 'editor', 'SELECT ingredient_id FROM public.ingredient_costs', ARRAY['rows=0']);
    PERFORM pg_temp.t('C26 switch OFF: who has the switch (not even its own row)', off_, 'editor', 'SELECT profile_id FROM public.profile_cost_access', ARRAY['rows=0']);
    PERFORM pg_temp.t('C26a switch ON: who has the switch (its own row only)', on_, 'editor', 'SELECT profile_id FROM public.profile_cost_access', ARRAY['rows=1']);
    PERFORM pg_temp.t('C27 owner reads who has the switch (the team page)', owner_, 'owner', 'SELECT profile_id FROM public.profile_cost_access', ARRAY['rows=' || n_switch]);

    -- Old requests carry prices: read only by those who see cost.
    PERFORM pg_temp.t('Q1 switch OFF: its own old ingredient request, which holds a price', off_, 'editor',
      format('SELECT id FROM public.pending_changes WHERE editor_id = %L AND target_id = %L', off_, v_ing), ARRAY['rows=0']);
    PERFORM pg_temp.t('Q2 switch ON: its own old ingredient request', on_, 'editor',
      format('SELECT id FROM public.pending_changes WHERE editor_id = %L AND target_id = %L', on_, v_ing), ARRAY['rows=1']);
    PERFORM pg_temp.t('Q3 admin reads both (the approval queue)', admin_, 'admin',
      format('SELECT id FROM public.pending_changes WHERE target_id = %L', v_ing), ARRAY['rows=2']);
    PERFORM pg_temp.t('Q4 switch OFF: files an ingredient edit without prices, the app''s way (insert, then read its id)', off_, 'editor',
      format($q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload) VALUES (%L, 'ingredient_edit', %L, '{"fields": {"name": "x"}}'::jsonb) RETURNING id$q$, off_, v_ing), ARRAY['rows=1']);
    -- The three views are read-only.
    PERFORM pg_temp.t('W1 switch ON: sets a purchase price through the cost view', on_, 'editor',
      format('UPDATE public.ingredient_costs SET purchase_cost = 999 WHERE ingredient_id = %L', v_ing), ARRAY['denied']);
    PERFORM pg_temp.t('W2 admin: the same (prices are set on the ingredients page)', admin_, 'admin',
      format('UPDATE public.ingredient_costs SET purchase_cost = 999 WHERE ingredient_id = %L', v_ing), ARRAY['denied']);
    PERFORM pg_temp.t('W3 hr sets a salary through the pay view', hr_, 'hr',
      'UPDATE public.employee_pay SET daily_wage = daily_wage', ARRAY['denied']);
    PERFORM pg_temp.t('W4 sales reads the staff list (the booking screen)', sales_, 'sales',
      'SELECT id, nickname FROM public.catering_staff_options', ARRAY['rows=' || n_emp]);

    -- ── A. Per-SOP "who can see" ──
    PERFORM pg_temp.t('V1 owner reads the SOP for chosen accounts', owner_, 'owner', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V2 admin reads it', admin_, 'admin', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V3 the chosen editor (เวช) reads it', on_, 'editor', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V4 an editor not chosen (แหงน) reads it', off_, 'editor', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V5 staff reads it', staff_, 'staff', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V6 sales reads it', sales_, 'sales', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V7 hr reads it', hr_, 'hr', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V8 a login with no profile reads it', nobody_, 'no-profile', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V9 not chosen: its steps', off_, 'editor', format('SELECT id FROM public.menu_sop_steps WHERE sop_id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V10 not chosen: its ingredient notes', off_, 'editor', format('SELECT id FROM public.menu_sop_ingredient_notes WHERE sop_id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V10a the chosen editor: its ingredient notes', on_, 'editor', format('SELECT id FROM public.menu_sop_ingredient_notes WHERE sop_id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V11 staff: its steps', staff_, 'staff', format('SELECT id FROM public.menu_sop_steps WHERE sop_id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V12 the chosen editor: its steps', on_, 'editor', format('SELECT id FROM public.menu_sop_steps WHERE sop_id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V13 staff reads the SOP open to all, as today', staff_, 'staff',
      format('SELECT s.id FROM public.menu_sops s JOIN public.menu_sop_steps t ON t.sop_id = s.id WHERE s.id = %L', v_sop2), ARRAY['rows=1']);
    PERFORM pg_temp.t('V14 not chosen: rewrites a step', off_, 'editor', format('UPDATE public.menu_sop_steps SET text = text WHERE id = %L', v_step1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V15 not chosen: adds a step', off_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'cook', 2, 'probe-vis')$q$, v_sop1), ARRAY['denied']);
    PERFORM pg_temp.t('V15a the chosen editor adds a step', on_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'cook', 2, 'probe-vis')$q$, v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V16 not chosen: rewrites the SOP', off_, 'editor', format('UPDATE public.menu_sops SET author_name = author_name WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V17 not chosen: deletes the SOP', off_, 'editor', format('DELETE FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V18 not chosen: saves an SOP for that menu the way the app does (upsert on the menu)', off_, 'editor',
      format($q$INSERT INTO public.menu_sops (menu_id, author_name) VALUES (%L, 'probe-vis') ON CONFLICT (menu_id) DO UPDATE SET author_name = EXCLUDED.author_name$q$, v_menu1),
      ARRAY['denied']);
    PERFORM pg_temp.t('V18a the chosen editor saves it the way the app does (upsert on the menu)', on_, 'editor',
      format($q$INSERT INTO public.menu_sops (menu_id, author_name) VALUES (%L, 'probe-vis') ON CONFLICT (menu_id) DO UPDATE SET author_name = EXCLUDED.author_name$q$, v_menu1),
      ARRAY['rows=1']);
    PERFORM pg_temp.t('V18b an editor saves a NEW SOP the way the app does (upsert, then read its id)', off_, 'editor',
      format($q$INSERT INTO public.menu_sops (menu_id, author_name) VALUES (%L, 'probe-vis') ON CONFLICT (menu_id) DO UPDATE SET author_name = EXCLUDED.author_name RETURNING id$q$, v_menu4),
      ARRAY['rows=1']);
    PERFORM pg_temp.t('V19 the chosen editor rewrites a step', on_, 'editor', format('UPDATE public.menu_sop_steps SET text = text WHERE id = %L', v_step1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V20 the chosen editor opens the SOP to all', on_, 'editor',
      format($q$UPDATE public.menu_sops SET visibility = 'all' WHERE id = %L$q$, v_sop1), ARRAY['refused']);
    PERFORM pg_temp.said('V20', 'เฉพาะเจ้าของร้านและผู้จัดการ');
    PERFORM pg_temp.t('V21 the chosen editor chooses another account', on_, 'editor',
      format('INSERT INTO public.menu_sop_viewers (sop_id, profile_id) VALUES (%L, %L)', v_sop1, staff_), ARRAY['denied']);
    PERFORM pg_temp.t('V22 an editor makes a new SOP (open to all)', off_, 'editor',
      format('INSERT INTO public.menu_sops (menu_id) VALUES (%L)', v_menu3), ARRAY['rows=1']);
    PERFORM pg_temp.t('V23 an editor makes a new SOP for chosen accounts', off_, 'editor',
      format($q$INSERT INTO public.menu_sops (menu_id, visibility) VALUES (%L, 'chosen')$q$, v_menu4), ARRAY['refused']);
    PERFORM pg_temp.said('V23', 'เฉพาะเจ้าของร้านและผู้จัดการ');
    PERFORM pg_temp.t('V24 admin saves the SOP for chosen accounts the way the app does', admin_, 'admin',
      format($q$INSERT INTO public.menu_sops (menu_id, author_name) VALUES (%L, 'probe-vis') ON CONFLICT (menu_id) DO UPDATE SET author_name = EXCLUDED.author_name$q$, v_menu1),
      ARRAY['rows=1']);
    PERFORM pg_temp.t('V24a the chosen editor moves a step into the SOP open to all', on_, 'editor',
      format('UPDATE public.menu_sop_steps SET sop_id = %L WHERE id = %L', v_sop2, v_step1), ARRAY['refused']);
    PERFORM pg_temp.said('V24a', 'ย้ายขั้นตอนหรือหมายเหตุ');
    PERFORM pg_temp.t('V24b the chosen editor moves a note into the SOP open to all', on_, 'editor',
      format('UPDATE public.menu_sop_ingredient_notes SET sop_id = %L WHERE sop_id = %L', v_sop2, v_sop1), ARRAY['refused']);
    PERFORM pg_temp.said('V24b', 'ย้ายขั้นตอนหรือหมายเหตุ');
    PERFORM pg_temp.t('V24c the chosen editor moves the SOP to another menu', on_, 'editor',
      format('UPDATE public.menu_sops SET menu_id = %L WHERE id = %L', v_menu4, v_sop1), ARRAY['refused']);
    PERFORM pg_temp.said('V24c', 'ย้าย SOP ไปเมนูอื่น');
    PERFORM pg_temp.t('V24d the chosen editor deletes the SOP (it would come back open to all)', on_, 'editor',
      format('DELETE FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V24e admin deletes it (the app''s delete)', admin_, 'admin',
      format('DELETE FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V24f an editor deletes an SOP open to all (as before)', off_, 'editor',
      format('DELETE FROM public.menu_sops WHERE id = %L', v_sop2), ARRAY['rows=1']);
    PERFORM pg_temp.t('R1 not chosen: files an SOP request for that menu', off_, 'editor',
      format($q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload) VALUES (%L, 'sop_upsert', %L, '{}'::jsonb)$q$, off_, v_menu1), ARRAY['denied']);
    PERFORM pg_temp.t('R2 the chosen editor files one', on_, 'editor',
      format($q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload) VALUES (%L, 'sop_upsert', %L, '{}'::jsonb)$q$, on_, v_menu1), ARRAY['rows=1']);
    PERFORM pg_temp.t('R3 an editor files one for a menu with no SOP', off_, 'editor',
      format($q$INSERT INTO public.pending_changes (editor_id, change_type, target_id, payload) VALUES (%L, 'sop_upsert', %L, '{}'::jsonb)$q$, off_, v_menu4), ARRAY['rows=1']);
    PERFORM pg_temp.t('R4 its author reads a request about an SOP no longer in their sight', off_, 'editor',
      format('SELECT id FROM public.pending_changes WHERE target_id = %L AND editor_id = %L', v_menu1, off_), ARRAY['rows=0']);
    PERFORM pg_temp.t('R5 admin reads that request (the approval queue)', admin_, 'admin',
      format('SELECT id FROM public.pending_changes WHERE target_id = %L AND editor_id = %L', v_menu1, off_), ARRAY['rows=1']);
    PERFORM pg_temp.t('V25 an editor sets who can see an SOP', on_, 'editor',
      format('SELECT public.sop_set_visibility(%L, %L, ARRAY[%L]::uuid[])', v_sop1, 'chosen', staff_), ARRAY['refused']);
    PERFORM pg_temp.said('V25', 'เฉพาะเจ้าของร้านและผู้จัดการ');
    PERFORM pg_temp.t('V26 admin chooses the owner: dropped, not stored (the owner sees every SOP anyway)', admin_, 'admin',
      format('SELECT public.sop_set_visibility(%L, %L, ARRAY[%L]::uuid[])', v_sop1, 'chosen', owner_), ARRAY['rows=1 check=0'],
      format('SELECT profile_id FROM public.menu_sop_viewers WHERE sop_id = %L AND profile_id = %L', v_sop1, owner_));
    PERFORM pg_temp.t('V26a admin chooses an account that does not exist', admin_, 'admin',
      format('SELECT public.sop_set_visibility(%L, %L, ARRAY[%L]::uuid[])', v_sop1, 'chosen', gen_random_uuid()), ARRAY['refused']);
    PERFORM pg_temp.said('V26a', 'บัญชีที่เลือกไม่ถูกต้อง');
    PERFORM pg_temp.t('V27 admin sets the SOP to เวช and staff', admin_, 'admin',
      format('SELECT public.sop_set_visibility(%L, %L, ARRAY[%L, %L]::uuid[])', v_sop1, 'chosen', on_, staff_), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('V28 staff, now chosen, reads it', staff_, 'staff', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V29 staff reads the chosen list: its own row only', staff_, 'staff', format('SELECT sop_id FROM public.menu_sop_viewers WHERE sop_id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V30 แหงน, still not chosen, reads it', off_, 'editor', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=0']);
    PERFORM pg_temp.t('V31 owner opens it to all: no chosen list is kept', owner_, 'owner',
      format('SELECT public.sop_set_visibility(%L, %L, ARRAY[%L]::uuid[])', v_sop1, 'all', staff_), ARRAY['rows=1 check=0'],
      format('SELECT sop_id FROM public.menu_sop_viewers WHERE sop_id = %L', v_sop1), true);
    PERFORM pg_temp.t('V32 แหงน reads it now', off_, 'editor', format('SELECT id FROM public.menu_sops WHERE id = %L', v_sop1), ARRAY['rows=1']);
    PERFORM pg_temp.t('V33 a visitor calls the visibility save', NULL, 'anon',
      format('SELECT public.sop_set_visibility(%L, %L, ARRAY[]::uuid[])', v_sop1, 'all'), ARRAY['no-execute']);

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
  v_src  text;
  -- Every row the file is supposed to emit, counted by the checker's rule
  -- (a t() or a note() is one row). Change a test, change this.
  c_expected constant bigint := 108;
BEGIN
  IF (SELECT count(*) FROM public.menu_sops)::text <> current_setting('vis.n_sops')
     OR (SELECT count(*) FROM public.menu_sop_steps)::text <> current_setting('vis.n_steps')
     OR (SELECT count(*) FROM public.menu_sop_ingredient_notes)::text <> current_setting('vis.n_notes')
     OR (SELECT count(*) FROM public.menus)::text <> current_setting('vis.n_menus')
     OR (SELECT count(*) FROM public.ingredients)::text <> current_setting('vis.n_ing')
     OR (SELECT count(*) FROM public.ingredient_price_history)::text <> current_setting('vis.n_hist')
     OR (SELECT count(*) FROM public.pos_receipt_deliveries)::text <> current_setting('vis.n_del')
     OR (SELECT count(*) FROM public.profiles)::text <> current_setting('vis.n_profiles')
     OR (SELECT count(*) FROM public.menu_sop_viewers)::text <> current_setting('vis.n_viewers')
     OR (SELECT count(*) FROM public.profile_cost_access)::text <> current_setting('vis.n_switch')
     OR (SELECT count(*) FROM public.pending_changes)::text <> current_setting('vis.n_pending')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.menu_sop_steps t) <> current_setting('vis.fp_steps')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.ingredients t) <> current_setting('vis.fp_ing')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.profiles t) <> current_setting('vis.fp_profiles') THEN
    RAISE EXCEPTION 'FAIL    K0 a count or a fingerprint changed: a test write or a probe row survived. Nothing applied.';
  END IF;
  -- The SOP rows: as before in every column they had (visibility is new).
  IF (SELECT md5(COALESCE(string_agg(row(t.id, t.menu_id, t.author_name, t.updated_at, t.demo_video_url, t.created_at)::text, '|' ORDER BY t.id), ''))
        FROM public.menu_sops t)
     <> current_setting('vis.fp_sops_cols') THEN
    RAISE EXCEPTION 'FAIL    K0 an SOP row changed. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K0 every count and fingerprint as before (SOPs in every column they had, steps, notes, menus, ingredients, price history, POS receipts, profiles, requests, chosen accounts, switches)');

  -- A. The SOP setting.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'menu_sops' AND c.column_name = 'visibility'
                    AND c.is_nullable = 'NO' AND c.column_default LIKE '''all''%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.menu_sops'::regclass AND c.conname = 'menu_sops_visibility_check')
     OR (SELECT count(*) FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.permissive = 'RESTRICTIVE'
            AND (p.tablename, p.policyname, p.cmd) IN (('menu_sops', 'sop_visible_select', 'SELECT'), ('menu_sops', 'sop_visible_update', 'UPDATE'),
                                                       ('menu_sops', 'sop_visible_delete', 'DELETE'), ('menu_sop_steps', 'sop_steps_visible', 'ALL'),
                                                       ('menu_sop_ingredient_notes', 'sop_notes_visible', 'ALL'))
            AND (p.qual LIKE '%can_see_sop%' OR p.qual LIKE '%sop_row_visible%')) <> 5
     OR NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = 'menu_sops_visibility_guard'
                      AND g.tgrelid = 'public.menu_sops'::regclass AND g.tgenabled <> 'D' AND NOT g.tgisinternal)
     OR (SELECT count(*) FROM pg_trigger g WHERE g.tgname IN ('menu_sop_steps_child_guard', 'menu_sop_notes_child_guard')
            AND g.tgenabled <> 'D' AND NOT g.tgisinternal) <> 2
     OR (SELECT count(*) FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = 'pending_changes' AND p.permissive = 'RESTRICTIVE'
            AND p.policyname IN ('pending_sop_fileable', 'pending_sop_visible')
            AND COALESCE(p.qual, p.with_check) LIKE '%sop_request_allowed%') <> 2 THEN
    RAISE EXCEPTION 'FAIL    K1 the SOP visibility column, its CHECK, the five restrictive policies or the trigger are not as written. Nothing applied.';
  END IF;
  SELECT string_agg(p.tablename || '."' || p.policyname || '"', ', ') INTO v_name
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename IN ('menu_sops', 'menu_sop_steps', 'menu_sop_ingredient_notes')
     AND p.permissive = 'PERMISSIVE' AND p.cmd <> 'SELECT'
     AND p.policyname NOT IN ('sop_write', 'sop_notes_write', 'sop_steps_write');
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    K1 another write policy is on the SOP tables: %. Nothing applied.', v_name;
  END IF;
  PERFORM pg_temp.note('ok      K1 the SOP tables: visibility NOT NULL DEFAULT ''all'' with its CHECK; the five restrictive policies ask the one rule (sop_row_visible on the SOP''s own row, can_see_sop for its steps and notes); the triggers guard who may set it and keep steps, notes and SOPs where they are; SOP requests follow the SOP (two restrictive policies on pending_changes); no write policy but owner/admin/editor''s three');

  IF current_setting('vis.first') = 'yes' THEN
    IF EXISTS (SELECT 1 FROM public.menu_sops s WHERE s.visibility <> 'all') OR EXISTS (SELECT 1 FROM public.menu_sop_viewers) THEN
      RAISE EXCEPTION 'FAIL    K2 after a first run an SOP is not open to all, or someone is chosen. Nothing applied.';
    END IF;
    PERFORM pg_temp.note(format('ok      K2 first run: all %s SOPs open to everyone (ทุกคน), as before; nobody chosen', current_setting('vis.n_sops')));
  ELSE
    PERFORM pg_temp.note(format('skip    K2 a re-run: %s SOP(s) for chosen accounts, left as set',
      (SELECT count(*) FROM public.menu_sops s WHERE s.visibility = 'chosen')));
  END IF;

  -- B. The switch.
  SELECT pg_get_viewdef('public.ingredient_costs'::regclass) INTO v_src;
  IF position('can_see_cost()' IN v_src) = 0 OR position('current_role' IN v_src) > 0 THEN
    RAISE EXCEPTION 'FAIL    K3 ingredient_costs does not ask can_see_cost(). Nothing applied.';
  END IF;
  IF (SELECT p.qual FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'ingredient_price_history' AND p.policyname = 'ingredient_price_history_select') NOT LIKE '%can_see_cost()%'
     OR (SELECT p.qual FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'pos_receipt_deliveries' AND p.policyname = 'pos_receipt_deliveries_select') NOT LIKE '%can_see_cost()%' THEN
    RAISE EXCEPTION 'FAIL    K3 the price-history or POS-receipt read policy does not ask can_see_cost(). Nothing applied.';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('public.prep_unit_costs()');
  IF position('public.can_see_cost()' IN v_src) = 0 OR position('current_role' IN v_src) > 0 THEN
    RAISE EXCEPTION 'FAIL    K3 prep_unit_costs does not ask can_see_cost(). Nothing applied.';
  END IF;
  SELECT string_agg(p.tablename || '."' || p.policyname || '"', ', ') INTO v_name
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE' AND p.cmd IN ('SELECT', 'ALL')
     AND ((p.tablename = 'ingredient_price_history' AND p.policyname <> 'ingredient_price_history_select')
       OR (p.tablename = 'pos_receipt_deliveries' AND p.policyname NOT IN ('pos_receipt_deliveries_select', 'pos_receipt_deliveries_write')));
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    K3 another read policy is on the price history or the POS receipts: %. Nothing applied.', v_name;
  END IF;
  PERFORM pg_temp.note('ok      K3 ingredient_costs, the price-history read, the POS-receipt read and prep_unit_costs() all ask can_see_cost(), and no other policy reads those two tables (the receipts'' write policy is owner/admin)');

  SELECT string_agg(p.full_name || ' (' || p.role || ')', ', ' ORDER BY p.full_name) INTO v_name
    FROM public.profile_cost_access a JOIN public.profiles p ON p.id = a.profile_id WHERE p.role <> 'editor';
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    K4 the switch is on for an account that is not an editor: %. Nothing applied.', v_name;
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.profile_cost_access'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.menu_sop_viewers'::regclass)
     OR (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'profile_cost_access') <> 3
     OR (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'menu_sop_viewers') <> 3
     OR has_table_privilege('anon', 'public.profile_cost_access', 'SELECT') OR has_table_privilege('anon', 'public.profile_cost_access', 'INSERT')
     OR has_table_privilege('anon', 'public.menu_sop_viewers', 'SELECT') OR has_table_privilege('anon', 'public.menu_sop_viewers', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profile_cost_access', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.menu_sop_viewers', 'UPDATE')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['public.ingredient_costs', 'public.employee_pay', 'public.catering_staff_options']) AS v,
                     unnest(ARRAY['anon', 'authenticated']) AS r, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS priv
                 WHERE has_table_privilege(r, v, priv))
     OR NOT has_table_privilege('authenticated', 'public.catering_staff_options', 'SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'pending_changes'
                      AND p.policyname = 'pending_cost_fields_hidden' AND p.permissive = 'RESTRICTIVE' AND p.qual LIKE '%can_see_cost()%')
     OR has_function_privilege('anon', 'public.can_see_cost()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.can_see_sop(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sop_row_visible(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sop_set_visibility(uuid, text, uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.sop_set_visibility(uuid, text, uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.can_see_cost()', 'EXECUTE')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgname = 'profile_cost_access_clear'
                      AND g.tgrelid = 'public.profiles'::regclass AND g.tgenabled <> 'D' AND NOT g.tgisinternal) THEN
    RAISE EXCEPTION 'FAIL    K4 the two new tables or the three new functions are not as written (row security, policies, privileges). Nothing applied.';
  END IF;
  IF current_setting('vis.first') = 'yes' THEN
    SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name) INTO v_name
      FROM public.profile_cost_access a JOIN public.profiles p ON p.id = a.profile_id;
    IF v_name IS DISTINCT FROM 'ธีรวัฒน์, เวช' THEN
      RAISE EXCEPTION 'FAIL    K4 after a first run the switch is on for "%", expected ธีรวัฒน์ and เวช. Nothing applied.', COALESCE(v_name, 'nobody');
    END IF;
  END IF;
  PERFORM pg_temp.note(format('ok      K4 the switch is on for: %s (editors only); both new tables have row security, three policies each, nothing for anon, no UPDATE for anyone; anon may not call the three new functions; any role change clears the switch (trigger); the three views are read-only (select only); a request that carries prices is read by those who see cost',
    COALESCE((SELECT string_agg(p.full_name, ', ' ORDER BY p.full_name) FROM public.profile_cost_access a JOIN public.profiles p ON p.id = a.profile_id), 'nobody')));

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
-- 1. Push the branch sop-visibility-cost-switch (the team page's switch,
--    the SOP setting and its lock, the cost screens for a switched-off
--    editor). Until it is live, approve no ingredient edit from แหงน or
--    Editor (see the header).
-- 2. Then, in the app: as the owner, the team page shows เห็นต้นทุน on for
--    ธีรวัฒน์ and เวช; as เวช, the ingredients page shows prices; as แหงน, it
--    shows names and units and no price, and a recipe shows no cost.
