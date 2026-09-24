import "server-only";
import { requireAdmin } from "@/lib/auth";
import { getCostingContext } from "@/lib/data";
import { computeMenuCost } from "@/lib/costing";
import type { DishCostOption } from "./SetMenusClient";

/**
 * Every dish with its cost per portion, computed ONCE on the server by
 * computeMenuCost and shipped to the client as plain figures (never the raw
 * unit-cost map, as Menu Engineering does). Owner and admin only: the set
 * editor (set-menus/page.tsx) and the set-menu design workspace
 * (set-menus/design/page.tsx) read it; nothing a sales session reaches
 * imports this file.
 */
export async function getDishCostOptions(): Promise<DishCostOption[]> {
  await requireAdmin();
  const { menus, menuItems, unitCosts, qFactorPct } = await getCostingContext();
  return menus.map((menu) => {
    const cost = computeMenuCost(
      menu,
      menuItems.filter((it) => it.menu_id === menu.id),
      unitCosts,
      qFactorPct,
    );
    return {
      id: menu.id,
      name: menu.name,
      category: menu.category,
      selling_price: menu.selling_price,
      unit_cost: cost.totalCost,
      has_unknown_cost: cost.hasUnknownCost,
    };
  });
}
