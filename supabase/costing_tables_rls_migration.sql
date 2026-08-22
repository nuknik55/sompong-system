-- ============================================================================
-- Lock down cost data: ingredients, menu_recipe_items, prep_recipes, prep_recipe_items
-- ============================================================================
-- Run once in the Supabase SQL editor. Safe to re-run (DROP POLICY IF EXISTS
-- before each CREATE POLICY).
--
-- Confirmed against live pg_policies (matches repo exactly for these 4
-- tables) before writing this.
--
-- READ was "auth.uid() is not null" on all four — every authenticated role,
-- including sales, could read purchase_cost and every recipe. Traced every
-- reader in the app: /staff/menu/[id] fetches full cost data unconditionally
-- for ANY logged-in profile via getCostingContext(), and the original
-- 0001_init.sql schema comment says staff read access is deliberate ("staff:
-- read everything, but can only write recipe LINE ITEMS"). So the correct
-- list is owner/admin/editor/staff — sales excluded, nobody else affected.
--
-- WRITE was two different shapes:
--   - ingredients / prep_recipes: is_owner() — owner ONLY. Every write in the
--     app goes through requireAdminOrEditor(), which admits admin, but
--     is_owner() has always rejected admin's own writes at the RLS layer —
--     this migration is what actually makes admin's writes work, not a
--     preservation of prior behavior.
--   - menu_recipe_items / prep_recipe_items: "auth.uid() is not null" — ANY
--     authenticated role, including sales and staff. staff's own app-level
--     guard in saveRecipeItems() explicitly throws "ไม่มีสิทธิ์แก้ไขสูตร" for
--     staff, but nothing enforced that at the database layer — a direct
--     PostgREST call from a staff or sales session could already bypass it.
-- Traced every write path (staff/actions.ts, staff/menu/actions.ts,
-- staff/prep/actions.ts, owner/ingredients/actions.ts, owner/approve/actions.ts):
-- editor's own writes always stage into pending_changes and are never applied
-- directly — only an admin/owner session ever executes the real INSERT/UPDATE/
-- DELETE (the direct-save branch, or approveChange() applying an approved
-- change). So write access becomes owner/admin only on all four tables,
-- matching the single write pattern the app actually exercises today; editor's
-- UI-level access is unaffected since it never wrote the table directly.
-- ============================================================================


-- ── ingredients ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "ingredients_read_all"    ON public.ingredients;
DROP POLICY IF EXISTS "ingredients_owner_write" ON public.ingredients;

CREATE POLICY "ingredients_select" ON public.ingredients FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'editor', 'staff'));

CREATE POLICY "ingredients_write" ON public.ingredients FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));


-- ── prep_recipes ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "prep_recipes_read_all"    ON public.prep_recipes;
DROP POLICY IF EXISTS "prep_recipes_owner_write" ON public.prep_recipes;

CREATE POLICY "prep_recipes_select" ON public.prep_recipes FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'editor', 'staff'));

CREATE POLICY "prep_recipes_write" ON public.prep_recipes FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));


-- ── menu_recipe_items ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "menu_recipe_items_read_all"    ON public.menu_recipe_items;
DROP POLICY IF EXISTS "menu_recipe_items_staff_write" ON public.menu_recipe_items;

CREATE POLICY "menu_recipe_items_select" ON public.menu_recipe_items FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'editor', 'staff'));

CREATE POLICY "menu_recipe_items_write" ON public.menu_recipe_items FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));


-- ── prep_recipe_items ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "prep_recipe_items_read_all"    ON public.prep_recipe_items;
DROP POLICY IF EXISTS "prep_recipe_items_staff_write" ON public.prep_recipe_items;

CREATE POLICY "prep_recipe_items_select" ON public.prep_recipe_items FOR SELECT TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin', 'editor', 'staff'));

CREATE POLICY "prep_recipe_items_write" ON public.prep_recipe_items FOR ALL TO authenticated
  USING      ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'))
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('owner', 'admin'));
