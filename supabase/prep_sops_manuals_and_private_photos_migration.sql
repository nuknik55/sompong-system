-- ═══════════════════════════════════════════════════════════════════════════
-- prep_sops_manuals_and_private_photos_migration.sql
--
-- NOT APPLIED. Nik's decisions of 2026-09-26 (queue items 57, 58, 59). One
-- transaction: it applies entirely, or nothing.
--
-- EXPECTED RESULT: 111 rows, every line starting "ok", "survey",
-- "note" or "skip", the last one:
--   row count verified: 110 evidence rows emitted, as expected (this line makes 111)
-- Anything that starts "FAIL" stops the file and NOTHING is applied.
--
-- WHAT IT DOES (each is tested below as the real accounts, rolled back):
--  A. PREP SOPs (item 57). An SOP row is now one of three kinds: 'menu'
--     (every SOP today), 'prep' (tied to a prep recipe) or 'manual'. A prep
--     SOP is read by owner, admin and editors who can see THAT PREP
--     (can_see_prep: the owner by role, everyone else by grant, admins
--     included: the secret-prep rule wins) and never by staff, then
--     narrowed by its own "who can see". It is written by owner, admin and
--     editors who can see the prep.
--  B. คู่มือ, MANUALS (item 58). A manual has a title, a category and steps
--     with photos, and is read by its own "who can see" (ทุกคน, or chosen
--     accounts; owner and admin always). Categories (manual_categories,
--     starting ครัว, บริการ, จัดเลี้ยง, ทั่วไป) are kept by owner and admin.
--     Writers: owner and admin in every category; editors where the
--     category says so (ครัว to begin with); and the accounts owner or admin
--     choose per category (manual_category_writers), whatever their role,
--     so the service head writes บริการ manuals on a staff login. A writer
--     may also upload SOP photos (sop_photo_upload_allowed replaced,
--     md5-guarded).
--     THE RULE, ONE PLACE: sop_doc_readable() and sop_doc_writable() on an
--     SOP row's own values, can_see_sop() / can_write_sop() by id for its
--     steps and notes (can_see_sop replaced, md5-guarded). Prep SOPs and
--     manuals save through sop_doc_save(), whole, in one transaction, under
--     the caller's own policies. Only owner and admin set who sees any SOP
--     (the guard trigger, replaced md5-guarded, also keeps a doc's kind and
--     prep where they are).
--  C. THE PRIVATE BUCKET for SOP photos (item 59), prepared: bucket
--     sop-photos-private (not public, JPEG, 2 MB). A photo lives at
--     <document id>/<name>.jpg and is read by whoever can read that document;
--     one uploaded before its document exists, or for an editor's request,
--     lives at staging/<the uploader's id>/<name>.jpg and is read by its
--     uploader and by owner and admin (who approve requests). Nobody updates
--     or deletes a file in it through the API. NO FILE IS MOVED OR COPIED
--     by this file; sop-photos stays as it is (maintenance photos live there
--     too).
--  D. FROM THE ADVERSARIAL REVIEW (2026-09-26):
--     - The chosen lists (menu_sop_viewers) follow the SOP: owner and admin
--       read and change the list of an SOP they can see, so an admin
--       without a secret prep's grant can neither learn its SOP's id nor
--       pick its readers; a prep SOP's list takes editors only.
--     - An SOP's id is the database's: a signed-in session's new SOP gets a
--       fresh id, and no session changes one (a private photo is read by its
--       SOP's id, and files are never deleted, so a deleted SOP's id taken
--       again would have handed its photos to the new SOP's readers).
--     - Addresses have a shape (CHECK): a step photo is this project's
--       sop-photos address or a private reference; a video an https
--       address of 500 letters at most; an author name 200 at most. Every
--       row fits today (S3 checks it first).
--     - sop_row_visible, unused and blind to prep SOPs, is dropped.
--
-- STATEMENTS THE EDITOR MAY CALL DESTRUCTIVE — the complete list; anything
-- else is unexpected:
--   ALTER TABLE public.menu_sops ALTER COLUMN menu_id DROP NOT NULL (a prep
--     SOP or a manual has no menu; the CHECK below requires one for 'menu')
--   ALTER TABLE public.menu_sop_steps DROP CONSTRAINT menu_sop_steps_section_check,
--     re-added at once with one more section, 'step' (a manual's steps)
--   CREATE OR REPLACE FUNCTION public.can_see_sop, public.menu_sops_visibility_guard,
--     public.sop_photo_upload_allowed (each md5-checked against its applied body)
--   DROP POLICY IF EXISTS + CREATE POLICY: sop_visible_select, sop_visible_update,
--     sop_visible_delete (re-made on the new rule), menu_sop_viewers_select,
--     _insert, _delete (re-made to follow the SOP) and this file's own
--   DROP FUNCTION public.sop_row_visible(uuid, text) (no CASCADE; after
--     checking that no policy or function names it)
--   ALTER TABLE ... ADD CONSTRAINT: menu_sop_steps_photo_url_check,
--     menu_sops_demo_video_url_check, menu_sops_author_name_check (every row
--     fits; S3 stops the file first if one does not)
--   INSERT INTO storage.buckets (the new private bucket; ON CONFLICT: its
--     limits restated, public set false)
-- It deletes no row outside the tests, which write inside a block that
-- always rolls back, on rows they make there.
--
-- DEPLOY ORDER: this file FIRST, then the branch private-sop-photos, which
-- holds prep-sops-manuals (the prep SOP pages, the manuals, the sidebar
-- entry) and the signed links, with NEXT_PUBLIC_SOP_PHOTOS_PRIVATE=1 set in
-- Vercel: prep SOPs and manuals take photos only into the private bucket.
-- The code live now keeps working after this runs: every menu SOP stays
-- kind 'menu' with its menu. Moving the existing photos comes after, with
-- Nik (scripts/move-sop-photos.mjs, its dry run first).
--
-- RUN IT AT A QUIET TIME: it locks the SOP tables while it runs, and an app
-- write meanwhile stops it at K0 ("Nothing applied"): run it again.
--
-- Never "Run and enable RLS": every table this touches has RLS, and the two
-- it creates switch it on themselves.
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
  FOREACH v_t IN ARRAY ARRAY['public.profiles', 'public.menus', 'public.menu_sops', 'public.menu_sop_steps',
      'public.menu_sop_ingredient_notes', 'public.menu_sop_viewers', 'public.prep_recipes', 'public.prep_recipe_access',
      'public.ingredients', 'storage.buckets', 'storage.objects'] LOOP
    IF to_regclass(v_t) IS NULL THEN
      RAISE EXCEPTION 'FAIL    S0 % does not exist. Nothing applied.', v_t;
    END IF;
  END LOOP;
  FOREACH v_t IN ARRAY ARRAY['public.profiles', 'public.menu_sops', 'public.menu_sop_steps', 'public.menu_sop_ingredient_notes',
      'public.menu_sop_viewers', 'public.prep_recipes', 'public.prep_recipe_access', 'storage.objects'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass(v_t)) THEN
      RAISE EXCEPTION 'FAIL    S0 % has row security OFF. Nothing applied.', v_t;
    END IF;
  END LOOP;
  -- This file builds on sop_visibility_and_editor_cost_switch_migration.sql
  -- (applied 2026-09-26): its column, rule and policies are there by name.
  -- sop_row_visible is dropped by this file (D1), so a re-run finds it gone.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'menu_sops' AND c.column_name = 'visibility')
     OR to_regprocedure('public.can_see_prep(uuid)') IS NULL
     OR (to_regprocedure('public.sop_row_visible(uuid, text)') IS NULL
         AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                          WHERE c.table_schema = 'public' AND c.table_name = 'menu_sops' AND c.column_name = 'kind'))
     OR to_regprocedure('public.sop_set_visibility(uuid, text, uuid[])') IS NULL THEN
    RAISE EXCEPTION 'FAIL    S0 sop_visibility_and_editor_cost_switch_migration.sql is not in place (menu_sops.visibility, can_see_prep, sop_row_visible or sop_set_visibility missing). Nothing applied.';
  END IF;
  SELECT string_agg(x.t || '.' || x.p, ', ') INTO v_name
    FROM (VALUES ('menu_sops', 'sop_visible_select'), ('menu_sops', 'sop_visible_update'), ('menu_sops', 'sop_visible_delete'),
                 ('menu_sops', 'sop_write'), ('menu_sop_steps', 'sop_steps_write'), ('menu_sop_steps', 'sop_steps_visible'),
                 ('menu_sop_ingredient_notes', 'sop_notes_write'), ('menu_sop_ingredient_notes', 'sop_notes_visible'),
                 ('menu_sop_viewers', 'menu_sop_viewers_select'), ('menu_sop_viewers', 'menu_sop_viewers_insert'),
                 ('menu_sop_viewers', 'menu_sop_viewers_delete')) AS x(t, p)
   WHERE NOT EXISTS (SELECT 1 FROM pg_policies q WHERE q.schemaname = 'public' AND q.tablename = x.t AND q.policyname = x.p);
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    S0 missing policies: %. Nothing applied.', v_name;
  END IF;
  -- The steps' section CHECK, by the name this file re-makes.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid = 'public.menu_sop_steps'::regclass AND c.conname = 'menu_sop_steps_section_check'
                    AND pg_get_constraintdef(c.oid) LIKE '%checklist%') THEN
    RAISE EXCEPTION 'FAIL    S0 menu_sop_steps has no CHECK named menu_sop_steps_section_check on its sections. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      S0 the tables this file reads or changes exist with row security on; the SOP visibility file of 2026-09-26 is in place; the policies it changes are there by name; the steps'' section CHECK is where it expects it');

  -- The three functions replaced: the bodies their files applied, or this file's own (a re-run).
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.can_see_sop(uuid)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('e8c694018229c7fc756bab627d378413', '1d7f96f4ead20f60021ef168448d8a3b') THEN
    RAISE EXCEPTION 'FAIL    S1 can_see_sop is not the body sop_visibility_and_editor_cost_switch_migration.sql applied (md5 %): read it live before replacing it (AGENTS.md, rule 4). Nothing applied.', COALESCE(v_md5, 'missing');
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.menu_sops_visibility_guard()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('3640bff3632620386cf7fd4fbccb41d9', '4d8553f43727b03f9673f69fffaeba3e') THEN
    RAISE EXCEPTION 'FAIL    S1 menu_sops_visibility_guard is not the body sop_visibility_and_editor_cost_switch_migration.sql applied (md5 %). Nothing applied.', COALESCE(v_md5, 'missing');
  END IF;
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.sop_photo_upload_allowed(text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('fe12389732360660f3f9ee3e8ac3fd7d', '2d83427c322df7009ce37b36d8a7e1f3') THEN
    RAISE EXCEPTION 'FAIL    S1 sop_photo_upload_allowed is not the body permissions_batch_2026_09_17.sql applied (md5 %). Nothing applied.', COALESCE(v_md5, 'missing');
  END IF;
  PERFORM pg_temp.note('ok      S1 can_see_sop, menu_sops_visibility_guard and sop_photo_upload_allowed are the bodies their files applied (md5), or this file''s own');

  -- The address rules this file adds (Step 2, review 2026-09-26) hold for
  -- every row today (read live 2026-09-26: 292 step photos, all this
  -- project's sop-photos; no video; the longest author 7 letters).
  IF EXISTS (SELECT 1 FROM public.menu_sop_steps t
              WHERE t.photo_url IS NOT NULL
                AND t.photo_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/storage/v1/object/public/sop-photos/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$' AND t.photo_url !~ '^storage:sop-photos-private/(staging/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+-[0-9a-z]+[.]jpg$')
     OR EXISTS (SELECT 1 FROM public.menu_sops s
                 WHERE (s.demo_video_url IS NOT NULL AND (s.demo_video_url !~ '^https://[^[:space:]]+$' OR char_length(s.demo_video_url) > 500))
                    OR char_length(COALESCE(s.author_name, '')) > 200) THEN
    RAISE EXCEPTION 'FAIL    S3 % step photos, % videos and % author names do not fit the address and length rules this file adds. Nothing applied.',
      (SELECT count(*) FROM public.menu_sop_steps t WHERE t.photo_url IS NOT NULL
          AND t.photo_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/storage/v1/object/public/sop-photos/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$' AND t.photo_url !~ '^storage:sop-photos-private/(staging/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+-[0-9a-z]+[.]jpg$'),
      (SELECT count(*) FROM public.menu_sops s WHERE s.demo_video_url IS NOT NULL
          AND (s.demo_video_url !~ '^https://[^[:space:]]+$' OR char_length(s.demo_video_url) > 500)),
      (SELECT count(*) FROM public.menu_sops s WHERE char_length(COALESCE(s.author_name, '')) > 200);
  END IF;
  PERFORM pg_temp.note(format('ok      S3 every step photo (%s) is this project''s sop-photos address or a private reference; every video (%s) an https address of 500 letters at most; every author name 200 at most',
    (SELECT count(*) FROM public.menu_sop_steps t WHERE t.photo_url IS NOT NULL),
    (SELECT count(*) FROM public.menu_sops s WHERE s.demo_video_url IS NOT NULL)));

  PERFORM set_config('pm.first', CASE WHEN to_regclass('public.manual_categories') IS NULL THEN 'yes' ELSE 'no' END, false);

  FOREACH v_role IN ARRAY ARRAY['owner', 'admin', 'staff', 'hr', 'sales'] LOOP
    SELECT p.id INTO v_id FROM public.profiles p WHERE p.role = v_role ORDER BY p.id LIMIT 1;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'FAIL    S2 no % account to test as. Nothing applied.', v_role;
    END IF;
    PERFORM set_config('pm.' || v_role, v_id::text, false);
  END LOOP;
  SELECT string_agg(x.n, ', ') INTO v_name
    FROM (VALUES ('ef2075c7-9fbc-4c66-8dd1-6528bb810786'::uuid, 'เวช'), ('af72b2ce-b812-403f-97cf-83875b5e477c'::uuid, 'แหงน')) AS x(id, n)
   WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = x.id AND p.full_name = x.n AND p.role = 'editor');
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    S2 not found as an editor with that id and name: %. Nothing applied.', v_name;
  END IF;
  PERFORM set_config('pm.ed_a', 'ef2075c7-9fbc-4c66-8dd1-6528bb810786', false);   -- เวช: granted the probe prep
  PERFORM set_config('pm.ed_b', 'af72b2ce-b812-403f-97cf-83875b5e477c', false);   -- แหงน: not granted

  PERFORM set_config('pm.n_sops',    (SELECT count(*) FROM public.menu_sops)::text, false);
  PERFORM set_config('pm.n_steps',   (SELECT count(*) FROM public.menu_sop_steps)::text, false);
  PERFORM set_config('pm.n_notes',   (SELECT count(*) FROM public.menu_sop_ingredient_notes)::text, false);
  PERFORM set_config('pm.n_viewers', (SELECT count(*) FROM public.menu_sop_viewers)::text, false);
  PERFORM set_config('pm.n_preps',   (SELECT count(*) FROM public.prep_recipes)::text, false);
  PERFORM set_config('pm.n_grants',  (SELECT count(*) FROM public.prep_recipe_access)::text, false);
  PERFORM set_config('pm.n_objects', (SELECT count(*) FROM storage.objects)::text, false);
  PERFORM set_config('pm.n_profiles',(SELECT count(*) FROM public.profiles)::text, false);
  PERFORM set_config('pm.fp_sops',   (SELECT md5(COALESCE(string_agg(row(t.id, t.menu_id, t.author_name, t.updated_at, t.demo_video_url, t.visibility)::text, '|' ORDER BY t.id), '')) FROM public.menu_sops t), false);
  PERFORM set_config('pm.fp_steps',  (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.menu_sop_steps t), false);
  PERFORM pg_temp.note('ok      S2 test accounts found for owner, admin, staff, hr and sales; เวช and แหงน found as editors by id and name; counts and fingerprints recorded (the tests make their own rows)');

  PERFORM pg_temp.note(pg_temp.survey('menu_sops'));
  PERFORM pg_temp.note(pg_temp.survey('menu_sop_steps'));
  PERFORM pg_temp.note(pg_temp.survey('menu_sop_ingredient_notes'));
  PERFORM pg_temp.note(pg_temp.survey('menu_sop_viewers'));
  -- Newer storage versions keep folder names in storage.prefixes: read here
  -- whether it exists and who may read it (a document's id is its folder).
  PERFORM pg_temp.note(format('survey  storage.prefixes: %s',
    CASE WHEN to_regclass('storage.prefixes') IS NULL THEN 'not there'
         ELSE format('there; row security %s; policies: %s',
                (SELECT CASE WHEN c.relrowsecurity THEN 'on' ELSE 'OFF' END FROM pg_class c WHERE c.oid = to_regclass('storage.prefixes')),
                COALESCE((SELECT string_agg(format('"%s" %s %s TO %s USING (%s)', p.policyname, p.permissive, p.cmd,
                                   array_to_string(p.roles, ','), COALESCE(p.qual, '-')), '; ' ORDER BY p.policyname)
                            FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'prefixes'), 'none'))
    END));
  PERFORM pg_temp.note(format('survey  storage before: buckets %s; policies on storage.objects naming sop-photos-private: %s; files in sop-photos %s',
    (SELECT string_agg(b.id || CASE WHEN b.public THEN ' (public)' ELSE ' (private)' END, ', ' ORDER BY b.id) FROM storage.buckets b),
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
        AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE '%sop-photos-private%'),
    (SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'sop-photos')));
  PERFORM pg_temp.note(format('survey  before: SOPs %s (steps %s, notes %s), chosen-list rows %s, preps %s, prep grants %s; first run: %s',
    current_setting('pm.n_sops'), current_setting('pm.n_steps'), current_setting('pm.n_notes'), current_setting('pm.n_viewers'),
    current_setting('pm.n_preps'), current_setting('pm.n_grants'), current_setting('pm.first')));
END
$do$;

-- ── Step 1: manual categories and their writers ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.manual_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  editors_write boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_categories_name_key UNIQUE (name),
  CONSTRAINT manual_categories_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);
COMMENT ON TABLE public.manual_categories IS
  'คู่มือ categories (Nik, 2026-09-26), kept by owner and admin. editors_write: every editor writes this category''s manuals (ครัว to begin with).';
ALTER TABLE public.manual_categories ENABLE ROW LEVEL SECURITY;
-- authenticated too: Supabase's default privileges grant it ALL on a new table.
REVOKE ALL ON public.manual_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_categories TO authenticated;
GRANT ALL ON public.manual_categories TO service_role;
DROP POLICY IF EXISTS manual_categories_select ON public.manual_categories;
CREATE POLICY manual_categories_select ON public.manual_categories FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);
DROP POLICY IF EXISTS manual_categories_write ON public.manual_categories;
CREATE POLICY manual_categories_write ON public.manual_categories FOR ALL TO authenticated
  USING (public.current_role() IN ('owner', 'admin'))
  WITH CHECK (public.current_role() IN ('owner', 'admin'));

CREATE TABLE IF NOT EXISTS public.manual_category_writers (
  category_id uuid NOT NULL REFERENCES public.manual_categories(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_by  uuid DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category_id, profile_id)
);
COMMENT ON TABLE public.manual_category_writers IS
  'The accounts owner or admin chose to write one category''s manuals, whatever their role (the service head writes บริการ on a staff login).';
ALTER TABLE public.manual_category_writers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_category_writers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.manual_category_writers TO authenticated;
GRANT ALL ON public.manual_category_writers TO service_role;
DROP POLICY IF EXISTS manual_category_writers_select ON public.manual_category_writers;
CREATE POLICY manual_category_writers_select ON public.manual_category_writers FOR SELECT TO authenticated
  USING (public.current_role() IN ('owner', 'admin') OR profile_id = auth.uid());
DROP POLICY IF EXISTS manual_category_writers_insert ON public.manual_category_writers;
CREATE POLICY manual_category_writers_insert ON public.manual_category_writers FOR INSERT TO authenticated
  WITH CHECK (public.current_role() IN ('owner', 'admin') AND granted_by IS NOT DISTINCT FROM auth.uid());
DROP POLICY IF EXISTS manual_category_writers_delete ON public.manual_category_writers;
CREATE POLICY manual_category_writers_delete ON public.manual_category_writers FOR DELETE TO authenticated
  USING (public.current_role() IN ('owner', 'admin'));

DO $do$
DECLARE
  v_n bigint;
BEGIN
  IF current_setting('pm.first') = 'yes' THEN
    INSERT INTO public.manual_categories (name, sort_order, editors_write)
    VALUES ('ครัว', 1, true), ('บริการ', 2, false), ('จัดเลี้ยง', 3, false), ('ทั่วไป', 4, false)
    ON CONFLICT (name) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 4 THEN
      RAISE EXCEPTION 'FAIL    G1 % categories made, expected 4. Nothing applied.', v_n;
    END IF;
    PERFORM pg_temp.note('ok      G1 first run: the four categories made (ครัว written by every editor; บริการ, จัดเลี้ยง, ทั่วไป by owner, admin and chosen writers)');
  ELSE
    PERFORM pg_temp.note(format('skip    G1 a re-run: the categories are left as they are (%s)',
      (SELECT string_agg(c.name, ', ' ORDER BY c.sort_order, c.name) FROM public.manual_categories c)));
  END IF;
END
$do$;

-- ── Step 2: an SOP row is a menu SOP, a prep SOP or a manual ────────────────

ALTER TABLE public.menu_sops ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'menu';
ALTER TABLE public.menu_sops ADD COLUMN IF NOT EXISTS prep_recipe_id uuid REFERENCES public.prep_recipes(id) ON DELETE CASCADE;
ALTER TABLE public.menu_sops ADD COLUMN IF NOT EXISTS manual_category_id uuid REFERENCES public.manual_categories(id) ON DELETE RESTRICT;
ALTER TABLE public.menu_sops ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.menu_sops ALTER COLUMN menu_id DROP NOT NULL;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.menu_sops'::regclass AND c.conname = 'menu_sops_kind_check') THEN
    ALTER TABLE public.menu_sops ADD CONSTRAINT menu_sops_kind_check CHECK (
      (kind = 'menu' AND menu_id IS NOT NULL AND prep_recipe_id IS NULL AND manual_category_id IS NULL)
      OR (kind = 'prep' AND prep_recipe_id IS NOT NULL AND menu_id IS NULL AND manual_category_id IS NULL)
      OR (kind = 'manual' AND manual_category_id IS NOT NULL AND menu_id IS NULL AND prep_recipe_id IS NULL
          AND title IS NOT NULL AND char_length(btrim(title)) BETWEEN 1 AND 200));
  END IF;
END
$do$;
CREATE UNIQUE INDEX IF NOT EXISTS menu_sops_prep_recipe_id_key ON public.menu_sops (prep_recipe_id);
CREATE INDEX IF NOT EXISTS menu_sops_manual_category_id_idx ON public.menu_sops (manual_category_id);
COMMENT ON COLUMN public.menu_sops.kind IS
  '''menu'': a dish''s SOP (menu_id). ''prep'': a prep recipe''s SOP (prep_recipe_id), read by those who can see the prep, never staff. ''manual'': a คู่มือ (manual_category_id, title). Queue items 57, 58.';

-- A manual's steps are one section, 'step'.
ALTER TABLE public.menu_sop_steps DROP CONSTRAINT IF EXISTS menu_sop_steps_section_check;
ALTER TABLE public.menu_sop_steps ADD CONSTRAINT menu_sop_steps_section_check
  CHECK (section IN ('prep', 'cook', 'plating', 'checklist', 'step'));

-- What an SOP's addresses may be (review, 2026-09-26): a manual's writer may
-- be a shared staff login, and every profile reads its manuals. A step
-- photo is this project's sop-photos address or a private reference; a
-- video an https address. Every row fits today (S3).
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.menu_sop_steps'::regclass AND c.conname = 'menu_sop_steps_photo_url_check') THEN
    ALTER TABLE public.menu_sop_steps ADD CONSTRAINT menu_sop_steps_photo_url_check CHECK (
      photo_url IS NULL OR photo_url ~ '^https://[a-z0-9-]+[.]supabase[.]co/storage/v1/object/public/sop-photos/[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$' OR photo_url ~ '^storage:sop-photos-private/(staging/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+-[0-9a-z]+[.]jpg$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.menu_sops'::regclass AND c.conname = 'menu_sops_demo_video_url_check') THEN
    ALTER TABLE public.menu_sops ADD CONSTRAINT menu_sops_demo_video_url_check CHECK (
      demo_video_url IS NULL OR (demo_video_url ~ '^https://[^[:space:]]+$' AND char_length(demo_video_url) <= 500));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.menu_sops'::regclass AND c.conname = 'menu_sops_author_name_check') THEN
    ALTER TABLE public.menu_sops ADD CONSTRAINT menu_sops_author_name_check CHECK (char_length(COALESCE(author_name, '')) <= 200);
  END IF;
END
$do$;

-- ── Step 3: the rule, in one place ──────────────────────────────────────────

-- May the caller write manuals in this category?
CREATE OR REPLACE FUNCTION public.manual_category_writable(p_cat uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN public.current_role() IS NULL OR p_cat IS NULL THEN false
    WHEN public.current_role() IN ('owner', 'admin') THEN EXISTS (SELECT 1 FROM public.manual_categories c WHERE c.id = p_cat)
    ELSE EXISTS (SELECT 1 FROM public.manual_categories c WHERE c.id = p_cat AND c.editors_write AND public.current_role() = 'editor')
      OR EXISTS (SELECT 1 FROM public.manual_category_writers w WHERE w.category_id = p_cat AND w.profile_id = auth.uid())
  END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.manual_category_writable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manual_category_writable(uuid) TO authenticated, service_role;

-- Does the caller write any manual at all (the upload rules ask it)?
CREATE OR REPLACE FUNCTION public.writes_some_manual()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    public.current_role() IN ('owner', 'admin')
    OR (public.current_role() = 'editor' AND EXISTS (SELECT 1 FROM public.manual_categories c WHERE c.editors_write))
    OR EXISTS (SELECT 1 FROM public.manual_category_writers w WHERE w.profile_id = auth.uid()), false);
$fn$;
REVOKE EXECUTE ON FUNCTION public.writes_some_manual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.writes_some_manual() TO authenticated, service_role;

-- May the caller read this SOP row? On the row's own values, so a row being
-- inserted is judged by what it says.
CREATE OR REPLACE FUNCTION public.sop_doc_readable(p_id uuid, p_visibility text, p_kind text, p_prep uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN public.current_role() IS NULL THEN false
    -- A prep SOP: owner, admin and editors who can see THE PREP (admins
    -- included only by grant), never staff; then its own "who can see".
    WHEN p_kind = 'prep' THEN
      public.current_role() IN ('owner', 'admin', 'editor')
      AND public.can_see_prep(p_prep)
      AND (public.current_role() IN ('owner', 'admin')
           OR p_visibility = 'all'
           OR EXISTS (SELECT 1 FROM public.menu_sop_viewers v WHERE v.sop_id = p_id AND v.profile_id = auth.uid()))
    -- A menu SOP or a manual: owner and admin always; anyone else with a
    -- profile when it is open to all, or when they are chosen.
    WHEN public.current_role() IN ('owner', 'admin') THEN true
    WHEN p_visibility = 'all' THEN true
    ELSE EXISTS (SELECT 1 FROM public.menu_sop_viewers v WHERE v.sop_id = p_id AND v.profile_id = auth.uid())
  END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_doc_readable(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_doc_readable(uuid, text, text, uuid) TO authenticated, service_role;

-- May the caller write this SOP row? Only one they can read, and then: a
-- menu or prep SOP owner, admin, editor; a manual its category's writers.
CREATE OR REPLACE FUNCTION public.sop_doc_writable(p_id uuid, p_visibility text, p_kind text, p_prep uuid, p_cat uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.sop_doc_readable(p_id, p_visibility, p_kind, p_prep)
     AND CASE WHEN p_kind = 'manual' THEN public.manual_category_writable(p_cat)
              ELSE public.current_role() IN ('owner', 'admin', 'editor') END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_doc_writable(uuid, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_doc_writable(uuid, text, text, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_see_sop(p_sop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- The rule by an SOP's id (queue items 57-59): its steps, its notes and
  -- its private photos ask it of their SOP, whatever the SOP's kind.
  SELECT COALESCE((SELECT public.sop_doc_readable(s.id, s.visibility, s.kind, s.prep_recipe_id)
                     FROM public.menu_sops s WHERE s.id = p_sop), false);
$fn$;

CREATE OR REPLACE FUNCTION public.can_write_sop(p_sop uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  -- The same rule by an SOP's id: its steps and notes ask it of their SOP.
  SELECT COALESCE((SELECT public.sop_doc_writable(s.id, s.visibility, s.kind, s.prep_recipe_id, s.manual_category_id)
                     FROM public.menu_sops s WHERE s.id = p_sop), false);
$fn$;
REVOKE EXECUTE ON FUNCTION public.can_write_sop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_write_sop(uuid) TO authenticated, service_role;

-- ── Step 4: the policies ────────────────────────────────────────────────────

-- menu_sops: RESTRICTIVE read, insert, update and delete by the rule; a
-- permissive write for manual writers who are not owner, admin or editor.
DROP POLICY IF EXISTS sop_visible_select ON public.menu_sops;
CREATE POLICY sop_visible_select ON public.menu_sops AS RESTRICTIVE FOR SELECT TO public
  USING (public.sop_doc_readable(id, visibility, kind, prep_recipe_id));
DROP POLICY IF EXISTS sop_visible_update ON public.menu_sops;
CREATE POLICY sop_visible_update ON public.menu_sops AS RESTRICTIVE FOR UPDATE TO public
  USING (public.sop_doc_writable(id, visibility, kind, prep_recipe_id, manual_category_id))
  WITH CHECK (public.sop_doc_writable(id, visibility, kind, prep_recipe_id, manual_category_id));
DROP POLICY IF EXISTS sop_visible_delete ON public.menu_sops;
CREATE POLICY sop_visible_delete ON public.menu_sops AS RESTRICTIVE FOR DELETE TO public
  USING (public.sop_doc_writable(id, visibility, kind, prep_recipe_id, manual_category_id)
         AND (public.current_role() IN ('owner', 'admin') OR visibility = 'all'));
DROP POLICY IF EXISTS sop_visible_insert ON public.menu_sops;
CREATE POLICY sop_visible_insert ON public.menu_sops AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.sop_doc_writable(id, visibility, kind, prep_recipe_id, manual_category_id));
DROP POLICY IF EXISTS sop_manual_writers ON public.menu_sops;
CREATE POLICY sop_manual_writers ON public.menu_sops FOR ALL TO authenticated
  USING (kind = 'manual' AND public.manual_category_writable(manual_category_id))
  WITH CHECK (kind = 'manual' AND public.manual_category_writable(manual_category_id));

-- Steps and notes: every write by the rule too (reads stay can_see_sop).
DROP POLICY IF EXISTS sop_steps_manual_writers ON public.menu_sop_steps;
CREATE POLICY sop_steps_manual_writers ON public.menu_sop_steps FOR ALL TO authenticated
  USING (public.can_write_sop(sop_id)) WITH CHECK (public.can_write_sop(sop_id));
DROP POLICY IF EXISTS sop_steps_writable_insert ON public.menu_sop_steps;
CREATE POLICY sop_steps_writable_insert ON public.menu_sop_steps AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.can_write_sop(sop_id));
DROP POLICY IF EXISTS sop_steps_writable_update ON public.menu_sop_steps;
CREATE POLICY sop_steps_writable_update ON public.menu_sop_steps AS RESTRICTIVE FOR UPDATE TO public
  USING (public.can_write_sop(sop_id)) WITH CHECK (public.can_write_sop(sop_id));
DROP POLICY IF EXISTS sop_steps_writable_delete ON public.menu_sop_steps;
CREATE POLICY sop_steps_writable_delete ON public.menu_sop_steps AS RESTRICTIVE FOR DELETE TO public
  USING (public.can_write_sop(sop_id));
DROP POLICY IF EXISTS sop_notes_writable_insert ON public.menu_sop_ingredient_notes;
CREATE POLICY sop_notes_writable_insert ON public.menu_sop_ingredient_notes AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (public.can_write_sop(sop_id));
DROP POLICY IF EXISTS sop_notes_writable_update ON public.menu_sop_ingredient_notes;
CREATE POLICY sop_notes_writable_update ON public.menu_sop_ingredient_notes AS RESTRICTIVE FOR UPDATE TO public
  USING (public.can_write_sop(sop_id)) WITH CHECK (public.can_write_sop(sop_id));
DROP POLICY IF EXISTS sop_notes_writable_delete ON public.menu_sop_ingredient_notes;
CREATE POLICY sop_notes_writable_delete ON public.menu_sop_ingredient_notes AS RESTRICTIVE FOR DELETE TO public
  USING (public.can_write_sop(sop_id));

-- May this account be chosen to see this SOP? On a prep SOP, editors only
-- (staff never read one, so a chosen staff account would only learn its id).
CREATE OR REPLACE FUNCTION public.sop_viewer_allowed(p_sop uuid, p_profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE((SELECT s.kind <> 'prep'
                          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile AND p.role = 'editor')
                     FROM public.menu_sops s WHERE s.id = p_sop), false);
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_viewer_allowed(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_viewer_allowed(uuid, uuid) TO authenticated, service_role;

-- The chosen lists follow the SOP (review, 2026-09-26): owner and admin read
-- and change the list of an SOP THEY can see, so an admin without a secret
-- prep's grant can neither learn its SOP nor pick who reads it.
DROP POLICY IF EXISTS menu_sop_viewers_select ON public.menu_sop_viewers;
CREATE POLICY menu_sop_viewers_select ON public.menu_sop_viewers FOR SELECT TO authenticated
  USING ((public.current_role() IN ('owner', 'admin') AND public.can_see_sop(sop_id)) OR profile_id = auth.uid());
DROP POLICY IF EXISTS menu_sop_viewers_insert ON public.menu_sop_viewers;
CREATE POLICY menu_sop_viewers_insert ON public.menu_sop_viewers FOR INSERT TO authenticated
  WITH CHECK (public.current_role() IN ('owner', 'admin') AND public.can_see_sop(sop_id)
              AND public.sop_viewer_allowed(sop_id, profile_id));
DROP POLICY IF EXISTS menu_sop_viewers_delete ON public.menu_sop_viewers;
CREATE POLICY menu_sop_viewers_delete ON public.menu_sop_viewers FOR DELETE TO authenticated
  USING (public.current_role() IN ('owner', 'admin') AND public.can_see_sop(sop_id));

-- sop_row_visible (the visibility file's rule on (id, visibility)) has no
-- user after the policies above, and does not know a prep SOP: a trap for
-- the next policy (review, 2026-09-26). Dropped, after checking nothing
-- names it (a LANGUAGE sql body records no dependency, so bodies are read).
DO $do$
DECLARE
  v_name text;
BEGIN
  SELECT string_agg(x.n, ', ') INTO v_name FROM (
    SELECT format('policy %s.%s "%s"', p.schemaname, p.tablename, p.policyname) AS n
      FROM pg_policies p WHERE (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE '%sop_row_visible%'
    UNION ALL
    SELECT format('function %s', f.oid::regprocedure) FROM pg_proc f
     WHERE f.prosrc LIKE '%sop_row_visible%' AND f.oid IS DISTINCT FROM to_regprocedure('public.sop_row_visible(uuid, text)')) AS x;
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    D1 sop_row_visible is still named by: %. Nothing applied.', v_name;
  END IF;
  IF to_regprocedure('public.sop_row_visible(uuid, text)') IS NOT NULL THEN
    -- No CASCADE: anything else that depends on it stops the file.
    EXECUTE 'DROP FUNCTION public.sop_row_visible(uuid, text)';
    PERFORM pg_temp.note('ok      D1 sop_row_visible dropped: no policy or function names it any more');
  ELSE
    PERFORM pg_temp.note('skip    D1 a re-run: sop_row_visible was dropped already');
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.menu_sops_visibility_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- Who sees an SOP is set by owner and admin only. A writer may make an
  -- SOP (open to all) and edit one they can see, never change who sees it.
  -- No session at all (the SQL editor, the service key) is trusted.
  IF auth.uid() IS NOT NULL
     AND COALESCE(public.current_role(), '') NOT IN ('owner', 'admin')
     AND ((TG_OP = 'INSERT' AND NEW.visibility IS DISTINCT FROM 'all')
          OR (TG_OP = 'UPDATE' AND NEW.visibility IS DISTINCT FROM OLD.visibility)) THEN
    RAISE EXCEPTION 'เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่ตั้งได้ว่าใครเห็น SOP นี้';
  END IF;
  -- An SOP stays with its menu or prep and keeps its kind: moved, it would
  -- take its place where another audience reads.
  IF auth.uid() IS NOT NULL AND TG_OP = 'UPDATE' AND NEW.menu_id IS DISTINCT FROM OLD.menu_id THEN
    RAISE EXCEPTION 'ย้าย SOP ไปเมนูอื่นไม่ได้';
  END IF;
  IF auth.uid() IS NOT NULL AND TG_OP = 'UPDATE'
     AND (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.prep_recipe_id IS DISTINCT FROM OLD.prep_recipe_id) THEN
    RAISE EXCEPTION 'ย้าย SOP ไปของเตรียมอื่น หรือเปลี่ยนชนิดของ SOP ไม่ได้';
  END IF;
  -- An SOP's id is the database's to choose, never a session's: its private
  -- photos are read by that id and are never deleted, so a deleted SOP's id
  -- taken again would hand its photos to the new one's readers (review,
  -- 2026-09-26). The app never sends an id.
  IF auth.uid() IS NOT NULL AND TG_OP = 'INSERT' THEN
    NEW.id := gen_random_uuid();
  END IF;
  IF auth.uid() IS NOT NULL AND TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'เปลี่ยนรหัสของ SOP ไม่ได้';
  END IF;
  RETURN NEW;
END
$fn$;

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
      -- An SOP or manual photo: owner, admin, editor, and a manual's chosen
      -- writer, whatever their role (queue item 58).
      THEN (public.current_role() IN ('owner', 'admin', 'editor') OR public.writes_some_manual())
    ELSE false
  END, false);
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_photo_upload_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_photo_upload_allowed(text) TO authenticated, service_role;

-- The one save of a prep SOP or a manual: the row, its steps and (a prep
-- SOP's) ingredient notes, whole, in one transaction, under the caller's own
-- policies (SECURITY INVOKER). Returns the SOP's id.
CREATE OR REPLACE FUNCTION public.sop_doc_save(
  p_id uuid, p_kind text, p_prep uuid, p_category uuid, p_title text,
  p_author text, p_updated date, p_video text, p_steps jsonb, p_notes jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_id  uuid;
  v_n   bigint;
  v_bad text;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('prep', 'manual') THEN
    RAISE EXCEPTION 'บันทึกได้เฉพาะ SOP ของเตรียมและคู่มือ';
  END IF;
  IF jsonb_typeof(COALESCE(p_steps, 'null'::jsonb)) IS DISTINCT FROM 'array' OR jsonb_array_length(p_steps) > 300 THEN
    RAISE EXCEPTION 'ขั้นตอนไม่ถูกต้อง';
  END IF;
  SELECT e.value::text INTO v_bad
    FROM jsonb_array_elements(p_steps) AS e
   WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'object'
      OR (e.value ->> 'section') IS NULL
      OR (p_kind = 'prep' AND (e.value ->> 'section') NOT IN ('prep', 'cook', 'plating', 'checklist'))
      OR (p_kind = 'manual' AND (e.value ->> 'section') NOT IN ('step', 'checklist'))
      OR char_length(btrim(COALESCE(e.value ->> 'text', ''))) NOT BETWEEN 1 AND 2000
      OR char_length(COALESCE(e.value ->> 'photo_url', '')) > 1000
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ขั้นตอนไม่ถูกต้อง: %', left(v_bad, 120);
  END IF;
  IF p_kind = 'prep' THEN
    SELECT s.id INTO v_id FROM public.menu_sops s WHERE s.prep_recipe_id = p_prep AND s.kind = 'prep' FOR UPDATE;
    IF v_id IS NULL THEN
      INSERT INTO public.menu_sops (kind, prep_recipe_id, author_name, updated_at, demo_video_url)
      VALUES ('prep', p_prep, NULLIF(btrim(COALESCE(p_author, '')), ''), COALESCE(p_updated, CURRENT_DATE), NULLIF(btrim(COALESCE(p_video, '')), ''))
      RETURNING id INTO v_id;
    ELSE
      UPDATE public.menu_sops
         SET author_name = NULLIF(btrim(COALESCE(p_author, '')), ''), updated_at = COALESCE(p_updated, CURRENT_DATE),
             demo_video_url = NULLIF(btrim(COALESCE(p_video, '')), '')
       WHERE id = v_id;
    END IF;
  ELSIF p_id IS NULL THEN
    INSERT INTO public.menu_sops (kind, manual_category_id, title, author_name, updated_at, demo_video_url)
    VALUES ('manual', p_category, btrim(COALESCE(p_title, '')), NULLIF(btrim(COALESCE(p_author, '')), ''),
            COALESCE(p_updated, CURRENT_DATE), NULLIF(btrim(COALESCE(p_video, '')), ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.menu_sops
       SET manual_category_id = p_category, title = btrim(COALESCE(p_title, '')),
           author_name = NULLIF(btrim(COALESCE(p_author, '')), ''), updated_at = COALESCE(p_updated, CURRENT_DATE),
           demo_video_url = NULLIF(btrim(COALESCE(p_video, '')), '')
     WHERE id = p_id AND kind = 'manual';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'ไม่พบคู่มือนี้ หรือไม่มีสิทธิ์แก้';
    END IF;
    v_id := p_id;
  END IF;
  DELETE FROM public.menu_sop_steps WHERE sop_id = v_id;
  INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text, photo_url)
  SELECT v_id, e.value ->> 'section',
         (row_number() OVER (PARTITION BY e.value ->> 'section' ORDER BY e.ord) - 1)::int,
         btrim(e.value ->> 'text'),
         CASE WHEN (e.value ->> 'section') = 'checklist' THEN NULL ELSE NULLIF(e.value ->> 'photo_url', '') END
    FROM jsonb_array_elements(p_steps) WITH ORDINALITY AS e(value, ord);
  IF p_kind = 'prep' THEN
    DELETE FROM public.menu_sop_ingredient_notes WHERE sop_id = v_id;
    IF jsonb_typeof(COALESCE(p_notes, 'null'::jsonb)) = 'object' THEN
      INSERT INTO public.menu_sop_ingredient_notes (sop_id, ingredient_id, note)
      SELECT v_id, n.key::uuid, btrim(n.value)
        FROM jsonb_each_text(p_notes) AS n
       WHERE btrim(COALESCE(n.value, '')) <> '' AND n.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    END IF;
  END IF;
  RETURN v_id;
END
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_doc_save(uuid, text, uuid, uuid, text, text, date, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_doc_save(uuid, text, uuid, uuid, text, text, date, text, jsonb, jsonb) TO authenticated;

-- ── Step 5: the private bucket for SOP photos (prepared; nothing moves) ────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sop-photos-private', 'sop-photos-private', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- A photo at <document id>/<name>: read by whoever can read that document.
-- One at staging/<uploader id>/<name> (before its document exists, or in an
-- editor's request): read by its uploader, and by owner and admin, who
-- approve requests.
CREATE OR REPLACE FUNCTION public.sop_private_photo_readable(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN public.current_role() IS NULL OR p_name IS NULL THEN false
    WHEN split_part(p_name, '/', 1) = 'staging' THEN
      split_part(p_name, '/', 2) = auth.uid()::text OR public.current_role() IN ('owner', 'admin')
    WHEN split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      public.can_see_sop(split_part(p_name, '/', 1)::uuid)
    ELSE false
  END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_private_photo_readable(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_private_photo_readable(text) TO authenticated, service_role;

-- Upload: into a document the caller may write, or into their own staging
-- folder when they write SOPs or manuals at all; the app's names only.
CREATE OR REPLACE FUNCTION public.sop_private_photo_upload_allowed(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT CASE
    WHEN public.current_role() IS NULL OR p_name IS NULL THEN false
    WHEN p_name ~ '^staging/[0-9a-f-]{36}/[0-9]+-[0-9a-z]+[.]jpg$' THEN
      split_part(p_name, '/', 2) = auth.uid()::text
      AND (public.current_role() IN ('owner', 'admin', 'editor') OR public.writes_some_manual())
    WHEN p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+-[0-9a-z]+[.]jpg$' THEN
      public.can_write_sop(split_part(p_name, '/', 1)::uuid)
    ELSE false
  END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.sop_private_photo_upload_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sop_private_photo_upload_allowed(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "sop private read" ON storage.objects;
CREATE POLICY "sop private read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sop-photos-private' AND public.sop_private_photo_readable(name));
DROP POLICY IF EXISTS "sop private upload" ON storage.objects;
CREATE POLICY "sop private upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sop-photos-private' AND public.sop_private_photo_upload_allowed(name));
-- The caps: whatever other policy storage.objects has, these hold for it.
DROP POLICY IF EXISTS "sop private read cap" ON storage.objects;
CREATE POLICY "sop private read cap" ON storage.objects AS RESTRICTIVE FOR SELECT TO public
  USING (bucket_id <> 'sop-photos-private' OR public.sop_private_photo_readable(name));
DROP POLICY IF EXISTS "sop private upload cap" ON storage.objects;
CREATE POLICY "sop private upload cap" ON storage.objects AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (bucket_id <> 'sop-photos-private'
              OR (public.sop_private_photo_upload_allowed(name) AND archived_at IS NULL AND is_delete_marker IS NOT TRUE));
DROP POLICY IF EXISTS "sop private no update" ON storage.objects;
CREATE POLICY "sop private no update" ON storage.objects AS RESTRICTIVE FOR UPDATE TO public
  USING (bucket_id <> 'sop-photos-private') WITH CHECK (bucket_id <> 'sop-photos-private');
DROP POLICY IF EXISTS "sop private no delete" ON storage.objects;
CREATE POLICY "sop private no delete" ON storage.objects AS RESTRICTIVE FOR DELETE TO public
  USING (bucket_id <> 'sop-photos-private');

-- ── Step 6: tests, as the real accounts, on rows they make, all rolled back ──

DO $do$
DECLARE
  owner_ uuid := current_setting('pm.owner')::uuid;
  admin_ uuid := current_setting('pm.admin')::uuid;
  staff_ uuid := current_setting('pm.staff')::uuid;
  hr_    uuid := current_setting('pm.hr')::uuid;
  sales_ uuid := current_setting('pm.sales')::uuid;
  eda_   uuid := current_setting('pm.ed_a')::uuid;   -- เวช: granted the probe prep
  edb_   uuid := current_setting('pm.ed_b')::uuid;   -- แหงน: not granted
  nobody_ uuid := gen_random_uuid();
  v_ing uuid; v_p1 uuid; v_p2 uuid; v_d1 uuid; v_d1step uuid; v_d2 uuid;
  v_fresh uuid := gen_random_uuid();
  v_catk uuid; v_cats uuid; v_m1 uuid; v_m1step uuid; v_m2 uuid; v_m3 uuid; v_m3step uuid;
  v_menu uuid;
  v_log text;
BEGIN
  BEGIN
    -- ── The rows the tests need, made here ──
    INSERT INTO public.ingredients (name) VALUES ('probe-pm ' || gen_random_uuid()) RETURNING id INTO v_ing;
    INSERT INTO public.prep_recipes (name, batch_yield_qty, batch_yield_unit) VALUES ('probe-pm 1', 1, 'kg') RETURNING id INTO v_p1;
    INSERT INTO public.prep_recipes (name, batch_yield_qty, batch_yield_unit) VALUES ('probe-pm 2', 1, 'kg') RETURNING id INTO v_p2;
    INSERT INTO public.prep_recipe_access (prep_recipe_id, profile_id) VALUES (v_p1, eda_), (v_p1, staff_), (v_p2, eda_);
    INSERT INTO public.menu_sops (kind, prep_recipe_id) VALUES ('prep', v_p1) RETURNING id INTO v_d1;
    INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (v_d1, 'prep', 0, 'probe-pm') RETURNING id INTO v_d1step;
    INSERT INTO public.menu_sop_ingredient_notes (sop_id, ingredient_id, note) VALUES (v_d1, v_ing, 'probe-pm');
    INSERT INTO public.menu_sops (kind, prep_recipe_id) VALUES ('prep', v_p2) RETURNING id INTO v_d2;
    INSERT INTO public.menu_sop_viewers (sop_id, profile_id) VALUES (v_d2, eda_);
    INSERT INTO public.manual_categories (name, editors_write) VALUES ('probe-pm kitchen ' || gen_random_uuid(), true) RETURNING id INTO v_catk;
    INSERT INTO public.manual_categories (name, editors_write) VALUES ('probe-pm service ' || gen_random_uuid(), false) RETURNING id INTO v_cats;
    INSERT INTO public.menu_sops (kind, manual_category_id, title) VALUES ('manual', v_cats, 'probe-pm m1') RETURNING id INTO v_m1;
    INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (v_m1, 'step', 0, 'probe-pm') RETURNING id INTO v_m1step;
    INSERT INTO public.menu_sops (kind, manual_category_id, title) VALUES ('manual', v_catk, 'probe-pm m2') RETURNING id INTO v_m2;
    INSERT INTO public.menu_sops (kind, manual_category_id, title, visibility) VALUES ('manual', v_cats, 'probe-pm m3', 'chosen') RETURNING id INTO v_m3;
    INSERT INTO public.menu_sop_viewers (sop_id, profile_id) VALUES (v_m3, staff_);
    INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (v_m3, 'step', 0, 'probe-pm') RETURNING id INTO v_m3step;
    INSERT INTO public.menus (name, selling_price) VALUES ('probe-pm ' || gen_random_uuid(), 0) RETURNING id INTO v_menu;
    INSERT INTO public.manual_category_writers (category_id, profile_id) VALUES (v_catk, sales_);
    INSERT INTO storage.objects (bucket_id, name) VALUES
      ('sop-photos-private', v_d1 || '/1700000000000-a.jpg'),
      ('sop-photos-private', v_m3 || '/1700000000000-b.jpg'),
      ('sop-photos-private', 'staging/' || eda_ || '/1700000000000-c.jpg');
    PERFORM pg_temp.note('ok      T0 the probe rows are made (two preps, เวช granted both and staff the first; a prep SOP on each, the first with a step and a note, the second listing เวช; two categories, one written by editors; three manuals, one for chosen accounts with staff chosen; three private photos: the prep SOP''s, the restricted manual''s and one in เวช''s staging folder)');

    -- ── A. Prep SOPs: read by those who see the prep, never staff ──
    PERFORM pg_temp.t('PS1 owner reads the prep SOP', owner_, 'owner', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=1']);
    PERFORM pg_temp.t('PS2 admin WITHOUT the prep''s grant reads it (the secret-prep rule)', admin_, 'admin', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS3 เวช, granted the prep, reads it', eda_, 'editor', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=1']);
    PERFORM pg_temp.t('PS4 แหงน, not granted, reads it', edb_, 'editor', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS5 staff, granted the prep, reads it (never staff)', staff_, 'staff', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS6 hr reads it', hr_, 'hr', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS7 sales reads it', sales_, 'sales', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS8 a login with no profile reads it', nobody_, 'no-profile', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS9 staff: its steps', staff_, 'staff', format('SELECT id FROM public.menu_sop_steps WHERE sop_id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS10 แหงน: its notes', edb_, 'editor', format('SELECT id FROM public.menu_sop_ingredient_notes WHERE sop_id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS11 เวช: its steps and notes', eda_, 'editor',
      format('SELECT id FROM public.menu_sop_steps WHERE sop_id = %L UNION ALL SELECT id FROM public.menu_sop_ingredient_notes WHERE sop_id = %L', v_d1, v_d1), ARRAY['rows=2']);
    PERFORM pg_temp.t('PS12 เวช rewrites a step', eda_, 'editor', format('UPDATE public.menu_sop_steps SET text = text WHERE id = %L', v_d1step), ARRAY['rows=1']);
    PERFORM pg_temp.t('PS13 แหงน adds a step', edb_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'cook', 1, 'probe-pm')$q$, v_d1), ARRAY['denied']);
    PERFORM pg_temp.t('PS14 staff, granted the prep, adds a step', staff_, 'staff',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'cook', 1, 'probe-pm')$q$, v_d1), ARRAY['denied']);
    PERFORM pg_temp.t('PS15 แหงน makes a SOP for a prep they cannot see', edb_, 'editor',
      format($q$INSERT INTO public.menu_sops (kind, prep_recipe_id) VALUES ('prep', %L)$q$, v_p2), ARRAY['denied']);
    PERFORM pg_temp.t('PS16 เวช saves the second prep''s SOP whole (sop_doc_save), two steps', eda_, 'editor',
      format($q$SELECT public.sop_doc_save(NULL, 'prep', %L, NULL, NULL, 'probe', DATE '2026-09-26', '', '[{"section":"prep","text":"a"},{"section":"cook","text":"b","photo_url":null}]'::jsonb, '{}'::jsonb)$q$, v_p2),
      ARRAY['rows=1 check=2'], format('SELECT t.id FROM public.menu_sop_steps t JOIN public.menu_sops s ON s.id = t.sop_id WHERE s.prep_recipe_id = %L', v_p2));
    PERFORM pg_temp.t('PS17 เวช moves the prep SOP to another prep', eda_, 'editor',
      format('UPDATE public.menu_sops SET prep_recipe_id = %L WHERE id = %L', v_p2, v_d1), ARRAY['refused']);
    PERFORM pg_temp.said('PS17', 'ของเตรียมอื่น');
    PERFORM pg_temp.t('PS18 staff deletes the prep SOP', staff_, 'staff', format('DELETE FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS19 owner grants admin the prep', owner_, 'owner',
      format('INSERT INTO public.prep_recipe_access (prep_recipe_id, profile_id) VALUES (%L, %L)', v_p1, admin_), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('PS20 admin, now granted, reads the prep SOP', admin_, 'admin', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=1']);
    PERFORM pg_temp.t('PS21 admin sets it to chosen accounts, nobody chosen yet', admin_, 'admin',
      format('SELECT public.sop_set_visibility(%L, %L, ARRAY[]::uuid[])', v_d1, 'chosen'), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('PS21b admin chooses staff on the prep SOP (a prep SOP''s list is editors only)', admin_, 'admin',
      format('INSERT INTO public.menu_sop_viewers (sop_id, profile_id) VALUES (%L, %L)', v_d1, staff_), ARRAY['denied']);
    PERFORM pg_temp.t('PS22 staff, granted the prep, cannot read a prep SOP', staff_, 'staff', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);
    PERFORM pg_temp.t('PS23 เวช, granted but not chosen, reads it', eda_, 'editor', format('SELECT id FROM public.menu_sops WHERE id = %L', v_d1), ARRAY['rows=0']);

    -- The chosen lists follow the SOP: the second prep's grant is เวช's alone.
    PERFORM pg_temp.t('VW1 admin WITHOUT the second prep''s grant reads its SOP''s chosen list', admin_, 'admin',
      format('SELECT sop_id FROM public.menu_sop_viewers WHERE sop_id = %L', v_d2), ARRAY['rows=0']);
    PERFORM pg_temp.t('VW2 that admin adds แหงน to the list', admin_, 'admin',
      format('INSERT INTO public.menu_sop_viewers (sop_id, profile_id) VALUES (%L, %L)', v_d2, edb_), ARRAY['denied']);
    PERFORM pg_temp.t('VW3 that admin takes เวช off the list', admin_, 'admin',
      format('DELETE FROM public.menu_sop_viewers WHERE sop_id = %L', v_d2), ARRAY['rows=0']);
    PERFORM pg_temp.t('VW4 owner reads the list', owner_, 'owner',
      format('SELECT sop_id FROM public.menu_sop_viewers WHERE sop_id = %L', v_d2), ARRAY['rows=1']);
    PERFORM pg_temp.t('VW5 owner adds แหงน, an editor, to the list', owner_, 'owner',
      format('INSERT INTO public.menu_sop_viewers (sop_id, profile_id) VALUES (%L, %L)', v_d2, edb_), ARRAY['rows=1']);
    PERFORM pg_temp.t('VW6 owner adds staff to a prep SOP''s list', owner_, 'owner',
      format('INSERT INTO public.menu_sop_viewers (sop_id, profile_id) VALUES (%L, %L)', v_d2, staff_), ARRAY['denied']);
    PERFORM pg_temp.t('VW7 เวช reads its own row on the list', eda_, 'editor',
      format('SELECT sop_id FROM public.menu_sop_viewers WHERE sop_id = %L', v_d2), ARRAY['rows=1']);

    -- ── B. Manuals: read by their visibility; written by their category's writers ──
    PERFORM pg_temp.t('MN1 staff reads a manual open to all', staff_, 'staff', format('SELECT id FROM public.menu_sops WHERE id = %L', v_m1), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN2 hr reads it', hr_, 'hr', format('SELECT id FROM public.menu_sops WHERE id = %L', v_m1), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN3 sales reads it and its step', sales_, 'sales',
      format('SELECT s.id FROM public.menu_sops s JOIN public.menu_sop_steps t ON t.sop_id = s.id WHERE s.id = %L', v_m1), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN4 a login with no profile reads it', nobody_, 'no-profile', format('SELECT id FROM public.menu_sops WHERE id = %L', v_m1), ARRAY['rows=0']);
    PERFORM pg_temp.t('MN5 a visitor reads it', NULL, 'anon', format('SELECT id FROM public.menu_sops WHERE id = %L', v_m1), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('MN6 staff, chosen, reads the restricted manual and its step', staff_, 'staff',
      format('SELECT s.id FROM public.menu_sops s JOIN public.menu_sop_steps t ON t.sop_id = s.id WHERE s.id = %L', v_m3), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN7 hr, not chosen, reads it', hr_, 'hr', format('SELECT id FROM public.menu_sops WHERE id = %L', v_m3), ARRAY['rows=0']);
    PERFORM pg_temp.t('MN8 an editor, not chosen, reads its steps', eda_, 'editor', format('SELECT id FROM public.menu_sop_steps WHERE sop_id = %L', v_m3), ARRAY['rows=0']);
    PERFORM pg_temp.t('MN9 admin reads it', admin_, 'admin', format('SELECT id FROM public.menu_sops WHERE id = %L', v_m3), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN10 an editor adds a step to a manual in a category editors write', eda_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'step', 1, 'probe-pm')$q$, v_m2), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN11 an editor adds a step to a manual in a category editors do not write', eda_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'step', 1, 'probe-pm')$q$, v_m1), ARRAY['denied']);
    PERFORM pg_temp.t('MN12 staff, not a writer, adds a step', staff_, 'staff',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'step', 1, 'probe-pm')$q$, v_m1), ARRAY['denied']);
    PERFORM pg_temp.t('MN13 staff, not a writer, makes a manual', staff_, 'staff',
      format($q$INSERT INTO public.menu_sops (kind, manual_category_id, title) VALUES ('manual', %L, 'x')$q$, v_cats), ARRAY['denied']);
    PERFORM pg_temp.t('MN14 an editor chooses a writer', eda_, 'editor',
      format('INSERT INTO public.manual_category_writers (category_id, profile_id) VALUES (%L, %L)', v_cats, staff_), ARRAY['denied']);
    PERFORM pg_temp.t('MN15 admin chooses staff to write the category (the service head)', admin_, 'admin',
      format('INSERT INTO public.manual_category_writers (category_id, profile_id) VALUES (%L, %L)', v_cats, staff_), ARRAY['rows=1'], NULL, true);
    PERFORM pg_temp.t('MN16 staff, now a writer, adds a step', staff_, 'staff',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text) VALUES (%L, 'step', 1, 'probe-pm')$q$, v_m1), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN17 staff, a writer, makes a manual (open to all)', staff_, 'staff',
      format($q$INSERT INTO public.menu_sops (kind, manual_category_id, title) VALUES ('manual', %L, 'x')$q$, v_cats), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN18 staff, a writer, makes one for chosen accounts', staff_, 'staff',
      format($q$INSERT INTO public.menu_sops (kind, manual_category_id, title, visibility) VALUES ('manual', %L, 'x', 'chosen')$q$, v_cats), ARRAY['refused']);
    PERFORM pg_temp.said('MN18', 'เฉพาะเจ้าของร้านและผู้จัดการ');
    PERFORM pg_temp.t('MN19 staff, a writer, moves a manual to a category they do not write', staff_, 'staff',
      format('UPDATE public.menu_sops SET manual_category_id = %L WHERE id = %L', v_catk, v_m1), ARRAY['denied']);
    PERFORM pg_temp.t('MN20 staff, a writer and chosen, edits the restricted manual', staff_, 'staff',
      format('UPDATE public.menu_sop_steps SET text = text WHERE id = %L', v_m3step), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN21 hr edits a manual', hr_, 'hr', format('UPDATE public.menu_sop_steps SET text = text WHERE id = %L', v_m1step), ARRAY['rows=0']);
    PERFORM pg_temp.t('MN22 staff, a writer, saves a new manual whole (sop_doc_save)', staff_, 'staff',
      format($q$SELECT public.sop_doc_save(NULL, 'manual', NULL, %L, 'probe-pm saved', '', DATE '2026-09-26', '', '[{"section":"step","text":"a"}]'::jsonb, NULL)$q$, v_cats),
      ARRAY['rows=1']);
    PERFORM pg_temp.t('MN23 a manual step in a dish section', admin_, 'admin',
      format($q$SELECT public.sop_doc_save(NULL, 'manual', NULL, %L, 'x', '', NULL, '', '[{"section":"plating","text":"a"}]'::jsonb, NULL)$q$, v_cats),
      ARRAY['refused']);
    PERFORM pg_temp.said('MN23', 'ขั้นตอนไม่ถูกต้อง');
    PERFORM pg_temp.t('MN24 a step with no words', admin_, 'admin',
      format($q$SELECT public.sop_doc_save(NULL, 'manual', NULL, %L, 'x', '', NULL, '', '[{"section":"step","text":"  "}]'::jsonb, NULL)$q$, v_cats),
      ARRAY['refused']);
    PERFORM pg_temp.t('MN25 a manual with no title', admin_, 'admin',
      format($q$INSERT INTO public.menu_sops (kind, manual_category_id, title) VALUES ('manual', %L, '  ')$q$, v_cats), ARRAY['check-refused']);
    PERFORM pg_temp.t('MN26 an editor lets editors write a category', eda_, 'editor',
      format('UPDATE public.manual_categories SET editors_write = true WHERE id = %L', v_cats), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('MN27 admin adds a category', admin_, 'admin', $q$INSERT INTO public.manual_categories (name) VALUES ('probe-pm new')$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('MN28 admin deletes a category that has manuals', admin_, 'admin',
      format('DELETE FROM public.manual_categories WHERE id = %L', v_cats), ARRAY['fk-refused']);
    PERFORM pg_temp.t('MN29 staff, a writer, sets who can see a manual', staff_, 'staff',
      format('SELECT public.sop_set_visibility(%L, %L, ARRAY[]::uuid[])', v_m1, 'chosen'), ARRAY['refused']);
    PERFORM pg_temp.t('MN30 staff reads who writes the two categories (its own row only, not sales''s)', staff_, 'staff',
      format('SELECT profile_id FROM public.manual_category_writers WHERE category_id IN (%L, %L)', v_cats, v_catk), ARRAY['rows=1']);
    PERFORM pg_temp.t('MN31 staff, a writer, may upload an SOP photo (sop-photos)', staff_, 'staff',
      $q$SELECT 1 WHERE public.sop_photo_upload_allowed('1700000000000-abcd.jpg')$q$, ARRAY['rows=1']);
    PERFORM pg_temp.t('MN32 hr, no writer, may not', hr_, 'hr',
      $q$SELECT 1 WHERE public.sop_photo_upload_allowed('1700000000000-abcd.jpg')$q$, ARRAY['rows=0']);
    PERFORM pg_temp.t('MN33 hr may still upload a maintenance photo', hr_, 'hr',
      $q$SELECT 1 WHERE public.sop_photo_upload_allowed('maint-1700000000000-abcd.jpg')$q$, ARRAY['rows=1']);

    -- An SOP's id is the database's; its addresses have a shape.
    PERFORM pg_temp.t('ID1 an editor makes a manual with an id of its choosing (it gets a fresh one)', eda_, 'editor',
      format($q$INSERT INTO public.menu_sops (id, kind, manual_category_id, title) VALUES (%L, 'manual', %L, 'x')$q$, v_fresh, v_catk),
      ARRAY['rows=1 check=0'], format('SELECT id FROM public.menu_sops WHERE id = %L', v_fresh));
    PERFORM pg_temp.t('ID2 an editor changes a manual''s id', eda_, 'editor',
      format('UPDATE public.menu_sops SET id = %L WHERE id = %L', v_fresh, v_m2), ARRAY['refused']);
    PERFORM pg_temp.said('ID2', 'รหัส');
    PERFORM pg_temp.t('CK1 a step photo on another site', eda_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text, photo_url) VALUES (%L, 'step', 1, 'probe-pm', 'https://example.com/x.jpg')$q$, v_m2),
      ARRAY['check-refused']);
    PERFORM pg_temp.t('CK2 a step photo in this project''s sop-photos', eda_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text, photo_url) VALUES (%L, 'step', 1, 'probe-pm', 'https://abcdefgh.supabase.co/storage/v1/object/public/sop-photos/1700000000002-q.jpg')$q$, v_m2),
      ARRAY['rows=1']);
    PERFORM pg_temp.t('CK3 a step photo in the private bucket', eda_, 'editor',
      format($q$INSERT INTO public.menu_sop_steps (sop_id, section, sort_order, text, photo_url) VALUES (%L, 'step', 1, 'probe-pm', %L)$q$, v_m2,
             'storage:sop-photos-private/' || v_m2 || '/1700000000002-q.jpg'),
      ARRAY['rows=1']);
    PERFORM pg_temp.t('CK4 a video address that is not https', eda_, 'editor',
      format($q$UPDATE public.menu_sops SET demo_video_url = 'javascript:alert(1)' WHERE id = %L$q$, v_m2), ARRAY['check-refused']);
    PERFORM pg_temp.t('CK5 a manual saved whole with a photo on another site', staff_, 'staff',
      format($q$SELECT public.sop_doc_save(NULL, 'manual', NULL, %L, 'x', '', NULL, '', '[{"section":"step","text":"a","photo_url":"https://example.com/x.jpg"}]'::jsonb, NULL)$q$, v_cats),
      ARRAY['check-refused']);

    -- Menu SOPs work as before.
    PERFORM pg_temp.t('SR1 an editor saves a new menu SOP the app''s way (upsert, read its id)', edb_, 'editor',
      format($q$INSERT INTO public.menu_sops (menu_id, author_name) VALUES (%L, 'probe') ON CONFLICT (menu_id) DO UPDATE SET author_name = EXCLUDED.author_name RETURNING id$q$, v_menu), ARRAY['rows=1']);
    PERFORM pg_temp.t('SR2 staff reads a menu SOP open to all', staff_, 'staff',
      'SELECT id FROM public.menu_sops WHERE kind = ''menu'' AND visibility = ''all''', ARRAY['rows=' || (SELECT count(*) FROM public.menu_sops WHERE kind = 'menu' AND visibility = 'all')]);

    -- ── C. The private bucket ──
    PERFORM pg_temp.t('PB1 เวช, granted the prep but no longer chosen on its SOP, reads its photo', eda_, 'editor',
      format($q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, v_d1 || '/1700000000000-a.jpg'), ARRAY['rows=0']);
    PERFORM pg_temp.t('PB2 owner reads it', owner_, 'owner',
      format($q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, v_d1 || '/1700000000000-a.jpg'), ARRAY['rows=1']);
    PERFORM pg_temp.t('PB3 staff, chosen on the restricted manual, reads its photo', staff_, 'staff',
      format($q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, v_m3 || '/1700000000000-b.jpg'), ARRAY['rows=1']);
    PERFORM pg_temp.t('PB4 hr, not chosen, reads it', hr_, 'hr',
      format($q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, v_m3 || '/1700000000000-b.jpg'), ARRAY['rows=0']);
    PERFORM pg_temp.t('PB5 แหงน lists the whole bucket: nothing of those', edb_, 'editor',
      $q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name LIKE '%1700000000000-%'$q$, ARRAY['rows=0']);
    PERFORM pg_temp.t('PB6 admin reads เวช''s staging photo (approving a request)', admin_, 'admin',
      format($q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, 'staging/' || eda_ || '/1700000000000-c.jpg'), ARRAY['rows=1']);
    PERFORM pg_temp.t('PB7 เวช reads its own staging photo', eda_, 'editor',
      format($q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, 'staging/' || eda_ || '/1700000000000-c.jpg'), ARRAY['rows=1']);
    PERFORM pg_temp.t('PB8 แหงน reads เวช''s staging photo', edb_, 'editor',
      format($q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, 'staging/' || eda_ || '/1700000000000-c.jpg'), ARRAY['rows=0']);
    PERFORM pg_temp.t('PB9 staff (a writer) uploads into a manual of its category', staff_, 'staff',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos-private', %L)$q$, v_m1 || '/1700000000001-x.jpg'), ARRAY['rows=1']);
    PERFORM pg_temp.t('PB10 แหงน uploads into the prep SOP it cannot see', edb_, 'editor',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos-private', %L)$q$, v_d1 || '/1700000000001-y.jpg'), ARRAY['denied']);
    PERFORM pg_temp.t('PB11 แหงน uploads into another''s staging folder', edb_, 'editor',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos-private', %L)$q$, 'staging/' || eda_ || '/1700000000001-z.jpg'), ARRAY['denied']);
    PERFORM pg_temp.t('PB12 แหงน uploads into its own staging folder', edb_, 'editor',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos-private', %L)$q$, 'staging/' || edb_ || '/1700000000001-w.jpg'), ARRAY['rows=1']);
    PERFORM pg_temp.t('PB13 a name the app never makes', owner_, 'owner',
      format($q$INSERT INTO storage.objects (bucket_id, name) VALUES ('sop-photos-private', %L)$q$, v_m1 || '/evil.png'), ARRAY['denied']);
    PERFORM pg_temp.t('PB14 owner renames a photo', owner_, 'owner',
      format($q$UPDATE storage.objects SET name = name WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, v_d1 || '/1700000000000-a.jpg'), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('PB15 owner deletes a photo', owner_, 'owner',
      format($q$DELETE FROM storage.objects WHERE bucket_id = 'sop-photos-private' AND name = %L$q$, v_d1 || '/1700000000000-a.jpg'), ARRAY['rows=0', 'denied']);
    PERFORM pg_temp.t('PB16 a visitor reads the bucket', NULL, 'anon',
      $q$SELECT name FROM storage.objects WHERE bucket_id = 'sop-photos-private'$q$, ARRAY['rows=0', 'denied']);

    v_log := current_setting('orders.log', true);
    RAISE EXCEPTION USING ERRCODE = 'U0002';
  EXCEPTION
    WHEN SQLSTATE 'U0002' THEN
      PERFORM set_config('orders.log', COALESCE(v_log, ''), false);
      PERFORM pg_temp.note('ok      every test write rolled back, the probe rows with them');
  END;
END
$do$;

-- ── Step 7: nothing the tests did survived them, the state is as written, and the file reported ──

DO $do$
DECLARE
  v_rows bigint;
  v_name text;
  c_expected constant bigint := 110;
BEGIN
  IF (SELECT count(*) FROM public.menu_sops)::text <> current_setting('pm.n_sops')
     OR (SELECT count(*) FROM public.menu_sop_steps)::text <> current_setting('pm.n_steps')
     OR (SELECT count(*) FROM public.menu_sop_ingredient_notes)::text <> current_setting('pm.n_notes')
     OR (SELECT count(*) FROM public.menu_sop_viewers)::text <> current_setting('pm.n_viewers')
     OR (SELECT count(*) FROM public.prep_recipes)::text <> current_setting('pm.n_preps')
     OR (SELECT count(*) FROM public.prep_recipe_access)::text <> current_setting('pm.n_grants')
     OR (SELECT count(*) FROM storage.objects)::text <> current_setting('pm.n_objects')
     OR (SELECT count(*) FROM public.profiles)::text <> current_setting('pm.n_profiles')
     OR (SELECT md5(COALESCE(string_agg(row(t.id, t.menu_id, t.author_name, t.updated_at, t.demo_video_url, t.visibility)::text, '|' ORDER BY t.id), '')) FROM public.menu_sops t) <> current_setting('pm.fp_sops')
     OR (SELECT md5(COALESCE(string_agg(t::text, '|' ORDER BY t.id), '')) FROM public.menu_sop_steps t) <> current_setting('pm.fp_steps') THEN
    RAISE EXCEPTION 'FAIL    K0 a count or a fingerprint changed: a test write or a probe row survived. Nothing applied.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.menu_sops s WHERE s.kind <> 'menu' AND current_setting('pm.first') = 'yes')
     OR EXISTS (SELECT 1 FROM public.menu_sops s WHERE s.kind = 'menu' AND s.menu_id IS NULL) THEN
    RAISE EXCEPTION 'FAIL    K0 after a first run an SOP is not a menu SOP, or a menu SOP has no menu. Nothing applied.';
  END IF;
  PERFORM pg_temp.note(format('ok      K0 every count and fingerprint as before (SOPs, steps, notes, chosen lists, preps, prep grants, storage files, profiles); all %s SOPs are menu SOPs with their menu', current_setting('pm.n_sops')));

  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'menu_sops' AND p.permissive = 'RESTRICTIVE'
        AND p.policyname IN ('sop_visible_select', 'sop_visible_update', 'sop_visible_delete', 'sop_visible_insert')
        AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE '%sop_doc_%') <> 4
     OR (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.permissive = 'RESTRICTIVE'
           AND p.tablename IN ('menu_sop_steps', 'menu_sop_ingredient_notes') AND p.policyname LIKE '%writable%'
           AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE '%can_write_sop%') <> 6
     OR position('sop_doc_readable' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.can_see_sop(uuid)'))) = 0
     OR position('writes_some_manual' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.sop_photo_upload_allowed(text)'))) = 0
     OR position('prep_recipe_id' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.menu_sops_visibility_guard()'))) = 0
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.menu_sops'::regclass AND c.conname = 'menu_sops_kind_check')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.menu_sop_steps'::regclass AND c.conname = 'menu_sop_steps_section_check'
                      AND pg_get_constraintdef(c.oid) LIKE '%step%') THEN
    RAISE EXCEPTION 'FAIL    K1 the SOP rule, its policies, the kinds CHECK or the replaced functions are not as written. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'menu_sop_viewers'
        AND p.policyname IN ('menu_sop_viewers_select', 'menu_sop_viewers_insert', 'menu_sop_viewers_delete')
        AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE '%can_see_sop%') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'menu_sop_viewers'
                      AND p.policyname = 'menu_sop_viewers_insert' AND p.with_check LIKE '%sop_viewer_allowed%')
     OR (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'menu_sop_viewers') <> 3
     OR to_regprocedure('public.sop_row_visible(uuid, text)') IS NOT NULL
     OR position('gen_random_uuid' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.menu_sops_visibility_guard()'))) = 0
     OR (SELECT count(*) FROM pg_constraint c
          WHERE (c.conrelid, c.conname) IN (('public.menu_sop_steps'::regclass, 'menu_sop_steps_photo_url_check'),
                                            ('public.menu_sops'::regclass, 'menu_sops_demo_video_url_check'),
                                            ('public.menu_sops'::regclass, 'menu_sops_author_name_check'))) <> 3 THEN
    RAISE EXCEPTION 'FAIL    K1 the chosen lists'' three policies, the id guard, the address CHECKs or the drop of sop_row_visible are not as written. Nothing applied.';
  END IF;
  SELECT string_agg(p.tablename || '."' || p.policyname || '"', ', ') INTO v_name
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename IN ('menu_sops', 'menu_sop_steps', 'menu_sop_ingredient_notes')
     AND p.permissive = 'PERMISSIVE' AND p.cmd <> 'SELECT'
     AND p.policyname NOT IN ('sop_write', 'sop_notes_write', 'sop_steps_write', 'sop_manual_writers', 'sop_steps_manual_writers');
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL    K1 another write policy is on the SOP tables: %. Nothing applied.', v_name;
  END IF;
  PERFORM pg_temp.note('ok      K1 one rule: the SOP''s four restrictive policies ask sop_doc_*, its steps'' and notes'' six ask can_write_sop, can_see_sop asks sop_doc_readable; the chosen lists'' three ask can_see_sop (a prep SOP''s list: editors only); the kinds CHECK and the ''step'' section are in; the guard keeps kind, prep and id (a session''s new SOP gets a fresh id); the address CHECKs are in; sop_row_visible is gone; manual writers may upload photos; no other write policy');

  IF current_setting('pm.first') = 'yes' THEN
    IF (SELECT string_agg(c.name || CASE WHEN c.editors_write THEN '*' ELSE '' END, ',' ORDER BY c.sort_order) FROM public.manual_categories c)
       IS DISTINCT FROM 'ครัว*,บริการ,จัดเลี้ยง,ทั่วไป'
       OR EXISTS (SELECT 1 FROM public.manual_category_writers) THEN
      RAISE EXCEPTION 'FAIL    K2 the categories after a first run are not ครัว (editors write), บริการ, จัดเลี้ยง, ทั่วไป with no chosen writer. Nothing applied.';
    END IF;
    PERFORM pg_temp.note('ok      K2 first run: the categories are ครัว (every editor writes), บริการ, จัดเลี้ยง and ทั่วไป; nobody chosen yet');
  ELSE
    PERFORM pg_temp.note(format('skip    K2 a re-run: %s categories, %s chosen writers, left as set',
      (SELECT count(*) FROM public.manual_categories), (SELECT count(*) FROM public.manual_category_writers)));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'sop-photos-private' AND b.public = false
                   AND b.file_size_limit = 2097152 AND b.allowed_mime_types = ARRAY['image/jpeg'])
     OR (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
           AND p.policyname IN ('sop private read', 'sop private upload', 'sop private read cap', 'sop private upload cap',
                                'sop private no update', 'sop private no delete')) <> 6
     OR EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.permissive = 'PERMISSIVE'
                  AND p.cmd IN ('UPDATE', 'DELETE', 'ALL') AND (COALESCE(p.qual, '') || COALESCE(p.with_check, '')) LIKE '%sop-photos-private%')
     OR EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'sop-photos-private' AND current_setting('pm.first') = 'yes') THEN
    RAISE EXCEPTION 'FAIL    K3 the private bucket or its six policies are not as written, or it holds a file after a first run. Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K3 sop-photos-private: not public, JPEG, 2 MB; read by the document''s readers (staging: its uploader, owner, admin); upload into a document one writes, or one''s own staging; no update or delete; empty (nothing moved)');

  IF has_table_privilege('anon', 'public.manual_categories', 'SELECT') OR has_table_privilege('anon', 'public.manual_category_writers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.manual_category_writers', 'UPDATE')
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.manual_categories'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.manual_category_writers'::regclass)
     OR has_function_privilege('anon', 'public.sop_doc_save(uuid, text, uuid, uuid, text, text, date, text, jsonb, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.sop_doc_readable(uuid, text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.can_write_sop(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.manual_category_writable(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL    K4 the two new tables or the new functions are not as written (row security, privileges). Nothing applied.';
  END IF;
  PERFORM pg_temp.note('ok      K4 manual_categories and manual_category_writers: row security on, nothing for anon, no UPDATE of a writer row; anon may not call the new functions');

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
-- 1. Set NEXT_PUBLIC_SOP_PHOTOS_PRIVATE=1 in Vercel, then push the branch
--    private-sop-photos (it holds prep-sops-manuals). As owner: the คู่มือ
--    page lists the four categories; add a manual with a photo; choose a
--    writer for บริการ. As a prep's editor, open the prep's SOP.
-- 2. Later, with Nik: move the existing photos (scripts/move-sop-photos.mjs),
--    dry run first.
