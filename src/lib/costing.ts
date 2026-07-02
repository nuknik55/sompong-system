// Shared cost-calculation logic — re-implements the original spreadsheet's
// formulas in plain TypeScript so the same numbers can be used for both the
// staff recipe editor (live per-dish cost) and the owner dashboard (full
// Menu Engineering matrix).

export type IngredientRow = {
  id: string;
  name: string;
  category: string | null;
  is_prep: boolean;
  purchase_unit_label?: string | null;
  purchase_cost: number | null;
  receive_qty: number | null;
  yield_qty: number | null;
  usage_unit: string | null;
  prep_recipe_id: string | null;
};

export type PrepRecipeRow = {
  id: string;
  name: string;
  category?: string | null;
  batch_yield_qty: number;
  batch_yield_unit: string;
};

export type PrepRecipeItemRow = {
  id: string;
  prep_recipe_id: string;
  ingredient_id: string;
  quantity: number;
};

export type MenuRow = {
  id: string;
  name: string;
  category: string | null;
  selling_price: number;
  fuel_cost: number;
  last_period_qty_sold: number;
};

export type MenuRecipeItemRow = {
  id: string;
  menu_id: string;
  ingredient_id: string;
  quantity: number;
};

/** Cost per usage_unit for a raw (non-prep) ingredient, or null if not priced yet. */
export function rawUnitCost(ing: IngredientRow): number | null {
  if (ing.purchase_cost == null) return null;
  const receiveQty = ing.receive_qty ?? 1;
  if (!ing.yield_qty || receiveQty === 0) {
    // No yield conversion set up: usage unit == purchase unit.
    return receiveQty > 0 ? ing.purchase_cost / receiveQty : ing.purchase_cost;
  }
  const conversionFactor = ing.yield_qty / receiveQty;
  return conversionFactor > 0 ? ing.purchase_cost / conversionFactor : null;
}

export type UnitCostMap = Map<string, number | null>; // ingredient_id -> cost per usage_unit

/**
 * Resolves a unit cost for every ingredient, including prep items whose cost
 * depends on their own recipe (which may itself reference other prep items).
 * Runs multiple passes so any depth of prep-within-prep nesting resolves;
 * an ingredient stays `null` if its cost (or one of its components') is unknown.
 */
export function resolveUnitCosts(
  ingredients: IngredientRow[],
  prepRecipes: PrepRecipeRow[],
  prepItems: PrepRecipeItemRow[]
): UnitCostMap {
  const costs: UnitCostMap = new Map();
  const prepByRecipeId = new Map(prepRecipes.map((p) => [p.id, p]));
  const itemsByPrepRecipeId = new Map<string, PrepRecipeItemRow[]>();
  for (const item of prepItems) {
    const list = itemsByPrepRecipeId.get(item.prep_recipe_id) ?? [];
    list.push(item);
    itemsByPrepRecipeId.set(item.prep_recipe_id, list);
  }

  for (const ing of ingredients) {
    if (!ing.is_prep) costs.set(ing.id, rawUnitCost(ing));
  }

  const prepIngredients = ingredients.filter((i) => i.is_prep && i.prep_recipe_id);
  let remaining = [...prepIngredients];

  for (let pass = 0; pass < prepIngredients.length + 1 && remaining.length > 0; pass++) {
    const stillUnresolved: typeof remaining = [];
    for (const ing of remaining) {
      const recipe = prepByRecipeId.get(ing.prep_recipe_id!);
      const items = itemsByPrepRecipeId.get(ing.prep_recipe_id!) ?? [];
      if (!recipe || items.length === 0) {
        costs.set(ing.id, null);
        continue;
      }
      let total = 0;
      let allKnown = true;
      for (const item of items) {
        const componentCost = costs.get(item.ingredient_id);
        if (componentCost === undefined) {
          allKnown = false;
          break;
        }
        if (componentCost === null) {
          allKnown = false;
          break;
        }
        total += item.quantity * componentCost;
      }
      if (!allKnown) {
        stillUnresolved.push(ing);
        continue;
      }
      costs.set(ing.id, recipe.batch_yield_qty > 0 ? total / recipe.batch_yield_qty : null);
    }
    if (stillUnresolved.length === remaining.length) {
      // No progress this pass — remaining items have a missing/cyclic dependency.
      for (const ing of stillUnresolved) costs.set(ing.id, null);
      break;
    }
    remaining = stillUnresolved;
  }

  return costs;
}

