-- ============================================================================
-- Prep-recipe visibility, step 1 of 2: the access table, the predicate, the
-- cost channel, and the recipe-history policy. CHANGES NO PREP POLICY.
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run: every CREATE is guarded
-- or OR REPLACE, and the one policy replacement drops first.
--
-- Nik's rules (2026-09-14):
--   1. CLOSED BY DEFAULT. All 48 preps start hidden; he opens them one at a
--      time to named people. A prep created later is hidden from the moment it
--      exists.
--   2. NO NAME LEAK on the prep LIST and DETAIL: absent, not locked.
--   3. Prep NAMES STAY on dish recipes and in the ingredient picker — a cook
--      must know the dish contains the sauce. The composition is the asset.
--   4. ADMINS ARE NAMED, NOT IMPLICIT. Only the OWNER bypasses, structurally.
--   5. ONLY THE OWNER GRANTS — enforced here, not only by hiding a screen.
--
-- Decision 3 costs this design nothing, and that is worth knowing before
-- reading the policies: a dish line's prep name comes from `ingredients` (the
-- is_prep row), NEVER from `prep_recipes`. Nothing on a dish page reads
-- prep_recipes at all. So step 2 can lock prep_recipes completely and the cook
-- still sees the prep on the dish. Rules 2 and 3 land on different tables and
-- never compete.
--
-- ── WHY THIS FILE CHANGES NO PREP POLICY ───────────────────────────────────
--
-- With zero grant rows, flipping the prep policies would hide prep_recipe_items
-- from the session the server components run as. resolveUnitCosts() would then
-- compute NULL for those preps, and every dish using one would read
-- "ingredient cost incomplete" — 112 of 244 dishes, measured. So the order is:
--
--   1. THIS FILE                     — inert; nothing behaves differently
--      then the cross-check script   — proves the SQL costs match the TS ones
--   2. the app code                  — cost path moves to prep_unit_costs(),
--                                      every screen filtered; presentation
--                                      closes, direct reads still open
--   3. Nik grants the real people    — on the real rows, from a picker
--   4. prep_recipe_access_rls_migration.sql — flips prep_recipes and
--                                      prep_recipe_items; direct reads close
--
-- ONE VISIBLE EFFECT OF THIS FILE, and it lands before any grant exists: the
-- history panel on a prep page goes empty for everyone except the owner. That
-- is rule 1 arriving early for one panel. It is not a malfunction, and a grant
-- fixes it. Nothing else changes.
-- ============================================================================

BEGIN;

-- ── the access table ───────────────────────────────────────────────────────
--
-- Closed-by-default is STRUCTURAL here, not a column default: no row means no
-- access. There is nothing to default and nothing to backfill, and no later
-- INSERT can ship a recipe open by forgetting a flag. A prep created next year
-- is hidden the instant it exists.

CREATE TABLE IF NOT EXISTS public.prep_recipe_access (
  prep_recipe_id uuid NOT NULL REFERENCES public.prep_recipes(id) ON DELETE CASCADE,
  profile_id     uuid NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  granted_by     uuid REFERENCES public.profiles(id),
  PRIMARY KEY (prep_recipe_id, profile_id)
);

COMMENT ON TABLE public.prep_recipe_access IS
  'Who may see a prep recipe composition. No row = no access (closed by '
  'default). The owner bypasses structurally via can_see_prep() and has no '
  'rows here, so revoking can never lock the owner out. Owner-only writes.';

CREATE INDEX IF NOT EXISTS prep_recipe_access_profile_idx
  ON public.prep_recipe_access (profile_id);

ALTER TABLE public.prep_recipe_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prep_recipe_access_select ON public.prep_recipe_access;
DROP POLICY IF EXISTS prep_recipe_access_write  ON public.prep_recipe_access;

-- A person may see their own grants; the owner sees all of them.
CREATE POLICY prep_recipe_access_select ON public.prep_recipe_access
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_owner());

-- Rule 5: the owner alone grants and revokes. Admins are named like anyone
-- else and cannot name themselves.
CREATE POLICY prep_recipe_access_write ON public.prep_recipe_access
  FOR ALL TO authenticated
  USING (public.is_owner()) WITH CHECK (public.is_owner());


-- ── the predicate ──────────────────────────────────────────────────────────
--
-- SECURITY DEFINER so it can read prep_recipe_access regardless of the
-- caller's own policy on that table, and so every surface asks the same
-- question in the same words. The owner arm reads the ROLE, never a grant row:
-- rule 4, and the reason Nik cannot lock himself out.

