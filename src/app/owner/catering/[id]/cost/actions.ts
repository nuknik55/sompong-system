"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCostingContext } from "@/lib/data";
import { computeMenuCost } from "@/lib/costing";
import { eventFoodCost } from "./food-cost";
import { quoteIsStale, staleQuoteMessage } from "@/lib/quote-doc";
import {
  getCateringEvent, getCateringEventMenus, getCateringCharges, getEventMenuDishes,
  getCateringEventLabor,
} from "../../actions";

// ── Third file in the catering module allowed to import getCostingContext/
// computeMenuCost (the other two are [id]/cost/page.tsx and set-menus/page.tsx
// — see the comment in cost/page.tsx). Colocated with the cost page on
// purpose, and every export here is requireAdmin()-gated on its own — never
// imported from ../../actions or anywhere sales-reachable.

export type CateringEventCostSnapshotLineItem = {
  name: string;
  quantity: number;
  unit_cost: number;
  q_factor_amount: number;
  total_cost: number;
  has_unknown_cost: boolean;
};

export type CateringEventCostSnapshot = {
  event_id: string;
  snapshot_at: string;
  q_factor_pct: number;
  ingredient_cost: number;
  q_factor_amount: number;
  total_food_cost: number;
  revenue: number;
  gross_profit: number;
  food_cost_pct: number | null;
  has_unknown_cost: boolean;
  line_items: CateringEventCostSnapshotLineItem[];
  labor_cost: number;
  net_profit: number;
};

export async function getCateringEventCostSnapshot(eventId: string): Promise<CateringEventCostSnapshot | null> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_cost_snapshots")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data as CateringEventCostSnapshot | null;
}

/**
 * Freezes the P&L for a completed event. Writes catering_event_cost_snapshots
 * first, then sets catering_events.cost_locked_at — in that order. No
 * cross-table transaction is available through the REST API, so this relies
 * on idempotency rather than atomicity: the snapshot write is an upsert
 * keyed on event_id, so re-running this action after a failure between the
 * two steps (e.g. the process dying right after the snapshot write) just
 * overwrites the same row with freshly computed numbers and re-sets the
 * timestamp — safe to retry from either state.
 */
export type LockResult = { ok: true } | { ok: false; error: string };

