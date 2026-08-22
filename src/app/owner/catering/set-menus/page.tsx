export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getCostingContext } from "@/lib/data";
import { computeMenuCost } from "@/lib/costing";
import { getCateringSetMenus } from "../actions";
import { SetMenusClient, type DishCostOption } from "./SetMenusClient";

// ── The one place in the catering module allowed to compute/render cost ────
// Every other catering page/action deliberately avoids getCostingContext() /
// computeMenuCost() so there is no code path a sales session could reach that
// touches ingredients/menu_recipe_items. This page is guarded by
// requireAdmin() and its cost computation lives only here — never exported
// from actions.ts for reuse elsewhere in the module.

export default async function SetMenusPage() {
  await requireAdmin();

  const [setMenus, { menus, menuItems, unitCosts, qFactorPct }] = await Promise.all([
    getCateringSetMenus(),
    getCostingContext(),
  ]);

  // Per-dish cost, computed once here, shipped to the client as plain data —
  // not the raw unitCosts Map (Menu Engineering never ships that client-side
  // either; only its already-computed results cross the RSC boundary).
  const dishOptions: DishCostOption[] = menus.map((menu) => {
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

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/owner/catering" className="text-sm text-neutral-400 hover:text-neutral-700">← จองงานจัดเลี้ยง</Link>
        <span className="text-sm text-neutral-300">/</span>
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">จัดการชุดเมนู</h1>
      </div>
      <SetMenusClient initialSetMenus={setMenus} dishOptions={dishOptions} />
    </div>
  );
}
