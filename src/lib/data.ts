import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  resolveUnitCosts,
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
 */
async function fetchAllRows<T>(
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
      .select("id, name, category, is_prep, purchase_unit_label, purchase_cost, receive_qty, yield_qty, usage_unit, prep_recipe_id")
      .order("name")
      .range(from, to)
  );
}

export async function getPrepRecipes(): Promise<PrepRecipeRow[]> {
  const supabase = await createClient();
  return fetchAllRows<PrepRecipeRow>(({ from, to }) =>
    supabase.from("prep_recipes").select("id, name, category, batch_yield_qty, batch_yield_unit").order("name").range(from, to)
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
      .range(from, to)
  );
}

export async function getMenus(): Promise<MenuRow[]> {
  const supabase = await createClient();
  return fetchAllRows<MenuRow>(({ from, to }) =>
    supabase
      .from("menus")
      .select("id, name, category, selling_price, fuel_cost, last_period_qty_sold")
      .order("name")
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
      .range(from, to)
  );
}

export async function getQFactorPct(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("q_factor_pct").eq("id", 1).single();
  return data?.q_factor_pct ?? 3;
}

/** Loads everything needed to compute live costs anywhere in the app. */
export async function getCostingContext() {
  const [ingredients, prepRecipes, prepItems, menus, menuItems, qFactorPct] = await Promise.all([
    getIngredients(),
    getPrepRecipes(),
    getPrepRecipeItems(),
    getMenus(),
    getMenuRecipeItems(),
    getQFactorPct(),
  ]);
  const unitCosts = resolveUnitCosts(ingredients, prepRecipes, prepItems);
  return { ingredients, prepRecipes, prepItems, menus, menuItems, unitCosts, qFactorPct };
}
