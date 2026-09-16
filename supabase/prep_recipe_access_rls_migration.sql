-- ============================================================================
-- Prep-recipe visibility, step 2 of 2: the RLS policies. CLOSES DIRECT READS.
-- ============================================================================
-- Run once in the Supabase SQL editor. Transactional, idempotent, and it
-- touches NO DATA — only the four policies on prep_recipes and
-- prep_recipe_items.
--
-- ── EXPECT NOTHING TO CHANGE ON SCREEN, AND READ THAT AS THE POINT ─────────
--
-- Every app surface that renders prep contents is ALREADY filtered, in the
-- application, by the same can_see_prep() this file hands to Postgres: the
-- prep list and its tab count, the detail page, the reverse index on
-- /owner/ingredients, the recipe history, the approve queue, and the
-- duplicate/delete/yield/save paths (e34a530). เฮง and เวช hold all 48, so
-- they see no difference; everyone else already sees nothing.
--
-- CORRECTED 2026-09-16: "everyone else already sees nothing" was false for
-- อู๋ and the admin account, and "the same can_see_prep()" is why. Both layers
-- asked one predicate, which rested on is_owner() (owner OR admin, since
-- migrations/006_owner_role.sql), so one misreading opened both. Two layers
-- calling the same predicate are one layer. The app layer now applies the
-- rule itself (src/lib/prep-access.ts); see
-- prep_owner_only_predicate_migration.sql.
--
-- SO A VISIBLE CHANGE AFTER THIS RUNS IS NOT THIS MIGRATION WORKING. It is
-- evidence that some screen was reading prep rows the app layer failed to
-- filter, and it should be reported rather than shrugged at.
--
-- What genuinely changes is what the app cannot control: a direct PostgREST
-- call from an editor's or admin's own session. Until now that returned every
-- recipe to anyone RLS admitted. After this it returns only what they hold.
--
-- ── WHAT THE POLICIES WERE ─────────────────────────────────────────────────
--
-- From costing_tables_rls_migration.sql (committed 16d7104, 2026-08-22), and
-- confirmed live by Nik on 2026-09-15 with a pg_policies read — the check that
-- the 2026-08-31 "applied: everything" sweep could not perform, because a
-- policy is not a table, column, view or function:
--
--   prep_recipes_select       SELECT  role IN (owner, admin, editor, staff)
--   prep_recipes_write        ALL     role IN (owner, admin)
--   prep_recipe_items_select  SELECT  role IN (owner, admin, editor, staff)
--   prep_recipe_items_write   ALL     role IN (owner, admin)
--
-- This file does not TRUST that. Step 0 below reads pg_policies at run time,
-- prints what it finds, and ABORTS unless exactly those four names are there —
-- so if production has drifted from the repo, nothing is dropped and the
-- difference is on screen instead.
--
-- ── WHAT THEY BECOME ───────────────────────────────────────────────────────
--
--   read   : can_see_prep(...)                       — owner always, others
--                                                      only with a grant row
--   write  : USING      role IN (owner, admin) AND can_see_prep(...)
--            WITH CHECK role IN (owner, admin)
--
-- The asymmetry between USING and WITH CHECK is deliberate and is the whole
-- rule in one line: YOU MAY CREATE, BUT YOU MAY NOT MODIFY OR DELETE WHAT YOU
-- CANNOT SEE. USING governs which existing rows an UPDATE or DELETE can
-- touch; WITH CHECK governs the row an INSERT writes. If WITH CHECK also
-- demanded can_see_prep(), creating a prep recipe would be impossible for
-- anyone but the owner — a brand-new recipe has no grant row yet, so the
-- predicate is false for the person creating it, and duplicatePrep would fail
-- halfway through, having written the header but not the items.
--
-- CONSEQUENCE, and it is Nik's model working rather than a defect: an admin
-- who creates a prep recipe cannot then OPEN it until the owner grants it.
-- That is already true in the app today (e34a530) and is what "closed by
-- default, admins named like everyone else" means. It is a write-only
-- asymmetry with no disclosure in it — SELECT stays closed, so nothing can be
-- read back out through this door.
--
-- Editors keep no direct write at all: their edits stage into pending_changes
-- and are applied by an admin session, exactly as before.
-- ============================================================================

