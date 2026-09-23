export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { eventMenuAccess } from "@/lib/event-menu-access";
import { getCostingContext } from "@/lib/data";
import { computeMenuCost } from "@/lib/costing";
import { getCateringEvent, getCateringEventMenus, getCateringCharges, getCateringDishOptions, getEventMenuDishes } from "../../actions";
import { buildEventMenuLines, buildEventMenuView, viewVersion, type DishCost } from "../../event-menu";
import { EventMenuClient } from "./EventMenuClient";
import { PageShell } from "@/components/ui/page";

/**
 * รายการอาหารของงาน — a booking's OWN menu (catering per-event menus).
 *
 * WHO SEES WHAT is decided in two places and nowhere else: eventMenuAccess()
 * for the role, and the booking's cost lock for the freeze. Sales views;
 * owner and admin edit; a locked booking is frozen for all three.
 *
 * THE COST IS COMPUTED ONLY FOR "edit". This is one of the few places in the
 * catering module allowed to call getCostingContext()/computeMenuCost() (with
 * set-menus/page.tsx and [id]/cost); for a sales session the branch below is
 * never entered, so nothing cost-shaped exists to serialise. What it ships is
 * a per-dish cost map — the screen holds edits until บันทึก and recomputes
 * the set's cost live from it — and buildEventMenuView drops that map for any
 * access but "edit" as the second lock; event-menu.test.ts holds a sales view
 * up to JSON.stringify to prove it.
 *
 * The editor is keyed on a fingerprint of the view: after a save the refresh
 * brings new data and a clean draft; a refresh that brings the same data
 * leaves the person's unsaved work alone.
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
  let dishCostById: Record<string, DishCost> | null = null;
  if (access === "edit") dishCostById = await computeDishCosts();

  const view = buildEventMenuView({ access, locked: event.cost_locked_at != null, lines, dishCostById });

  return (
    <PageShell>
      {/* Keyed on the booking: the editor deliberately holds its draft
          across server refreshes, so without this a client navigation from
          one booking menu to another would carry the first ones drafts
          into the second (review, 2026-09-20). */}
      <EventMenuClient
        key={id}
        eventId={id}
        version={viewVersion(view)}
        header={{ backHref: `/owner/catering/${id}`, backLabel: event.customer_name ?? "การจอง", status: event.status, date: event.event_date }}
        tableCount={event.table_count}
        view={view}
        dishOptions={dishOptions}
        quote={event.quote_number ? { number: event.quote_number, revision: event.quote_revision } : null}
      />
    </PageShell>
  );
}

/** Per dish: the food cost of one portion, from the same computeMenuCost every cost screen uses. */
async function computeDishCosts(): Promise<Record<string, DishCost>> {
  const { menus, menuItems, unitCosts, qFactorPct } = await getCostingContext();
  const out: Record<string, DishCost> = {};
  for (const menu of menus) {
    const c = computeMenuCost(menu, menuItems.filter((it) => it.menu_id === menu.id), unitCosts, qFactorPct);
    out[menu.id] = { unit_cost: c.totalCost, has_unknown_cost: c.hasUnknownCost };
  }
  return out;
}
