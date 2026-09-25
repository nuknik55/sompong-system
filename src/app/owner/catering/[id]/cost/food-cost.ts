/**
 * A booking's food cost from its lines, for the cost page AND the cost lock:
 * ONE computation, so the figure on screen and the figure frozen by the lock
 * cannot disagree. Pure: the caller passes the cost of one portion of a menu
 * (computeMenuCost over the costing context) as `costOf`, so this file
 * imports no cost code itself and every rule below is a test.
 *
 * What it counts, and what it refuses to count (Nik, 2026-09-25):
 * - a dish line: its menu's cost × the line quantity;
 * - a set line: each course's cost × portions per set × the sets ordered. A
 *   course TYPED by name costs as the menu owner or admin linked it to; an
 *   unlinked one has no cost, so it is counted as a gap, never as ฿0;
 * - a set line with NO courses is a gap, never ฿0 (the 380 buffet set had
 *   none: its cost read as nothing and the margin as the whole price);
 * - a PER-HEAD line is left out of the figure and is a gap: its courses'
 *   quantities are per set, and nobody has said how many portions a guest
 *   eats (Nik's question 3 is open), so any figure would be invented;
 * - a menu that no longer exists is a gap, never silently skipped.
 * Any gap makes the figure incomplete (hasUnknownCost), and the page says
 * which kind and how many.
 */
import { recipeMenuId, isTypedDish, type EventMenuDish } from "../../menu-lines.ts";

export type PortionCost = { ingredientCost: number; qFactorAmount: number; totalCost: number; hasUnknownCost: boolean };

export type FoodCostLine = { id: string; menu_id: string | null; name: string; quantity: number; per_head?: boolean };

export type FoodCostItem = {
  name: string;
  quantity: number;
  unit_cost: number;
  q_factor_amount: number;
  total_cost: number;
  has_unknown_cost: boolean;
};

export type FoodCostGaps = {
  /** Typed courses with no link to a real menu. */
  typedWithoutCost: number;
  /** Set lines with no courses at all, by name. */
  emptySetLines: string[];
  /** Per-head lines, by name: left out of the figure. */
  perHeadLines: string[];
  /** Menus that could not be found. */
  missingMenus: number;
};

export type FoodCost = {
  ingredientCost: number;
  qFactorAmount: number;
  totalFoodCost: number;
  hasUnknownCost: boolean;
  lineItems: FoodCostItem[];
  gaps: FoodCostGaps;
};

export function eventFoodCost(
  lines: FoodCostLine[],
  dishesByLine: Map<string, { dishes: EventMenuDish[] }>,
  costOf: (menuId: string) => PortionCost | null,
): FoodCost {
  let ingredientCost = 0;
  let qFactorAmount = 0;
  let hasUnknownCost = false;
  const lineItems: FoodCostItem[] = [];
  const gaps: FoodCostGaps = { typedWithoutCost: 0, emptySetLines: [], perHeadLines: [], missingMenus: 0 };
  const gap = (name: string, quantity: number) => {
    hasUnknownCost = true;
    lineItems.push({ name, quantity, unit_cost: 0, q_factor_amount: 0, total_cost: 0, has_unknown_cost: true });
  };
  const add = (name: string, qty: number, cost: PortionCost) => {
    ingredientCost += cost.ingredientCost * qty;
    qFactorAmount += cost.qFactorAmount * qty;
    if (cost.hasUnknownCost) hasUnknownCost = true;
    lineItems.push({
      name, quantity: qty, unit_cost: cost.ingredientCost, q_factor_amount: cost.qFactorAmount * qty,
      total_cost: cost.totalCost * qty, has_unknown_cost: cost.hasUnknownCost,
    });
  };

  for (const em of lines) {
    if (em.menu_id) {
      const cost = costOf(em.menu_id);
      if (!cost) { gaps.missingMenus++; gap(em.name, em.quantity); continue; }
      add(em.name, em.quantity, cost);
      continue;
    }
    if (em.per_head) { gaps.perHeadLines.push(em.name); gap(em.name, em.quantity); continue; }
    const dishes = dishesByLine.get(em.id)?.dishes ?? [];
    if (dishes.length === 0) { gaps.emptySetLines.push(em.name); gap(em.name, em.quantity); continue; }
    for (const it of dishes) {
      const qty = it.quantity * em.quantity;
      const id = recipeMenuId(it);
      if (id == null) { gaps.typedWithoutCost++; gap(it.menu_name, qty); continue; }
      const cost = costOf(id);
      if (!cost) { if (isTypedDish(it)) gaps.typedWithoutCost++; else gaps.missingMenus++; gap(it.menu_name, qty); continue; }
      add(it.menu_name, qty, cost);
    }
  }
  return { ingredientCost, qFactorAmount, totalFoodCost: ingredientCost + qFactorAmount, hasUnknownCost, lineItems, gaps };
}

/**
 * A LOCKED booking's gaps, read back from its frozen line items: every item
 * the lock counted as ฿0 because its cost was not known (a typed dish with
 * no link, a per-head line, a set with no dishes, a menu no longer found).
 * The snapshot does not keep the kind, so this names the items (review,
 * 2026-09-25: the locked page said only "some items have no full cost").
 */
export function snapshotGapLines(items: FoodCostItem[]): string[] {
  const names = items.filter((i) => i.has_unknown_cost && i.total_cost === 0).map((i) => i.name);
  if (names.length === 0) return [];
  return [`ต้นทุนที่ล็อกไว้นับ ${names.length} รายการนี้เป็น ฿0 เพราะไม่ทราบต้นทุน: ${names.join(", ")} (เมนูที่พิมพ์เองที่ยังไม่ผูก ชุดราคาต่อท่าน ชุดที่ไม่มีรายการอาหาร หรือเมนูที่ไม่พบ)`];
}

/** The page's words for each kind of gap, in the order they matter; empty when there is none. */
export function foodCostGapLines(g: FoodCostGaps): string[] {
  const out: string[] = [];
  if (g.perHeadLines.length > 0) out.push(`ชุดราคาต่อท่าน ${g.perHeadLines.length} รายการ (${g.perHeadLines.join(", ")}) ไม่ได้นับในต้นทุนอาหาร — ยังไม่มีจำนวนต่อท่าน จึงคำนวณต้นทุนตามจริงไม่ได้`);
  if (g.emptySetLines.length > 0) out.push(`ชุดที่ยังไม่มีรายการอาหาร ${g.emptySetLines.length} รายการ (${g.emptySetLines.join(", ")}) — นับต้นทุนไม่ได้`);
  if (g.typedWithoutCost > 0) out.push(`มีเมนูที่พิมพ์เอง ${g.typedWithoutCost} รายการยังไม่มีต้นทุน (ผูกกับเมนูในระบบเพื่อให้คิดต้นทุนได้)`);
  if (g.missingMenus > 0) out.push(`มีเมนู ${g.missingMenus} รายการที่ไม่พบในระบบแล้ว`);
  return out;
}
