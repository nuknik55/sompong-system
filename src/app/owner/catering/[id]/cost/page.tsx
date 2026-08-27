export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getCostingContext } from "@/lib/data";
import { computeMenuCost } from "@/lib/costing";
import {
  getCateringEvent, getCateringEventMenus, getCateringCharges, getCateringSetMenuItems,
  getCateringEventLabor, getCateringTransferCostRates,
} from "../../actions";
import { getCateringEventCostSnapshot } from "./actions";
import { CostSummaryClient } from "./CostSummaryClient";

// ── One of two places in the catering module allowed to compute/render live
// cost (the other is set-menus/page.tsx, per-dish cost for the set-menu
// editor) — the third, ./actions.ts, is the lock/unlock write path and
// reuses this same computation. requireAdmin() runs before anything else in
// this file — a sales session gets redirected before any of the fetches
// below, let alone the cost computation, ever run. Never exported from
// actions.ts for reuse elsewhere.

export default async function CateringEventCostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [event, laborEntries, costRates, snapshot] = await Promise.all([
    getCateringEvent(id),
    getCateringEventLabor(id),
    getCateringTransferCostRates(),
    getCateringEventCostSnapshot(id),
  ]);

  if (!event) notFound();

  let revenue: number;
  let foodCost: number;
  let laborCost: number;
  let hasUnknownFoodCost: boolean;

  if (snapshot) {
    // Locked — read the frozen record instead of recomputing. Skips the
    // getCostingContext()/computeMenuCost() walk entirely; the numbers on
    // screen are exactly what lockCateringEventCost() wrote, not a fresh
    // live calculation that happens to currently agree with it.
    revenue = snapshot.revenue;
    foodCost = snapshot.total_food_cost;
    laborCost = snapshot.labor_cost;
    hasUnknownFoodCost = snapshot.has_unknown_cost;
  } else {
    const [eventMenus, charges, { menus, menuItems, unitCosts, qFactorPct }] = await Promise.all([
      getCateringEventMenus(id),
      getCateringCharges(id),
      getCostingContext(),
    ]);

    // Expand set_menu_id rows into their underlying dishes — a set's own
    // price_per_set is a sale price, not a cost; the real food cost is the
    // sum of what's actually inside it.
    const setMenuIds = [...new Set(eventMenus.filter((m) => m.set_menu_id).map((m) => m.set_menu_id as string))];
    const setItemsEntries = await Promise.all(setMenuIds.map(async (sid) => [sid, await getCateringSetMenuItems(sid)] as const));
    const setItemsBySet = new Map(setItemsEntries);
    const menuById = new Map(menus.map((m) => [m.id, m]));

    let computedFoodCost = 0;
    let computedHasUnknown = false;
    for (const em of eventMenus) {
      if (em.menu_id) {
        const menu = menuById.get(em.menu_id);
        if (!menu) continue;
        const cost = computeMenuCost(menu, menuItems.filter((it) => it.menu_id === menu.id), unitCosts, qFactorPct);
        computedFoodCost += cost.totalCost * em.quantity;
        if (cost.hasUnknownCost) computedHasUnknown = true;
      } else if (em.set_menu_id) {
        const items = setItemsBySet.get(em.set_menu_id) ?? [];
        for (const it of items) {
          const menu = menuById.get(it.menu_id);
          if (!menu) continue;
          const cost = computeMenuCost(menu, menuItems.filter((mi) => mi.menu_id === menu.id), unitCosts, qFactorPct);
          computedFoodCost += cost.totalCost * it.quantity * em.quantity;
          if (cost.hasUnknownCost) computedHasUnknown = true;
        }
      }
    }

    // Same formula ChargesSection already computes client-side from in-progress
    // edits — this is the server-side equivalent from the persisted rows, used
    // only until a quotation is actually issued.
    const liveChargesTotal = charges.reduce((s, c) => s + c.amount, 0);

    revenue = event.quoted_total ?? liveChargesTotal;
    foodCost = computedFoodCost;
    laborCost = laborEntries.reduce((s, l) => s + l.amount, 0);
    hasUnknownFoodCost = computedHasUnknown;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/owner/catering/${id}`} className="text-sm text-neutral-400 hover:text-neutral-700">
          ← {event.customer_name ?? "ไม่ระบุลูกค้า"}
        </Link>
        <span className="text-sm text-neutral-300">/</span>
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">ต้นทุน-กำไร</h1>
      </div>

      <CostSummaryClient
        eventId={id}
        eventStatus={event.status}
        quoteNumber={event.quote_number}
        laborEntries={laborEntries}
        costRates={costRates}
        revenue={revenue}
        foodCost={foodCost}
        laborCost={laborCost}
        hasUnknownFoodCost={hasUnknownFoodCost}
        snapshot={snapshot}
      />
    </div>
  );
}
