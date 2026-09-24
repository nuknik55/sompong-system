/**
 * THE SET-MENU DESIGN WORKSPACE (Nik, 2026-09-24): trial sets side by side,
 * their cost against their price, and the moves that build them — add, swap,
 * copy or move a dish between trial sets. Owner and admin only, since it
 * shows cost; a trial set is a catering_set_menus row with is_draft = true,
 * which the database hides from sales and keeps off every booking.
 *
 * The figures are the existing set editor's (set-menus/SetMenusClient.tsx):
 * the cost per table is Σ portions × the dish's cost per portion, computed
 * once on the server by computeMenuCost; the price per table is the set's
 * price; the à-la-carte total is Σ portions × the dish's selling price.
 * Pure, so every figure and move is a test.
 */

/** One dish row of a trial set, as the set's dish table stores it. */
export type DesignDish = { menu_id: string; quantity: number; section: string; note: string | null };

/** What the page knows about a dish: its name, its price, and its cost per portion. */
export type DishFacts = { name: string; selling_price: number; unit_cost: number; has_unknown_cost: boolean };

export type DesignFigures = {
  /** Σ portions × cost per portion. */
  costPerTable: number;
  pricePerTable: number;
  /** cost ÷ price, as a percentage; null without a price. */
  foodCostPct: number | null;
  /** price − cost. */
  margin: number;
  /** Σ portions × selling price: the same dishes bought singly. */
  dishesTotal: number;
  /** A dish whose cost the recipes cannot tell: its figure is a floor, not the cost. */
  hasUnknownCost: boolean;
};

export const DESIGN_PRICE_MAX = 10_000_000;

export function designFigures(items: DesignDish[], pricePerTable: number, facts: Map<string, DishFacts>): DesignFigures {
  let cost = 0, dishes = 0, unknown = false;
  for (const it of items) {
    const f = facts.get(it.menu_id);
    if (!f) { unknown = true; continue; }
    cost += f.unit_cost * it.quantity;
    dishes += f.selling_price * it.quantity;
    if (f.has_unknown_cost) unknown = true;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    costPerTable: round2(cost),
    pricePerTable: pricePerTable,
    foodCostPct: pricePerTable > 0 ? round2((cost / pricePerTable) * 100) : null,
    margin: round2(pricePerTable - cost),
    dishesTotal: round2(dishes),
    hasUnknownCost: unknown,
  };
}

/** The price typed for a trial set: a number from 0 to DESIGN_PRICE_MAX, or null. */
export function parseDesignPrice(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n <= DESIGN_PRICE_MAX ? n : null;
}

/**
 * Adds a dish. A set holds each dish once (the table's UNIQUE (set, dish)),
 * so a dish already in it gains the portions instead of a second row.
 */
export function addDish(items: DesignDish[], dish: DesignDish): DesignDish[] {
  const at = items.findIndex((it) => it.menu_id === dish.menu_id);
  if (at < 0) return [...items, { ...dish }];
  return items.map((it, i) => (i === at ? { ...it, quantity: roundQty(it.quantity + dish.quantity) } : it));
}

export function removeDish(items: DesignDish[], index: number): DesignDish[] {
  return items.filter((_, i) => i !== index);
}

/**
 * Swaps the dish at `index` for another, keeping its portions, section and
 * note. Swapping to a dish the set already holds merges the two rows.
 */
export function swapDish(items: DesignDish[], index: number, menuId: string): DesignDish[] {
  const row = items[index];
  if (!row || row.menu_id === menuId) return items;
  return addDish(removeDish(items, index), { ...row, menu_id: menuId });
}

/** Copies the dish at `index` of `from` into `to`; returns the new `to`. */
export function copyDish(from: DesignDish[], index: number, to: DesignDish[]): DesignDish[] {
  const row = from[index];
  return row ? addDish(to, row) : to;
}

/** Moves the dish at `index` of `from` into `to`; returns [the new from, the new to]. */
export function moveDish(from: DesignDish[], index: number, to: DesignDish[]): [DesignDish[], DesignDish[]] {
  const row = from[index];
  if (!row) return [from, to];
  return [removeDish(from, index), addDish(to, row)];
}

/** Portions to three decimals, as the sheets print them. */
function roundQty(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** At most this many trial sets side by side on a desktop. */
export const DESIGN_MAX_COLUMNS = 4;