export type MenuCost = {
  menu: MenuRow;
  ingredientCost: number;
  qFactorAmount: number; // flat % uplift for incidentals (gas, spices, packaging) instead of per-dish fuel tracking
  totalCost: number; // ingredientCost + qFactorAmount
  foodCostPct: number | null; // totalCost / selling_price
  profitPerUnit: number;
  hasUnknownCost: boolean;
};

/**
 * qFactorPct: a flat % uplift applied to every menu's ingredient cost to cover
 * incidentals (gas, spices, packaging) instead of tracking gas usage per dish —
 * tracking it per dish badly distorts cheap, quick-cook items (see fuel_cost
 * column, now unused).
 */
export function computeMenuCost(
  menu: MenuRow,
  items: MenuRecipeItemRow[],
  unitCosts: UnitCostMap,
  qFactorPct: number
): MenuCost {
  let ingredientCost = 0;
  let hasUnknownCost = false;
  for (const item of items) {
    const cost = unitCosts.get(item.ingredient_id);
    if (cost == null) {
      hasUnknownCost = true;
      continue;
    }
    ingredientCost += item.quantity * cost;
  }
  const qFactorAmount = ingredientCost * (qFactorPct / 100);
  const totalCost = ingredientCost + qFactorAmount;
  const foodCostPct = menu.selling_price > 0 ? totalCost / menu.selling_price : null;
  const profitPerUnit = menu.selling_price - totalCost;
  return { menu, ingredientCost, qFactorAmount, totalCost, foodCostPct, profitPerUnit, hasUnknownCost };
}

export type MenuEngineeringClass = "Star" | "Horse" | "Puzzle" | "Dog" | "Unranked";

export type MenuEngineeringRow = MenuCost & {
  qtySold: number;
  popularPct: number | null;
  profitClass: "H" | "L" | null;
  popularClass: "H" | "L" | null;
  menuClass: MenuEngineeringClass;
};

/**
 * Classifies every menu into Star / Horse / Puzzle / Dog using the same
 * thresholds as the original spreadsheet:
 *   - popularity threshold = (100 / count of menus with sales) * 0.8
 *   - profit threshold     = total profit / total qty sold (sales-weighted average)
 */
export function classifyMenuEngineering(menuCosts: MenuCost[]): MenuEngineeringRow[] {
  const withSales = menuCosts.filter((m) => m.menu.last_period_qty_sold > 0);
  const totalQtySold = withSales.reduce((sum, m) => sum + m.menu.last_period_qty_sold, 0);
  const totalProfit = withSales.reduce(
    (sum, m) => sum + m.profitPerUnit * m.menu.last_period_qty_sold,
    0
  );
  const countWithSales = withSales.length;

  const popularityThreshold = countWithSales > 0 ? (100 / countWithSales) * 0.8 : null;
  const profitThreshold = totalQtySold > 0 ? totalProfit / totalQtySold : null;

  return menuCosts.map((m) => {
    const qtySold = m.menu.last_period_qty_sold;
    const popularPct = qtySold > 0 && totalQtySold > 0 ? (qtySold / totalQtySold) * 100 : null;

    if (popularPct == null || popularityThreshold == null || profitThreshold == null) {
      return { ...m, qtySold, popularPct, profitClass: null, popularClass: null, menuClass: "Unranked" };
    }

    const profitClass: "H" | "L" = m.profitPerUnit > profitThreshold ? "H" : "L";
    const popularClass: "H" | "L" = popularPct > popularityThreshold ? "H" : "L";
    const menuClass: MenuEngineeringClass =
      profitClass === "H"
        ? popularClass === "H" ? "Star" : "Puzzle"
        : popularClass === "H" ? "Horse" : "Dog";

    return { ...m, qtySold, popularPct, profitClass, popularClass, menuClass };
  });
}
