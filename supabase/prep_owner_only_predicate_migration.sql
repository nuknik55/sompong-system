-- ============================================================================
-- Prep-recipe visibility, correction: the owner bypass becomes OWNER-ONLY.
-- ============================================================================
-- Run once in the Supabase SQL editor. Transactional and idempotent. Touches
-- NO DATA: one new function, one function body replaced, three policies
-- dropped and recreated by name. It checks itself before COMMIT and rolls
-- back on any disagreement.
--
-- ── ORDER: THE APP CHANGE IS DEPLOYED BEFORE THIS FILE RUNS ────────────────
--
-- Three app writes create a prep_recipes row and read its id back
-- (createPrep, duplicatePrep, and approving an editor's prep_create). Reading
-- back is INSERT ... RETURNING, and Postgres checks a RETURNED row against
-- the table's SELECT policy. A brand-new prep has no grant row, so once this
-- file runs, those three writes fail for every admin — เฮง included — unless
-- the app has stopped reading the row back. They have worked until now only
-- because of the leak below. Footer check 6 demonstrates it.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
--
-- prep_recipe_access_migration.sql built the owner bypass on public.is_owner()
-- in the belief that it means role = 'owner', which is how 0001_init.sql
-- defines it. It has not meant that since migrations/006_owner_role.sql
-- replaced it:
--
--   SELECT public.current_role() IN ('owner', 'admin');
--
-- Nik confirmed that live with pg_get_functiondef on 2026-09-16. So from the
-- day the visibility work shipped, can_see_prep() has answered TRUE for every
-- admin on every prep, and Nik's rules 4 and 5 held only on screen:
--
--   - the `admin` account, holding zero grants, opened กะทิราดข้าวเหนียว with
--     its full ingredient list — through RLS, not around it
--   - อู๋ and `admin` could read, update and delete all 48 preps, and read
--     their history
--   - every admin could insert and delete prep_recipe_access rows directly,
--     which means granting themselves anything; only requireOwner() on the
--     screen stopped it
--   - every admin could read everyone's grants and the grant history
--
-- ── WHY is_owner() IS LEFT EXACTLY AS IT IS ────────────────────────────────
--
-- 006 says why in its own header: the older policies use is_owner() to let
-- ADMINS write. profiles, ingredients, menus, app_settings (q-factor),
-- pos_sales_aliases and the inventory tables (008 says so outright) all
-- depend on it meaning owner-or-admin, so narrowing it would strip admin write
-- access across the app. Its NAME is wrong; its BEHAVIOUR is load-bearing.
--
-- So this file adds a function whose name and body agree, is_owner_only(),
-- and moves the prep-visibility surfaces onto it — those and nothing else:
--
--   can_see_prep()                      body replaced in place
--   prep_recipe_access_select           dropped and recreated
--   prep_recipe_access_write            dropped and recreated
--   prep_recipe_access_history_select   dropped and recreated
--
-- can_see_prep() keeps its signature, so CREATE OR REPLACE keeps the same
-- function. A policy references a function; it does not copy the function's
-- text. The five policies that call it therefore take the new body without
-- being touched: prep_recipes_select/_write, prep_recipe_items_select/_write,
-- and the prep arm of recipe_item_history_select. Step 0 reads those five
-- from pg_depend instead of trusting this paragraph.
--
-- NOTE WHAT pg_depend CANNOT SHOW, because it is how the defect hid: Postgres
-- records which functions a POLICY calls, but not which functions a
-- LANGUAGE sql function body calls. Nothing in the catalogue connects
-- can_see_prep() to is_owner(). That is why step 3 tests behaviour rather
-- than reading structure.
--
-- ── WHAT CHANGES FOR PEOPLE ────────────────────────────────────────────────
--
--   Owner                    nothing
--   เฮง (admin, 48 grants)   his 48 stay; he can no longer grant or revoke
--                            anything, and sees only his own grant rows
--   อู๋, admin (0 grants)    every prep composition disappears; the cost of
--                            every dish stays correct (prep_unit_costs() is
--                            not touched)
--   editors, staff           nothing; is_owner() was already false for them
--
-- A NEW PREP IS HIDDEN FROM WHOEVER CREATED IT until the owner grants it,
-- เฮง included. prep_recipe_access_rls_migration.sql stated that as Nik's
-- model; nobody has felt it yet, because the leak let every admin see it.
-- ============================================================================

BEGIN;

-- ── Step 0: read what is live, print it, and refuse to guess ───────────────

DO $do$
DECLARE
  r        record;
  v_names  text[];
  v_expect text[] := ARRAY[
    'prep_recipe_access.prep_recipe_access_select',
    'prep_recipe_access.prep_recipe_access_write',
    'prep_recipe_access_history.prep_recipe_access_history_select'
  ];
  v_n      int := 0;
BEGIN
  RAISE NOTICE 'live is_owner(): %', pg_get_functiondef('public.is_owner()'::regprocedure);
  RAISE NOTICE 'live can_see_prep(): %', pg_get_functiondef('public.can_see_prep(uuid)'::regprocedure);

  FOR r IN
    SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('prep_recipe_access', 'prep_recipe_access_history')
  LOOP
    RAISE NOTICE 'existing: %.% [%] USING % WITH CHECK %',
      r.tablename, r.policyname, r.cmd, coalesce(r.qual, '-'), coalesce(r.with_check, '-');
  END LOOP;

  -- Exactly these three, compared as SETS. A fourth permissive policy would
  -- OR itself back into access after this file narrows the three. (Not an
  -- ordered array comparison: '.' and '_' sort differently under the
  -- database's collation than under "C", and the check must not depend on it.)
  SELECT array_agg(tablename || '.' || policyname) INTO v_names
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('prep_recipe_access', 'prep_recipe_access_history');

  IF v_names IS NULL OR NOT (v_names @> v_expect AND v_names <@ v_expect) THEN
    RAISE EXCEPTION
      'expected exactly the three prep-access policies, found %. Production has drifted from the repo — read the NOTICEs above. Nothing changed.', v_names;
  END IF;

  -- The policies that will change behaviour with can_see_prep(), by name.
  FOR r IN
    SELECT DISTINCT c.relname AS tablename, pol.polname AS policyname
      FROM pg_depend d
      JOIN pg_policy pol ON pol.oid = d.objid
      JOIN pg_class  c   ON c.oid   = pol.polrelid
     WHERE d.classid    = 'pg_policy'::regclass
       AND d.refclassid = 'pg_proc'::regclass
       AND d.refobjid   = 'public.can_see_prep(uuid)'::regprocedure
     ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'calls can_see_prep(), changes with it: %.%', r.tablename, r.policyname;
    v_n := v_n + 1;
  END LOOP;

  IF v_n <> 5 THEN
    RAISE EXCEPTION
      'expected 5 policies to call can_see_prep(), found %. Read the NOTICEs above. Nothing changed.', v_n;
  END IF;
END
$do$;


-- ── Step 1: the functions ──────────────────────────────────────────────────

-- COALESCE because current_role() is NULL when there is no session (the SQL
-- editor, an anonymous call). is_owner() returns NULL there; this returns
-- false, so it can be used in a boolean expression without a third state.
CREATE OR REPLACE FUNCTION public.is_owner_only()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(public.current_role() = 'owner', false);
$fn$;

COMMENT ON FUNCTION public.is_owner_only() IS
  'TRUE only for role = owner. Exists because is_owner() has meant owner OR '
  'admin since migrations/006_owner_role.sql, and the older policies depend on '
  'that. Use this wherever admins must NOT be implied.';

-- Same signature, so the five policies that call it follow the new body.
-- Only the first line differs from prep_recipe_access_migration.sql.
CREATE OR REPLACE FUNCTION public.can_see_prep(p_prep_recipe_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.is_owner_only()
      OR EXISTS (
           SELECT 1 FROM public.prep_recipe_access
            WHERE prep_recipe_id = p_prep_recipe_id
              AND profile_id = auth.uid()
         );
$fn$;

COMMENT ON FUNCTION public.can_see_prep(uuid) IS
  'May the current user see this prep recipe composition? The OWNER always '
  '(is_owner_only, the role and never a grant row); everyone else, admins '
  'included, only with a prep_recipe_access row.';


-- ── Step 2: the three policies, by name ────────────────────────────────────

DROP POLICY IF EXISTS prep_recipe_access_select ON public.prep_recipe_access;
DROP POLICY IF EXISTS prep_recipe_access_write  ON public.prep_recipe_access;

-- A person sees their own grants; the owner sees all of them.
CREATE POLICY prep_recipe_access_select ON public.prep_recipe_access
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_owner_only());

-- Rule 5: the owner alone grants and revokes. FOR ALL also applies its USING
-- to SELECT, which is why this policy has to be narrowed as well as the one
-- above: left on is_owner(), it would still hand every admin every row.
CREATE POLICY prep_recipe_access_write ON public.prep_recipe_access
  FOR ALL TO authenticated
  USING (public.is_owner_only()) WITH CHECK (public.is_owner_only());

DROP POLICY IF EXISTS prep_recipe_access_history_select ON public.prep_recipe_access_history;

-- Owner-only reading, matching who may grant.
CREATE POLICY prep_recipe_access_history_select ON public.prep_recipe_access_history
  FOR SELECT TO authenticated
  USING (public.is_owner_only());


-- ── Step 3: check before COMMIT; any disagreement rolls everything back ────
--
-- Impersonates EVERY profile in turn and compares the functions against the
-- rule written out as data, for every prep:
--
--   is_owner_only()   = role is owner
--   is_owner()        = role is owner or admin   (proof it was left alone)
--   can_see_prep(p)   = role is owner, or a grant row exists for (p, person)
--
-- BEHAVIOUR, NOT STRUCTURE, because structure cannot see this: pg_depend
-- records the functions a policy calls, but not the functions a LANGUAGE sql
-- body calls, so no catalogue query can say whether can_see_prep() still
-- reaches is_owner(). Calling it as each person is the only way to find out.
--
-- Every person against every prep, not a sample: the defect this file fixes
-- got through because the check that should have caught it tested an editor,
-- where is_owner() was already false, instead of an admin.
--
-- This covers the FUNCTIONS. It does not show RLS on the tables as a real
-- session sees it; the footer does, with the negative control first.

DO $do$
DECLARE
  p         record;
  r         record;
  v_rule    boolean;
  v_pairs   int := 0;
  v_people  int := 0;
BEGIN
  FOR p IN SELECT id, full_name, role FROM public.profiles ORDER BY role, full_name LOOP
    -- Both settings, because auth.uid() reads claim.sub first when it is set.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p.id::text)::text, true);
    PERFORM set_config('request.jwt.claim.sub', p.id::text, true);

    IF public.is_owner_only() IS DISTINCT FROM COALESCE(p.role = 'owner', false) THEN
      RAISE EXCEPTION 'is_owner_only() is wrong for % (%). Nothing applied.', p.full_name, p.role;
    END IF;

    IF COALESCE(public.is_owner(), false) IS DISTINCT FROM COALESCE(p.role IN ('owner', 'admin'), false) THEN
      RAISE EXCEPTION 'is_owner() no longer means owner-or-admin for % (%); this file must not change it. Nothing applied.', p.full_name, p.role;
    END IF;

    FOR r IN
      SELECT pr.id, pr.name,
             EXISTS (SELECT 1 FROM public.prep_recipe_access a
                      WHERE a.prep_recipe_id = pr.id AND a.profile_id = p.id) AS granted
        FROM public.prep_recipes pr
    LOOP
      v_rule := COALESCE(p.role = 'owner', false) OR r.granted;
      IF public.can_see_prep(r.id) IS DISTINCT FROM v_rule THEN
        RAISE EXCEPTION 'can_see_prep() says % for % (%) on %, the rule says %. Nothing applied.',
          public.can_see_prep(r.id), p.full_name, p.role, r.name, v_rule;
      END IF;
      v_pairs := v_pairs + 1;
    END LOOP;

    v_people := v_people + 1;
  END LOOP;

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- The three policies now call is_owner_only() and no longer call
  -- is_owner(). Read from pg_depend, not from the policy text.
  FOR r IN
    SELECT c.relname, pol.polname,
           EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                      AND d.refclassid = 'pg_proc'::regclass
                      AND d.refobjid = 'public.is_owner_only()'::regprocedure) AS calls_owner_only,
           EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                      AND d.refclassid = 'pg_proc'::regclass
                      AND d.refobjid = 'public.is_owner()'::regprocedure) AS calls_is_owner
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relname IN ('prep_recipe_access', 'prep_recipe_access_history')
  LOOP
    IF NOT r.calls_owner_only OR r.calls_is_owner THEN
      RAISE EXCEPTION '%.%: calls is_owner_only() %, calls is_owner() %. Nothing applied.',
        r.relname, r.polname, r.calls_owner_only, r.calls_is_owner;
    END IF;
  END LOOP;

  RAISE NOTICE 'self-check passed: % people, % person-by-prep pairs agree with the rule', v_people, v_pairs;
