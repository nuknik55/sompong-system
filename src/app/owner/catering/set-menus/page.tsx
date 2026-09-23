export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getCostingContext } from "@/lib/data";
import { computeMenuCost } from "@/lib/costing";
import { getCateringSetMenus } from "../actions";
import { SetMenusClient, type DishCostOption } from "./SetMenusClient";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { PageShell } from "@/components/ui/page";

// ── One of three places in the catering module allowed to compute/render cost ─
// (the others: [id]/cost/page.tsx, per-event food cost for the P&L page, and
// [id]/menu/page.tsx, per-set-line food cost on a booking's own menu — for
// owner and admin only, never computed for a sales session).
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
    <PageShell>
      <CateringSubNav isAdmin={true} />

      {/* The page header (title and + เพิ่มชุดเมนู) is in the client: the
          button opens its dialog. */}
      <SetMenusClient setMenus={setMenus} dishOptions={dishOptions} />
    </PageShell>
  );
}