CREATE OR REPLACE FUNCTION public.can_see_prep(p_prep_recipe_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT public.is_owner()
      OR EXISTS (
           SELECT 1 FROM public.prep_recipe_access
            WHERE prep_recipe_id = p_prep_recipe_id
              AND profile_id = auth.uid()
         );
$fn$;

COMMENT ON FUNCTION public.can_see_prep(uuid) IS
  'May the current user see this prep recipe composition? Owner always; '
  'everyone else only with a prep_recipe_access row. Used by the RLS policies '
  'in step 2 and by every app surface that renders prep contents.';


-- ── the cost channel ───────────────────────────────────────────────────────
--
-- Cost is a NUMBER; a recipe is a LIST. They are different disclosures, and a
-- dish cost must stay correct for someone who cannot see what is in the prep.
-- Step 2 hides prep_recipe_items from the caller's session, so the cost path
-- needs a channel RLS does not filter. This is it.
--
-- WHY THIS CANNOT BE MADE TO RETURN AN INGREDIENT LIST — four structural
-- reasons, none of them a promise about how callers behave:
--
--   1. The return type is fixed at definition time: (uuid, numeric). Postgres
--      enforces it on every call. There is no text column, so no ingredient
--      name can be smuggled out as data.
--   2. It takes NO PARAMETERS. There is nothing to steer — no id to probe, no
--      filter to widen, no injection surface.
--   3. Widening it is not an edit: CREATE OR REPLACE refuses a changed return
--      signature, so adding a column requires DROP FUNCTION first. Any
--      widening is a visible migration in the repo, reviewed like this one.
--   4. The body also enforces the cost rule: zero rows unless the caller role
--      may see cost at all. A sales session gets nothing — today that lives
--      only in requireAdmin() guards in the app.
--
-- Deliberately NOT filtered by can_see_prep: that is the whole point. A
-- granted or ungranted user gets the same, correct number.
--
-- THE ARITHMETIC IS THE SAME ARITHMETIC AS src/lib/costing.ts, and the app
-- change that follows DELETES the prep-resolution branch from
-- resolveUnitCosts() so the nesting rule exists once, here. rawUnitCost's five
-- lines remain in both languages; the cross-check script
-- (scripts/verify-prep-unit-costs.mjs) compares all 48 values against the TS
-- resolver on live data and is the gate for that duplication. IT CANNOT RUN IN
-- CI — there are no database credentials there — so it is a gate a PERSON
-- runs: after this migration, and after any change to either side.
--
-- ALREADY CHECKED ONCE, BEFORE THIS FILE WAS OFFERED TO BE RUN: the expansion
-- below was transcribed clause for clause into JS and compared against the
-- REAL resolveUnitCosts() imported from src/lib/costing.ts (not a retyped
-- copy), over live data. All 48 preps agreed — 43 numbers matching to within
-- 1e-9 relative, and the same 5 nulls on both sides. Max depth reached was 2
-- and the largest single prep expanded to 15 rows, so the depth cap of 10 has
-- five levels of headroom. That check validates the ALGEBRA; the script above
-- validates the FUNCTION once it exists, and is what runs from here on.
--
-- Expansion, not iteration: Postgres forbids aggregates in a recursive term,
-- so this walks each prep DOWN to raw leaves carrying a multiplier
-- (quantity / batch_yield), then sums once at the end. Algebraically identical
-- to the TS fixpoint:  (1/Bp) * SUM qi*[(1/Bq) * SUM qj*cj]
--                   =  SUM (qi/Bp)*(qj/Bq)*cj.
--
-- Unknown stays unknown and never becomes a wrong number: a prep with no
-- items, a component with no price, an orphan prep, or a branch that reaches
-- the depth cap all yield NULL for the whole prep rather than a total that
-- silently omits them. NULL is what the TS resolver returns in each of those
-- cases too, and the UI already renders it as incomplete.
--
-- Depth cap 10: real nesting is 2 (9 preps contain another prep). A cycle
-- terminates at the cap and resolves to NULL — never to a truncated total.

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
   WHERE public.current_role() IN ('owner', 'admin', 'editor', 'staff')
   GROUP BY p.id;
$fn$;

REVOKE EXECUTE ON FUNCTION public.prep_unit_costs() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.prep_unit_costs() TO authenticated;

COMMENT ON FUNCTION public.prep_unit_costs() IS
  'Cost per usage unit for every prep recipe — a number, never a recipe. Two '
  'columns by definition, no parameters, owner/admin/editor/staff only. NULL '
  'wherever the TS resolver returns null. Not filtered by can_see_prep: a dish '
  'cost must be correct for someone who cannot see the prep.';


-- ── recipe_item_history: a third full copy of every composition ────────────
--
-- 0004_recipe_history.sql left this as "for select using (auth.uid() is not
-- null)" — every authenticated role, sales and hr included, and no later
-- migration narrowed it. 119 rows live, 29 of them target_type='prep', each an
-- ingredient_id with old and new quantities. Hiding the prep tables while
-- leaving this open would protect nothing: the deltas rebuild the recipe.
--
-- Closed here rather than in step 2 because nothing but the history panel
-- reads it, so closing it early costs nothing and ends a live leak a week
-- sooner. The menu arm keeps the audience the recipe tables already have; the
-- prep arm asks can_see_prep.

DROP POLICY IF EXISTS recipe_item_history_read_all ON public.recipe_item_history;
DROP POLICY IF EXISTS recipe_item_history_select   ON public.recipe_item_history;

