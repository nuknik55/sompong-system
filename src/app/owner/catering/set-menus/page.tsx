export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getCateringSetMenus } from "../actions";
import { getDishCostOptions } from "./dish-costs";
import { SetMenusClient } from "./SetMenusClient";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { PageShell } from "@/components/ui/page";

// ── One of the places in the catering module allowed to compute/render cost ──
// (the others: [id]/cost/page.tsx, per-event food cost for the P&L page,
// [id]/menu/page.tsx, per-set-line food cost on a booking's own menu, and
// set-menus/design/page.tsx, the set-menu design workspace — for owner and
// admin only, never computed for a sales session).
// Every other catering page/action deliberately avoids getCostingContext() /
// computeMenuCost() so there is no code path a sales session could reach that
// touches ingredients/menu_recipe_items. This page is guarded by
// requireAdmin(); its per-dish cost comes from dish-costs.ts (server-only,
// requireAdmin, shared with the design workspace so both show the same
// figures) — never exported from actions.ts for reuse elsewhere in the module.

export default async function SetMenusPage() {
  await requireAdmin();

  // Per-dish cost, computed once on the server, shipped to the client as
  // plain data — not the raw unitCosts Map (Menu Engineering never ships that
  // client-side either; only its already-computed results cross the RSC
  // boundary).
  const [setMenus, dishOptions] = await Promise.all([getCateringSetMenus(), getDishCostOptions()]);

  return (
    <PageShell>
      <CateringSubNav isAdmin={true} />

      {/* The page header (title and + เพิ่มชุดเมนู) is in the client: the
          button opens its dialog. */}
      <SetMenusClient setMenus={setMenus} dishOptions={dishOptions} />
    </PageShell>
  );
}
