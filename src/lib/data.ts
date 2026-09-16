import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  resolveUnitCosts,
  type PrepUnitCostMap,
  type IngredientRow,
  type MenuRecipeItemRow,
  type MenuRow,
  type PrepRecipeItemRow,
  type PrepRecipeRow,
} from "@/lib/costing";

const PAGE_SIZE = 1000;

/**
 * Supabase/PostgREST caps a single response at 1000 rows by default.
 * This app already has ~1,770 menu_recipe_items, so a plain unbounded
 * select() silently truncates — loop with .range() until a page comes
 * back short to fetch every row.
 *
 * EXPORTED because it was needed twice and only used once. The POS import
 * preview read pos_receipt_deliveries (22,805 rows) with a plain select and
 * a .limit() — which does NOT lift the server cap — so it saw 1,000 rows,
 * 58 of 251 materials, and silently offered a fifth of the catalogue for
 * repricing. Any read of a table that can exceed 1,000 rows goes through
 * this.
 *
 * EVERY QUERY PASSED HERE MUST END ITS ORDER BY ON A UNIQUE KEY — `id`, or
 * the table's primary key. Pages are separate LIMIT/OFFSET queries, and
 * without a total order Postgres may return the same row on two pages and
 * another on none. That is not theoretical. getMonthlySummary had NO order,
 * and August 2026 has held 1,003 entries since 2026-09-10 11:30 UTC. A
 * replay of its exact query on 2026-09-16 returned 650, 752 and 753 twice
 * and dropped 790, 951 and 952: operating expense 42,646.31 low and the tax
 * line empty, the same wrong answer on every run and no error. The
 * price-import read, ordered by (material, date), doubled 19 deliveries and
 * lost 19 in the same kind of replay. A non-unique ordering can look right
 * and then stop being right when the query plan changes; ending on `id`
 * makes that impossible.
 */
export async function fetchAllRows<T>(
  query: (range: { from: number; to: number }) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await query({ from, to: from + PAGE_SIZE - 1 });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function getIngredients(): Promise<IngredientRow[]> {
  const supabase = await createClient();
  return fetchAllRows<IngredientRow>(({ from, to }) =>
    supabase
      .from("ingredients")
      .select("id, name, category, is_prep, purchase_unit_label, purchase_cost, receive_qty, yield_qty, usage_unit, prep_recipe_id, par_level")
      .order("name")
      .order("id")
      .range(from, to)
  );
}

export async function getPrepRecipes(): Promise<PrepRecipeRow[]> {
  const supabase = await createClient();
  return fetchAllRows<PrepRecipeRow>(({ from, to }) =>
    supabase.from("prep_recipes").select("id, name, category, batch_yield_qty, batch_yield_unit").order("name").order("id").range(from, to)
  );
}

export async function getPrepRecipeItems(): Promise<PrepRecipeItemRow[]> {
  const supabase = await createClient();
  return fetchAllRows<PrepRecipeItemRow>(({ from, to }) =>
    supabase
      .from("prep_recipe_items")
      .select("id, prep_recipe_id, ingredient_id, quantity")
      .order("prep_recipe_id")
      .order("sort_order")
      .order("id")
      .range(from, to)
  );
}

export async function getMenus(): Promise<MenuRow[]> {
  const supabase = await createClient();
  return fetchAllRows<MenuRow>(({ from, to }) =>
    supabase
      .from("menus")
      .select("id, name, category, selling_price, last_period_qty_sold, staff_visible")
      .order("name")
      .order("id")
      .range(from, to)
  );
}

export async function getMenuRecipeItems(): Promise<MenuRecipeItemRow[]> {
  const supabase = await createClient();
  return fetchAllRows<MenuRecipeItemRow>(({ from, to }) =>
    supabase
      .from("menu_recipe_items")
      .select("id, menu_id, ingredient_id, quantity")
      .order("menu_id")
      .order("sort_order")
      .order("id")
      .range(from, to)
  );
}

export async function getQFactorPct(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("q_factor_pct").eq("id", 1).single();
  return data?.q_factor_pct ?? 3;
}

/**
 * Cost per usage unit for every prep recipe, from the SECURITY DEFINER
 * function. This is the ONLY read in the app that deliberately sees past prep
 * visibility, and it can only ever return (uuid, numeric) — no ingredient
 * list, by the function's return type rather than by our good behaviour.
 *
 * Returns an empty map for a caller whose role may not see cost at all (the
 * function's own guard, which is how a sales session gets nothing). Empty is
 * indistinguishable from "no preps priced", and that is the correct outcome
 * for such a caller: every cost reads unknown rather than wrong.
 */
export async function getPrepUnitCosts(): Promise<PrepUnitCostMap> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prep_unit_costs");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { prep_recipe_id: string; unit_cost: number | string | null }[];
  return new Map(rows.map((r) => [r.prep_recipe_id, r.unit_cost === null ? null : Number(r.unit_cost)]));
}

/**
 * Loads everything needed to compute live costs anywhere in the app.
 *
 * ── THIS OBJECT IS DELIBERATELY INCONSISTENT. DO NOT "FIX" IT. ─────────────
 *
 * `prepRecipes` and `prepItems` are FILTERED FOR DISPLAY: they arrive through
 * the caller's own session, so once the prep RLS policies are live they
 * contain only the recipes this user has been granted. Every surface that
 * renders prep contents should use them and will then show the right subset.
 *
 * `unitCosts` is COMPLETE FOR ARITHMETIC: prep costs come from
 * getPrepUnitCosts(), which is not filtered by visibility at all. A dish that
 * uses a hidden prep still costs what it costs.
 *
 * So the same object says "you may see 3 preps" and "here is what all 48 of
 * them cost", and both are correct. Making them agree in either direction is
 * a bug: filter the costs and half the menu reports an incomplete cost to the
 * people who need it; widen the items and the composition leaks. The two
 * answer different questions.
 */
export async function getCostingContext() {
  const [ingredients, prepRecipes, prepItems, menus, menuItems, qFactorPct, prepUnitCosts] = await Promise.all([
    getIngredients(),
    getPrepRecipes(),
    getPrepRecipeItems(),
    getMenus(),
    getMenuRecipeItems(),
    getQFactorPct(),
    getPrepUnitCosts(),
  ]);
  const unitCosts = resolveUnitCosts(ingredients, prepUnitCosts);
  return { ingredients, prepRecipes, prepItems, menus, menuItems, unitCosts, qFactorPct };
}