END
$do$;

COMMIT;

-- ═══ Verification — run separately, NEGATIVE CONTROL FIRST ═════════════════
--
-- A successful run already printed "self-check passed: 11 people, 528
-- person-by-prep pairs" (11 profiles x 48 preps today). The blocks below are
-- what a real session sees through RLS.
--
-- Each block sets the IDENTITY FIRST, while the editor can still read
-- profiles, and switches role LAST. Every block prints current_role() as its
-- first column: if that is not the role named, the impersonation did not take
-- and nothing else in that row means anything.
--
-- The prep id below is กะทิราดข้าวเหนียว, the recipe from Nik's screenshot,
-- written as a literal on purpose: looked up by name AFTER the role switch,
-- RLS would hide it from the admin, the lookup would return NULL, and
-- can_see_prep(NULL) would answer false for the wrong reason. Check 3 proves
-- the literal is real.
--
-- 1. NEGATIVE CONTROL — `admin`: an admin with ZERO grants, the account the
--    leak was reported from. Every count 0, both predicates false, the cost
--    channel unchanged.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE full_name = 'admin' AND role = 'admin'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     SELECT public.current_role()                                              AS must_be_admin,
--            public.is_owner()                                                  AS still_true,
--            public.is_owner_only()                                             AS must_be_false,
--            public.can_see_prep('fc8c4a24-5c9d-4569-9e40-113f4a2ae07c')        AS kati_must_be_false,
--            (SELECT count(*) FROM public.prep_recipes)                         AS recipes_must_be_0,
--            (SELECT count(*) FROM public.prep_recipe_items)                    AS items_must_be_0,
--            (SELECT count(*) FROM public.prep_recipe_access)                   AS grants_must_be_0,
--            (SELECT count(*) FROM public.prep_recipe_access_history)           AS grant_log_must_be_0,
--            (SELECT count(*) FROM public.recipe_item_history
--              WHERE target_type = 'prep')                                      AS prep_log_must_be_0,
--            (SELECT count(unit_cost) FROM public.prep_unit_costs())            AS priced_must_be_43;
--   ROLLBACK;
--
-- 2. NEGATIVE CONTROL — อู๋: the other ungranted admin. Same expectations.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE full_name = 'อู๋' AND role = 'admin'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     SELECT public.current_role()                                              AS must_be_admin,
--            public.is_owner()                                                  AS still_true,
--            public.is_owner_only()                                             AS must_be_false,
--            public.can_see_prep('fc8c4a24-5c9d-4569-9e40-113f4a2ae07c')        AS kati_must_be_false,
--            (SELECT count(*) FROM public.prep_recipes)                         AS recipes_must_be_0,
--            (SELECT count(*) FROM public.prep_recipe_items)                    AS items_must_be_0,
--            (SELECT count(*) FROM public.prep_recipe_access)                   AS grants_must_be_0,
--            (SELECT count(*) FROM public.prep_recipe_access_history)           AS grant_log_must_be_0,
--            (SELECT count(*) FROM public.recipe_item_history
--              WHERE target_type = 'prep')                                      AS prep_log_must_be_0,
--            (SELECT count(unit_cost) FROM public.prep_unit_costs())            AS priced_must_be_43;
--   ROLLBACK;
--
-- 3. POSITIVE CONTROL, SAME ROLE — เฮง: an admin WITH all 48 grants. This is
--    what tells "admins are excluded" apart from "grants stopped working".
--    If 1 and 2 pass and this fails, the fix has locked out the people it was
--    meant to leave alone.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE full_name = 'เฮง' AND role = 'admin'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     SELECT public.current_role()                                              AS must_be_admin,
--            public.is_owner_only()                                             AS must_be_false,
--            public.can_see_prep('fc8c4a24-5c9d-4569-9e40-113f4a2ae07c')        AS kati_must_be_true,
--            (SELECT count(*) FROM public.prep_recipes)                         AS recipes_must_be_48,
--            (SELECT count(*) FROM public.prep_recipe_items)                    AS items_must_be_248,
--            (SELECT count(*) FROM public.prep_recipe_access)                   AS own_grants_must_be_48,
--            (SELECT count(DISTINCT profile_id) FROM public.prep_recipe_access) AS people_must_be_1,
--            (SELECT count(*) FROM public.prep_recipe_access_history)           AS grant_log_must_be_0,
--            (SELECT count(*) FROM public.recipe_item_history
--              WHERE target_type = 'prep')                                      AS prep_log_30;
--   ROLLBACK;
--
--   -- own_grants was 96 before this file (everyone's rows); 48 is his own.
--   -- prep_log is 30 as of writing; if it differs, compare it with the same
--   -- count run in the editor without impersonation — they must be equal.
--
-- 4. The owner's structural bypass still works — no grant rows of its own.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE role = 'owner'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     SELECT public.current_role()                                              AS must_be_owner,
--            public.is_owner_only()                                             AS must_be_true,
--            public.can_see_prep('fc8c4a24-5c9d-4569-9e40-113f4a2ae07c')        AS kati_must_be_true,
--            (SELECT count(*) FROM public.prep_recipes)                         AS recipes_must_be_48,
--            (SELECT count(*) FROM public.prep_recipe_items)                    AS items_must_be_248,
--            (SELECT count(*) FROM public.prep_recipe_access)                   AS all_grants_must_be_96,
--            (SELECT count(*) FROM public.prep_recipe_access_history)           AS grant_log_2;
--   ROLLBACK;
--
--   -- grant_log is 2 as of writing (the Test เตรียม revoke and re-grant).
--
-- 5. THE WRITE HALF — an admin can neither revoke nor grant. First เฮง, the
--    admin with the most reason to try, deleting grants: 0 rows, his own
--    included. (Before this file the same statement deleted all 96 — it is
--    rolled back either way.)
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE full_name = 'เฮง' AND role = 'admin'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     WITH del AS (DELETE FROM public.prep_recipe_access RETURNING 1)
--     SELECT public.current_role() AS must_be_admin,
--            (SELECT count(*) FROM del) AS rows_deleted_must_be_0;
--   ROLLBACK;
--
--    Then `admin` granting ITSELF กะทิราดข้าวเหนียว. This one must END IN AN
--    ERROR — "new row violates row-level security policy for table
--    prep_recipe_access". A success here is the defect.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE full_name = 'admin' AND role = 'admin'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     INSERT INTO public.prep_recipe_access (prep_recipe_id, profile_id)
--     VALUES ('fc8c4a24-5c9d-4569-9e40-113f4a2ae07c', auth.uid());
--   ROLLBACK;
--
-- 6. THE CREATE PATH — why the app change ships first. Two blocks, because
--    the editor shows only the last statement's result.
--
--    6a. เฮง may still CREATE a prep, and then cannot see it. Expect 0.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE full_name = 'เฮง' AND role = 'admin'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     INSERT INTO public.prep_recipes (name, batch_yield_qty, batch_yield_unit)
--     VALUES ('ทดสอบสิทธิ์', 1, 'กรัม');
--     SELECT count(*) AS own_new_prep_must_be_0
--       FROM public.prep_recipes WHERE name = 'ทดสอบสิทธิ์';
--   ROLLBACK;
--
--    6b. The same insert READING THE ROW BACK must END IN AN ERROR — "new row
--    violates row-level security policy for table prep_recipes". This is the
--    shape the three app writes had; if it succeeds, the app change was not
--    needed and I was wrong about why.
--
--   BEGIN;
--     SELECT set_config('request.jwt.claims', json_build_object('sub',
--       (SELECT id::text FROM public.profiles WHERE full_name = 'เฮง' AND role = 'admin'))::text, true);
--     SELECT set_config('role', 'authenticated', true);
--     INSERT INTO public.prep_recipes (name, batch_yield_qty, batch_yield_unit)
--     VALUES ('ทดสอบสิทธิ์', 1, 'กรัม')
--     RETURNING id;
--   ROLLBACK;
--
-- 7. NOT IN SQL — the screen the leak was reported from. Nik logs in as
--    `admin` and opens the same กะทิราดข้าวเหนียว address as in the
--    screenshot: it must show the not-found page. The ของเตรียม tab on
--    /owner/ingredients must list nothing. Then as เฮง: all 48, unchanged.