BEGIN;

-- ── Step 0: read the live policies, print them, and refuse to guess ────────

DO $do$
DECLARE
  r record;
  v_found int := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('prep_recipes', 'prep_recipe_items')
     ORDER BY tablename, policyname
  LOOP
    RAISE NOTICE 'existing: %.% [%] USING % WITH CHECK %',
      r.tablename, r.policyname, r.cmd, coalesce(r.qual, '-'), coalesce(r.with_check, '-');
    v_found := v_found + 1;
  END LOOP;

  IF v_found <> 4 THEN
    RAISE EXCEPTION
      'expected exactly 4 policies across prep_recipes and prep_recipe_items, found %. Production has drifted from the repo — read the NOTICEs above and stop. Nothing dropped.', v_found;
  END IF;

  -- By name, so a rename is caught too rather than silently left behind as a
  -- second permissive policy that would OR itself back into the read path.
  PERFORM 1 FROM pg_policies WHERE schemaname='public' AND tablename='prep_recipes' AND policyname='prep_recipes_select';
  IF NOT FOUND THEN RAISE EXCEPTION 'prep_recipes_select not found. Nothing dropped.'; END IF;
  PERFORM 1 FROM pg_policies WHERE schemaname='public' AND tablename='prep_recipes' AND policyname='prep_recipes_write';
  IF NOT FOUND THEN RAISE EXCEPTION 'prep_recipes_write not found. Nothing dropped.'; END IF;
  PERFORM 1 FROM pg_policies WHERE schemaname='public' AND tablename='prep_recipe_items' AND policyname='prep_recipe_items_select';
  IF NOT FOUND THEN RAISE EXCEPTION 'prep_recipe_items_select not found. Nothing dropped.'; END IF;
  PERFORM 1 FROM pg_policies WHERE schemaname='public' AND tablename='prep_recipe_items' AND policyname='prep_recipe_items_write';
  IF NOT FOUND THEN RAISE EXCEPTION 'prep_recipe_items_write not found. Nothing dropped.'; END IF;
END
$do$;


-- ── prep_recipes ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS prep_recipes_select ON public.prep_recipes;
DROP POLICY IF EXISTS prep_recipes_write  ON public.prep_recipes;

CREATE POLICY prep_recipes_select ON public.prep_recipes
  FOR SELECT TO authenticated
  USING (public.can_see_prep(id));

CREATE POLICY prep_recipes_write ON public.prep_recipes
  FOR ALL TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin')
    AND public.can_see_prep(id)
  )
  WITH CHECK (
    -- No can_see_prep here, on purpose — see the header. A new recipe has no
    -- grant row yet, so requiring it would make creation owner-only and would
    -- break duplicatePrep after it had already written the header row.
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin')
  );


-- ── prep_recipe_items ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS prep_recipe_items_select ON public.prep_recipe_items;
DROP POLICY IF EXISTS prep_recipe_items_write  ON public.prep_recipe_items;

CREATE POLICY prep_recipe_items_select ON public.prep_recipe_items
  FOR SELECT TO authenticated
  USING (public.can_see_prep(prep_recipe_id));

CREATE POLICY prep_recipe_items_write ON public.prep_recipe_items
  FOR ALL TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin')
    AND public.can_see_prep(prep_recipe_id)
  )
  WITH CHECK (
    -- Same reason as above: duplicatePrep copies items into a recipe that was
    -- created a moment earlier and has no grant row yet.
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin')
  );

COMMIT;

