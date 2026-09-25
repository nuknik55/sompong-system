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

/**
 * One dish row of a trial set, as the set's dish table stores it: a menu
 * dish (menu_id) OR a dish typed by name (dish_name) that is not in the menu
 * list, which owner and admin may link to a real menu for its cost
 * (linked_menu_id) while the typed name still prints (Nik, 2026-09-25).
 */
export type DesignDish = {
  menu_id: string | null;
  dish_name?: string | null;
  linked_menu_id?: string | null;
  quantity: number;
  section: string;
  note: string | null;
};

/** The menu a row's cost comes from, or null for a typed dish with no link. */
export function designCostId(it: DesignDish): string | null {
  return it.menu_id ?? it.linked_menu_id ?? null;
}

/** The one key a row is compared by: its menu, or its typed name case-folded. */
export function designDishKey(it: Pick<DesignDish, "menu_id" | "dish_name">): string {
  return it.menu_id != null ? "m:" + it.menu_id : "t:" + (it.dish_name ?? "").trim().toLocaleLowerCase("th");
}

/** A typed dish, new: one portion, a dish, no link. */
export function typedDesignDish(name: string): DesignDish {
  return { menu_id: null, dish_name: name.trim(), linked_menu_id: null, quantity: 1, section: "dish", note: null };
}

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
  /** Typed dishes with no link: no cost at all, counted for the warning. */
  typedWithoutCost: number;
};

export const DESIGN_PRICE_MAX = 10_000_000;

export function designFigures(items: DesignDish[], pricePerTable: number, facts: Map<string, DishFacts>): DesignFigures {
  let cost = 0, dishes = 0, unknown = false, typedWithoutCost = 0;
  for (const it of items) {
    const id = designCostId(it);
    if (id == null) { unknown = true; typedWithoutCost++; continue; }
    const f = facts.get(id);
    if (!f) { unknown = true; continue; }
    cost += f.unit_cost * it.quantity;
    // A typed dish's link is for its cost only: it has no selling price.
    if (it.menu_id != null) dishes += f.selling_price * it.quantity;
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
    typedWithoutCost,
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
  const key = designDishKey(dish);
  const at = items.findIndex((it) => designDishKey(it) === key);
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
  // A typed dish swapped for a menu dish becomes that menu dish: its name and link go.
  const { dish_name: _name, linked_menu_id: _link, ...rest } = row;
  void _name; void _link;
  return addDish(removeDish(items, index), { ...rest, menu_id: menuId });
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