CREATE POLICY recipe_item_history_select ON public.recipe_item_history
  FOR SELECT TO authenticated
  USING (
    CASE target_type
      WHEN 'prep' THEN public.can_see_prep(parent_id)
      ELSE public.current_role() IN ('owner', 'admin', 'editor', 'staff')
    END
  );

COMMIT;

-- ═══ Verification — run separately, AFTER the COMMIT above ═════════════════
--
-- READ THIS FIRST or the results will look like failures. The SQL editor has
-- no logged-in user: auth.uid() is NULL, so public.current_role() is NULL and
-- public.is_owner() is false. Every access check therefore answers "no" in the
-- editor. That is correct behaviour, not a broken migration. Checks 3-5 below
-- impersonate real sessions so they can fail for the right reason.
--
-- 1. The table, its key and its policies exist.
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'prep_recipe_access' ORDER BY policyname;
--   -- expect exactly two: prep_recipe_access_select (SELECT)
--   --                     prep_recipe_access_write  (ALL)
--
--   SELECT count(*) AS grants_now FROM public.prep_recipe_access;
--   -- expect 0 — closed by default, nothing backfilled
--
-- 2. The history policy replaced the open one.
--
--   SELECT policyname, qual FROM pg_policies
--    WHERE tablename = 'recipe_item_history';
--   -- expect ONE row, recipe_item_history_select, whose qual mentions
--   -- can_see_prep. If recipe_item_history_read_all is still listed, the DROP
--   -- did not match and the leak is still open.
--
-- 3. The cost function returns 48 rows to an admin — impersonated, inside a
--    transaction that is rolled back. It substitutes a REAL profile id, so it
--    cannot pass by accident against a uuid that does not exist.
--
--   BEGIN;
--     SELECT set_config('role', 'authenticated', true);
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub', (SELECT id::text FROM public.profiles
--                                  WHERE role = 'admin' ORDER BY full_name LIMIT 1))::text,
--       true);
--     SELECT count(*)                  AS rows_for_admin,
--            count(unit_cost)          AS priced,
--            count(*) - count(unit_cost) AS unknown_cost
--       FROM public.prep_unit_costs();
--     -- expect EXACTLY: rows_for_admin 48, priced 43, unknown_cost 5.
--     -- Those three numbers were measured against the shipped TS resolver
--     -- before this file was written (see the pre-check note below), so a
--     -- different answer means something moved and is worth reading, not
--     -- waving through. Check 5 names the five.
--   ROLLBACK;
--
-- 4. THE NEGATIVE CONTROL, and the one that proves the guard works: the same
--    call as the SALES account must return NOTHING. If this returns 48, the
--    role guard is not doing its job and check 3 proved only that rows exist.
--
--   BEGIN;
--     SELECT set_config('role', 'authenticated', true);
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub', (SELECT id::text FROM public.profiles
--                                  WHERE role = 'sales' LIMIT 1))::text, true);
--     SELECT count(*) AS should_be_zero FROM public.prep_unit_costs();
--   ROLLBACK;
--
-- 5. Which preps have no cost, by name — so an unexpected one is visible now
--    rather than as a blank on a dish page later.
--
--   BEGIN;
--     SELECT set_config('role', 'authenticated', true);
--     SELECT set_config('request.jwt.claims',
--       json_build_object('sub', (SELECT id::text FROM public.profiles
--                                  WHERE role = 'admin' ORDER BY full_name LIMIT 1))::text,
--       true);
--     SELECT p.name, c.unit_cost
--       FROM public.prep_unit_costs() c
--       JOIN public.prep_recipes p ON p.id = c.prep_recipe_id
--      WHERE c.unit_cost IS NULL ORDER BY p.name;
--   ROLLBACK;
--
--   -- expect these five, and they are PRE-EXISTING — this migration does not
--   -- cause them, and the shipped TS resolver already returns null for all
--   -- five today:
--   --   Test เตรียม               — has no items at all (a test row)
--   --   น้ำผัดกะปิ                 — component น้ำสต๊อก has no purchase price
--   --   เบสหลน(หมูสับ)            — component เต้าเจี้ยวขาว has no price
--   --   เบสหลน(ปู)                — component เต้าเจี้ยวขาว has no price
--   --   ผักเคียงน้ำพริก 5 อย่าง    — component แตงกวาเล็ก has no price
--   -- Pricing those three raw ingredients would give four of the five a cost.
--   -- Worth doing, but it is a data job for Nik and nothing here waits on it.
--
-- 6. Nothing was granted and no prep policy moved — this file is inert on the
--    prep tables by design.
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename IN ('prep_recipes', 'prep_recipe_items')
--    ORDER BY tablename, policyname;
--   -- expect the four from costing_tables_rls_migration.sql, unchanged:
--   -- prep_recipe_items_select / prep_recipe_items_write /
--   -- prep_recipes_select      / prep_recipes_write
