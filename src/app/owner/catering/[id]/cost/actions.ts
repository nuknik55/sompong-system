"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCostingContext } from "@/lib/data";
import { computeMenuCost } from "@/lib/costing";
import {
  getCateringEvent, getCateringEventMenus, getCateringCharges, getCateringSetMenuItems,
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
export async function lockCateringEventCost(eventId: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const [event, eventMenus, charges, laborEntries, { menus, menuItems, unitCosts, qFactorPct }] = await Promise.all([
    getCateringEvent(eventId),
    getCateringEventMenus(eventId),
    getCateringCharges(eventId),
    getCateringEventLabor(eventId),
    getCostingContext(),
  ]);
  if (!event) throw new Error("ไม่พบข้อมูลงาน");
  if (event.status !== "done") throw new Error("ล็อกต้นทุนได้เฉพาะงานที่มีสถานะ \"เสร็จสิ้น\" เท่านั้น");
  if (!event.quote_number) throw new Error("ต้องออกใบเสนอราคาก่อนจึงจะล็อกต้นทุนได้");

  // Same computation as [id]/cost/page.tsx's live path — see that file for
  // the set-menu-expansion reasoning (a set's price_per_set is a sale
  // price, not a cost; the real food cost sums what's actually inside it).
  const setMenuIds = [...new Set(eventMenus.filter((m) => m.set_menu_id).map((m) => m.set_menu_id as string))];
  const setItemsEntries = await Promise.all(setMenuIds.map(async (sid) => [sid, await getCateringSetMenuItems(sid)] as const));
  const setItemsBySet = new Map(setItemsEntries);
  const menuById = new Map(menus.map((m) => [m.id, m]));

  let ingredientCost = 0;
  let qFactorAmount = 0;
  let hasUnknownCost = false;
  const lineItems: CateringEventCostSnapshotLineItem[] = [];

  for (const em of eventMenus) {
    if (em.menu_id) {
      const menu = menuById.get(em.menu_id);
      if (!menu) continue;
      const cost = computeMenuCost(menu, menuItems.filter((it) => it.menu_id === menu.id), unitCosts, qFactorPct);
      ingredientCost += cost.ingredientCost * em.quantity;
      qFactorAmount += cost.qFactorAmount * em.quantity;
      if (cost.hasUnknownCost) hasUnknownCost = true;
      lineItems.push({
        name: menu.name, quantity: em.quantity,
        unit_cost: cost.ingredientCost, q_factor_amount: cost.qFactorAmount * em.quantity,
        total_cost: cost.totalCost * em.quantity, has_unknown_cost: cost.hasUnknownCost,
      });
    } else if (em.set_menu_id) {
      const items = setItemsBySet.get(em.set_menu_id) ?? [];
      for (const it of items) {
        const menu = menuById.get(it.menu_id);
        if (!menu) continue;
        const qty = it.quantity * em.quantity;
        const cost = computeMenuCost(menu, menuItems.filter((mi) => mi.menu_id === menu.id), unitCosts, qFactorPct);
        ingredientCost += cost.ingredientCost * qty;
        qFactorAmount += cost.qFactorAmount * qty;
        if (cost.hasUnknownCost) hasUnknownCost = true;
        lineItems.push({
          name: menu.name, quantity: qty,
          unit_cost: cost.ingredientCost, q_factor_amount: cost.qFactorAmount * qty,
          total_cost: cost.totalCost * qty, has_unknown_cost: cost.hasUnknownCost,
        });
      }
    }
  }

  const totalFoodCost = ingredientCost + qFactorAmount;
  const liveChargesTotal = charges.reduce((s, c) => s + c.amount, 0);
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