export async function lockCateringEventCost(eventId: string): Promise<LockResult> {
  await requireAdmin();
  const supabase = await createClient();

  const [event, eventMenus, charges, laborEntries, { menus, menuItems, unitCosts, qFactorPct }] = await Promise.all([
    getCateringEvent(eventId),
    getCateringEventMenus(eventId),
    getCateringCharges(eventId),
    getCateringEventLabor(eventId),
    getCostingContext(),
  ]);
  // RETURNED, NOT THROWN. Production redacts a thrown Server Action message
  // to a digest, so a refusal the person is supposed to act on has to come
  // back as a value — the same reason saveBooking returns its refusals.
  if (!event) return { ok: false, error: "ไม่พบข้อมูลงาน" };
  if (event.status !== "done") return { ok: false, error: "ล็อกต้นทุนได้เฉพาะงานที่มีสถานะ \"เสร็จสิ้น\" เท่านั้น" };
  if (!event.quote_number) return { ok: false, error: "ต้องออกใบเสนอราคาก่อนจึงจะล็อกต้นทุนได้" };

  // THE QUOTATION MUST STILL DESCRIBE THE LINES (Nik, 2026-09-20).
  //
  // `revenue` below is `quoted_total ?? live`, and the snapshot freezes it
  // permanently. So between changing the lines and re-issuing the quotation
  // there is a window where revenue is the OLD total and the food cost is the
  // NEW one — remove a set and the profit is overstated by the whole set.
  // Locking in that window makes the error the permanent record, and the cost
  // page then reads the snapshot instead of recomputing, so nothing detects
  // it afterwards. The review of 2026-09-20 found it; this refuses it.
  //
  // IN THE APP this action is the only way the column is set, so there is no
  // second path around the check. AT THE DATABASE there is: the lock policies
  // let owner and admin UPDATE any column of catering_events, so a direct
  // PATCH can still stamp it. That is the same latitude those two roles have
  // everywhere else here, and the half-lock repair below is what makes it
  // recoverable rather than permanent.
  //
  // AN ALREADY-STAMPED BOOKING IS EXEMPT: re-running the lock is how a
  // half-written one is completed, and refusing that left the booking with no
  // way out at all — the lock refused for staleness, the cure refused by the
  // lock, and no unlock offered (review, 2026-09-20).
  const liveChargesTotal = charges.reduce((s, c) => s + c.amount, 0);
  if (!event.cost_locked_at && quoteIsStale(event.quoted_total, liveChargesTotal)) {
    return { ok: false, error: staleQuoteMessage(event.quoted_total as number, liveChargesTotal) };
  }

  // Same computation as [id]/cost/page.tsx's live path — see that file for
  // the set-menu-expansion reasoning (a set's price_per_set is a sale
  // price, not a cost; the real food cost sums what's actually inside it).
  // The booking's OWN copy of each set (catering per-event menus): the
  // snapshot freezes the cost of what was actually served.
  //
  // LOCKING FREEZES THE RECORD TOO. A set line from before the copy existed
  // still reads the SHARED set, which owner and admin keep editing — so a
  // locked booking's printed menu would drift while its P&L stood still, and
  // the lock itself would then refuse the cure (the review of 2026-09-19). So
  // each such line gets its copy HERE, while the booking is still unlocked
  // and the function's own lock check passes; the snapshot is then taken
  // from the copy. A function not yet installed (its migration unrun) is a
  // missing schema, tolerated: the snapshot falls back to the shared set as
  // before, and nothing is frozen that was not frozen already.
  // Skipped entirely when the booking is already stamped: the copy function
  // refuses a locked booking, so on a re-run to complete a half-written lock
  // this loop would throw before the snapshot could be written (review,
  // 2026-09-20). Nothing is lost — a stamped booking's lines are frozen.
  const before = await getEventMenuDishes(eventId);
  let copied = 0;
  for (const [lineId, served] of event.cost_locked_at ? [] : before) {
    if (served.source !== "shared") continue;
    const { data, error } = await supabase.rpc("catering_copy_set_menu", { p_event_menu_id: lineId });
    if (error) {
      const code = (error as { code?: string }).code ?? "";
      const missing = ["42883", "PGRST202"].includes(code) || /schema cache|does not exist/i.test(error.message);
      if (!missing) throw new Error(error.message);
      break; // no function anywhere yet: nothing more to try
    }
    if (typeof data === "number") copied += data;
  }
  const dishesByLine = copied > 0 ? await getEventMenuDishes(eventId) : before;
  const menuById = new Map(menus.map((m) => [m.id, m]));

  // The page's own computation (./food-cost.ts). The lock goes through with
  // gaps (Nik, 2026-09-25, Q5: typed dishes not yet linked); the snapshot
  // then records the figure as incomplete, each gap a line of ฿0 marked so.
  const food = eventFoodCost(eventMenus, dishesByLine, (menuId) => {
    const menu = menuById.get(menuId);
    return menu ? computeMenuCost(menu, menuItems.filter((it) => it.menu_id === menu.id), unitCosts, qFactorPct) : null;
  });
  const { ingredientCost, qFactorAmount, totalFoodCost, hasUnknownCost } = food;
  const lineItems: CateringEventCostSnapshotLineItem[] = food.lineItems;
  // Equal to liveChargesTotal by the guard above, unless nothing was ever issued.
  const revenue = event.quoted_total ?? liveChargesTotal;
  const laborCost = laborEntries.reduce((s, l) => s + l.amount, 0);
  const grossProfit = revenue - totalFoodCost;
  const netProfit = grossProfit - laborCost;
  const foodCostPct = revenue > 0 ? (totalFoodCost / revenue) * 100 : null;

  const { error: snapshotError } = await supabase.from("catering_event_cost_snapshots").upsert(
    {
      event_id: eventId,
      snapshot_at: new Date().toISOString(),
      q_factor_pct: qFactorPct,
      ingredient_cost: ingredientCost,
      q_factor_amount: qFactorAmount,
      total_food_cost: totalFoodCost,
      revenue,
      gross_profit: grossProfit,
      food_cost_pct: foodCostPct,
      has_unknown_cost: hasUnknownCost,
      line_items: lineItems,
      labor_cost: laborCost,
      net_profit: netProfit,
    },
    { onConflict: "event_id" },
  );
  if (snapshotError) throw snapshotError;

  const { error: lockError } = await supabase
    .from("catering_events")
    .update({ cost_locked_at: new Date().toISOString() })
    .eq("id", eventId);
  if (lockError) throw lockError;

  revalidatePath(`/owner/catering/${eventId}`);
  revalidatePath(`/owner/catering/${eventId}/cost`);
  return { ok: true };
}

/**
 * Reverses lockCateringEventCost: deletes the snapshot row first, then
 * clears cost_locked_at — same ordering/idempotency reasoning as the lock
 * action above. A retry after a partial failure just re-deletes (a no-op if
 * the row is already gone) and re-clears (also a no-op if already null).
 */
export async function unlockCateringEventCost(eventId: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("catering_event_cost_snapshots")
    .delete()
    .eq("event_id", eventId);
  if (deleteError) throw deleteError;

  const { error: unlockError } = await supabase
    .from("catering_events")
    .update({ cost_locked_at: null })
    .eq("id", eventId);
  if (unlockError) throw unlockError;

  revalidatePath(`/owner/catering/${eventId}`);
  revalidatePath(`/owner/catering/${eventId}/cost`);
}
