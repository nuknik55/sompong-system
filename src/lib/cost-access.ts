/**
 * WHO SEES COST (Nik, 2026-09-26): owner and admin always; an editor whose
 * เห็นต้นทุน switch is on (the team page, set by the owner); nobody else —
 * staff, hr, sales, and an editor with the switch off.
 *
 * "Cost" is every figure built on a purchase price: the purchase price,
 * receive and yield quantities, the price history, POS receipt costs, a
 * prep's cost, a dish's cost, food-cost % and margin (the Star-to-Dog sort
 * is margin). The selling price is not a cost.
 *
 * This is the app's mirror of the database's public.can_see_cost(), which
 * decides the four ways cost leaves the database (the view ingredient_costs,
 * ingredient_price_history, pos_receipt_deliveries, prep_unit_costs();
 * sop_visibility_and_editor_cost_switch_migration.sql). The database is the
 * rule; this keeps a screen from offering what the database will not give,
 * and from treating a withheld price as a price of nothing.
 *
 * Pure, so every case is a test (cost-access.test.ts).
 */
export type CostViewer = { role: string | null | undefined; sees_cost?: boolean | null };

export function seesCost(p: CostViewer | null | undefined): boolean {
  if (!p) return false;
  if (p.role === "owner" || p.role === "admin") return true;
  if (p.role === "editor") return p.sees_cost === true;
  return false;
}

/** The ingredient columns that are cost: closed on `ingredients` itself, served by `ingredient_costs`. */
export const COST_FIELDS = ["purchase_cost", "receive_qty", "yield_qty"] as const;

/**
 * An ingredient write from someone who may not see cost carries no cost
 * field. Their screen never had the figures (the database withholds them),
 * so any it sends are not a price anyone read: an empty box sent back as
 * null would wipe the real price when an admin approves the request.
 */
export function withoutCostFields<T extends Record<string, unknown>>(fields: T): Omit<T, (typeof COST_FIELDS)[number]> {
  const out: Record<string, unknown> = { ...fields };
  for (const k of COST_FIELDS) delete out[k];
  return out as Omit<T, (typeof COST_FIELDS)[number]>;
}
