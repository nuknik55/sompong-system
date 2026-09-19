export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { eventMenuAccess } from "@/lib/event-menu-access";
import { getCostingContext } from "@/lib/data";
import { computeMenuCost } from "@/lib/costing";
import { getCateringEvent, getCateringEventMenus, getCateringCharges, getCateringDishOptions, getEventMenuDishes } from "../../actions";
import { thFullDate, StatusBadge } from "../../shared-utils";
import { buildEventMenuLines, buildEventMenuView, foodCostFigure, type EventMenuCost, type EventMenuLine } from "../../event-menu";
import { EventMenuClient } from "./EventMenuClient";

/**
 * รายการอาหารของงาน — a booking's OWN menu (catering per-event menus, round 1).
 *
 * WHO SEES WHAT is decided in two places and nowhere else: eventMenuAccess()
 * for the role, and the booking's cost lock for the freeze. Sales views;
 * owner and admin edit; a locked booking is frozen for all three.
 *
 * THE COST IS COMPUTED ONLY FOR "edit". This is one of the few places in the
 * catering module allowed to call getCostingContext()/computeMenuCost() (with
 * set-menus/page.tsx and [id]/cost); for a sales session the branch below is
 * never entered, so nothing cost-shaped exists to serialise. buildEventMenuView
 * then drops a cost for any access but "edit" as the second lock, and
 * event-menu.test.ts holds a sales view up to JSON.stringify to prove it.
 */
export default async function EventMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireSales();
  const access = eventMenuAccess(profile.role);
  if (access === "none") redirect("/owner");
  const { id } = await params;

  const [event, eventMenus, charges, dishesByLine, dishOptions] = await Promise.all([
    getCateringEvent(id),
    getCateringEventMenus(id),
    getCateringCharges(id),
    getEventMenuDishes(id),
    getCateringDishOptions(),
  ]);
  if (!event) notFound();

  const lines = buildEventMenuLines(eventMenus, charges, dishesByLine);

  // Owner and admin only. Not "computed and hidden": not computed.
  let costByLine: Record<string, EventMenuCost> | null = null;
  if (access === "edit") costByLine = await computeEventMenuCosts(lines);

  const view = buildEventMenuView({ access, locked: event.cost_locked_at != null, lines, costByLine });

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/owner/catering/${id}`} className="text-sm text-neutral-400 hover:text-neutral-700">← {event.customer_name ?? "การจอง"}</Link>
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">รายการอาหารของงาน</h1>
          <StatusBadge status={event.status} />
          <span className="text-sm text-neutral-500">{thFullDate(event.event_date)}</span>
        </div>
      </div>
      <EventMenuClient
        eventId={id}
        tableCount={event.table_count}
        view={view}
        dishOptions={dishOptions}
      />
    </div>
  );
}

/** Per set line: the food cost of one table, from the same computeMenuCost every cost screen uses. */
async function computeEventMenuCosts(lines: EventMenuLine[]): Promise<Record<string, EventMenuCost>> {
  const { menus, menuItems, unitCosts, qFactorPct } = await getCostingContext();
  const menuById = new Map(menus.map((m) => [m.id, m]));
  const out: Record<string, EventMenuCost> = {};
  for (const line of lines) {
    let costPerTable = 0;
    let hasUnknownCost = false;
    for (const d of line.dishes) {
      const menu = menuById.get(d.menu_id);
      if (!menu) { hasUnknownCost = true; continue; }
      const c = computeMenuCost(menu, menuItems.filter((it) => it.menu_id === menu.id), unitCosts, qFactorPct);
      costPerTable += c.totalCost * d.quantity;
      if (c.hasUnknownCost) hasUnknownCost = true;
    }
    out[line.id] = { costPerTable, pct: foodCostFigure(costPerTable, line.pricePerTable).pct, hasUnknownCost };
  }
  return out;
}
