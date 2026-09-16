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
  par_level?: number | null;
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
  last_period_qty_sold: number;
  staff_visible: boolean;
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

/** prep_recipe_id -> cost per usage unit, from public.prep_unit_costs(). */
export type PrepUnitCostMap = Map<string, number | null>;

/**
 * Resolves a unit cost for every ingredient.
 *
 * THE PREP NESTING RULE IS NOT HERE ANY MORE. It used to be a multi-pass
 * fixpoint in this function; it now lives in public.prep_unit_costs(), and
 * this takes the answer as an argument. That is not tidying — it is what
 * makes prep visibility possible at all: RLS hides prep_recipe_items from a
 * user who has not been granted the recipe, so a resolver that read those
 * rows would compute null for them and 112 of 244 dishes would report an
 * incomplete cost to exactly the people who are supposed to keep working.
 * A cost is a number and a recipe is a list; only the list is restricted.
 *
 * Do not "restore" the fixpoint here. Two implementations of the same
 * arithmetic is precisely the failure the SQL side was chosen to avoid, and
 * scripts/verify-prep-unit-costs.mjs exists to prove the one that remains
 * still agrees with it.
 *
 * An ingredient is `null` when its cost is unknown — unpriced, or a prep the
 * function could not price. Never 0: a dish with an unknown component must
 * read as incomplete, not as cheap.
 */
export function resolveUnitCosts(
  ingredients: IngredientRow[],
  prepUnitCosts: PrepUnitCostMap
): UnitCostMap {
  const costs: UnitCostMap = new Map();
  for (const ing of ingredients) {
    if (!ing.is_prep) {
      costs.set(ing.id, rawUnitCost(ing));
      continue;
    }
    // A prep with no prep_recipe_id is an orphan, and a prep_recipe_id absent
    // from the map is one the function returned no row for. Both are unknown.
    costs.set(ing.id, ing.prep_recipe_id ? prepUnitCosts.get(ing.prep_recipe_id) ?? null : null);
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
 * tracking it per dish badly distorts cheap, quick-cook items. The old
 * per-dish menus.fuel_cost column was dropped once this replaced it.
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

/**
 * A category needs at least this many dishes WITH SALES before its dishes are
 * ranked against each other (Nik, 2026-09-16). Below it, an average of two or
 * four dishes is not a benchmark, and a verdict would be invented.
 */
export const MIN_RANKABLE_GROUP = 5;

/** Why a dish carries no Star/Horse/Puzzle/Dog. The UI must say which. */
export type UnrankedReason =
  | { kind: "no_sales" }
  | { kind: "small_group"; group: string | null; dishesWithSales: number; minimum: number };

export type CategoryRankedRow = MenuEngineeringRow & {
  /** menus.category, the group the dish was ranked in (null = no category). */
  group: string | null;
  /** null exactly when menuClass is a real class. */
  unrankedReason: UnrankedReason | null;
};

/**
 * Star / Horse / Puzzle / Dog WITHIN each category, merged back in input order.
 * Queue item 5, decided by Nik 2026-09-16.
 *
 * Why: one global pool compared every dish against a single profit bar
 * (฿165.08 a unit on 2026-09-16) while category bars ran from ฿62.84
 * (อาหารจานเดียว) to ฿292.99 (ปู กั้ง). The pool was sorting dishes by PRICE
 * TIER: 27 of 43 one-plate dishes read as Dogs globally, 8 within their own
 * category. The premise first recorded for this item (drinks lifting the
 * average) was wrong; there are no drinks in `menus`.
 *
 * A category with fewer than `minimum` dishes with sales is NOT ranked and
 * not pooled with a neighbour: every dish in it is "Unranked" with a
 * small_group reason, so the screen can say "below the minimum" rather than
 * leave a blank that reads as "no data". A dish with no sales is Unranked
 * with no_sales, whichever group it is in.
 *
 * Both /owner (every tab) and /staff use this, over ALL menus, so a dish has
 * one verdict wherever it is shown.
 */
export function classifyWithinCategory(
  menuCosts: MenuCost[],
  minimum: number = MIN_RANKABLE_GROUP,
): CategoryRankedRow[] {
  const groups = new Map<string | null, MenuCost[]>();
  for (const m of menuCosts) {
    const key = m.menu.category ?? null;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }

  const byMenu = new Map<MenuCost, CategoryRankedRow>();
  for (const [group, members] of groups) {
    const dishesWithSales = members.filter((m) => m.menu.last_period_qty_sold > 0).length;
    const rankable = dishesWithSales >= minimum;
    classifyMenuEngineering(members).forEach((row, i) => {
      const noSales = row.qtySold <= 0;
      const unrankedReason: UnrankedReason | null = noSales
        ? { kind: "no_sales" }
        : rankable
          ? null
          : { kind: "small_group", group, dishesWithSales, minimum };
      byMenu.set(
        members[i]!,
        unrankedReason
          ? { ...row, profitClass: null, popularClass: null, menuClass: "Unranked", group, unrankedReason }
          : { ...row, group, unrankedReason },
      );
    });
  }
  return menuCosts.map((m) => byMenu.get(m)!);
}

/** The Thai sentence for an unranked dish, shared by every screen. */
export function unrankedReasonText(reason: UnrankedReason): string {
  if (reason.kind === "no_sales") return "ยังไม่มียอดขาย";
  const where = reason.group ? `หมวด "${reason.group}"` : "เมนูที่ไม่มีหมวด";
  return `${where} มีเมนูที่มียอดขาย ${reason.dishesWithSales} รายการ — ต้องมีอย่างน้อย ${reason.minimum} จึงจะจัดอันดับได้`;
}