-- ═══ Verification — run separately, NEGATIVE CONTROL FIRST ═════════════════
--
-- Run check 1 before anything else. If an ungranted session can still read
-- the recipes, this migration did not do its job and no later check means
-- anything. If check 1 passes but check 2 fails, the opposite is wrong — the
-- grants are not reaching the predicate, and เฮง and เวช have just lost access
-- to work they need. Both directions have to be seen.
--
-- Each block impersonates a real session and ROLLS BACK. The SQL editor's own
-- session has no auth.uid(), so an unimpersonated SELECT here returns 0 rows
-- for everyone and proves nothing either way.
--
-- 1. NEGATIVE CONTROL — an UNGRANTED editor. Expect 0 and 0.
--
--    CORRECTED 2026-09-16 — THIS WAS THE WRONG CONTROL. The rule under test
--    was "admins are named, not implicit", and is_owner() is false for an
--    editor whether or not the rule holds, so this passed for a reason
--    unrelated to the rule. The ungranted ADMINS (อู๋, admin) were leaking
--    the whole time: is_owner() means owner OR admin
--    (migrations/006_owner_role.sql). A negative control has to come from the
--    population the rule is about; prep_owner_only_predicate_migration.sql
--    uses ungranted admins, with เฮง as the same-role positive control.
--
--   BEGIN;
--     SELECT set_config('role', 'authenticated', true);
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub', (SELECT p.id::text FROM public.profiles p
--                                  WHERE p.full_name = 'ธีรวัฒน์' AND p.role = 'editor'))::text, true);
--     SELECT count(*) AS recipes_should_be_0 FROM public.prep_recipes;
--     SELECT count(*) AS items_should_be_0   FROM public.prep_recipe_items;
--   ROLLBACK;
--
-- 2. POSITIVE CONTROL — เฮง, who holds all 48. Expect 48 and 248.
--
--   BEGIN;
--     SELECT set_config('role', 'authenticated', true);
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub', (SELECT p.id::text FROM public.profiles p
--                                  WHERE p.full_name = 'เฮง' AND p.role = 'admin'))::text, true);
--     SELECT count(*) AS recipes_should_be_48 FROM public.prep_recipes;
--     SELECT count(*) AS items_should_be_248  FROM public.prep_recipe_items;
--   ROLLBACK;
--
-- 3. The owner's structural bypass still works — no grant rows, all 48.
--
--   BEGIN;
--     SELECT set_config('role', 'authenticated', true);
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub', (SELECT id::text FROM public.profiles WHERE role = 'owner'))::text, true);
--     SELECT count(*) AS recipes_should_be_48 FROM public.prep_recipes;
--   ROLLBACK;
--
-- 4. The WRITE half, which is the part the app could not enforce. An ungranted
--    editor's direct UPDATE must touch 0 rows — and it is rolled back anyway.
--
--   BEGIN;
--     SELECT set_config('role', 'authenticated', true);
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub', (SELECT p.id::text FROM public.profiles p
--                                  WHERE p.full_name = 'ธีรวัฒน์' AND p.role = 'editor'))::text, true);
--     WITH upd AS (
--       UPDATE public.prep_recipes SET note = 'probe' RETURNING 1
--     )
--     SELECT count(*) AS rows_updated_should_be_0 FROM upd;
--   ROLLBACK;
--
-- 5. Policies now read as intended.
--
--   SELECT tablename, policyname, cmd, qual, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('prep_recipes', 'prep_recipe_items')
--    ORDER BY tablename, policyname;
--   -- all four quals should mention can_see_prep; the two with_check values
--   -- should NOT — that asymmetry is the create-but-not-modify rule.
--
-- 6. NOT IN SQL, and the one that would be expensive to find late: no dish
--    cost moved. Claude re-runs scripts/verify-prep-unit-costs.mjs against the
--    deployed prep_unit_costs() immediately after this migration — all 48
--    preps agreeing with the TypeScript resolver, and the same five nulls
--    (Test เตรียม, น้ำผัดกะปิ, เบสหลน(ปู), เบสหลน(หมูสับ), ผักเคียงน้ำพริก 5 อย่าง).
--    prep_unit_costs() is SECURITY DEFINER and deliberately NOT filtered by
--    can_see_prep, which is the entire reason it was built before these
--    policies were touched.
