"use server";

import { revalidatePath } from "next/cache";
import { requireOrdering } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Supply orders (README item 35). EVERY write goes through a database
 * function of supply_order_approval_migration.sql, under the caller's own
 * session: the function checks the role, the status and the creator itself
 * and refuses with a message the screen shows as it is. Direct table writes
 * are closed for every app role, and nothing here uses the service role.
 * requireOrdering() keeps hr and sales out at the route as well (decision 9).
 */

export type ActionResult = { error?: string; sessionId?: string };

export type OrderItemInput = {
  ingredientId: string;
  ingredientName: string;
  remainingKitchenQty: number | null;
  remainingKitchenUnit: string | null;
  remainingFreezerQty: number | null;
  remainingFreezerUnit: string | null;
  packCount: number | null;
  qtyPerPack: number | null;
  qtyOrdered: number;
  orderUnit: string | null;
  note: string | null;
};

function revalidateOrders(sessionId?: string) {
  revalidatePath("/staff/inventory");
  revalidatePath("/staff/inventory/review");
  revalidatePath("/staff/inventory/purchase");
  revalidatePath("/staff/inventory/receive-queue");
  revalidatePath("/staff/inventory/history");
  if (sessionId) revalidatePath(`/staff/inventory/${sessionId}`);
}

/** Staff (or any orderer) places an order: the caller is its creator. */
export async function createOrderSession(
  stationId: string | null,
  note: string | null,
  items: OrderItemInput[]
): Promise<ActionResult> {
  await requireOrdering();
  const supabase = await createClient();

  const filtered = items.filter(
    (i) => i.qtyOrdered > 0 || i.remainingKitchenQty !== null || i.remainingFreezerQty !== null
  );
  if (filtered.length === 0) {
    return { error: "กรุณากรอกข้อมูลอย่างน้อย 1 รายการ (คงเหลือ หรือ จำนวนสั่ง)" };
  }

  const { data, error } = await supabase.rpc("order_create", {
    p_station_id: stationId || null,
    p_note: note || null,
    p_items: filtered.map((item) => ({
      ingredient_id: item.ingredientId,
      ingredient_name: item.ingredientName,
      remaining_kitchen_qty: item.remainingKitchenQty,
      remaining_kitchen_unit: item.remainingKitchenUnit,
      remaining_freezer_qty: item.remainingFreezerQty,
      remaining_freezer_unit: item.remainingFreezerUnit,
      pack_count: item.packCount,
      qty_per_pack: item.qtyPerPack,
      qty_ordered: item.qtyOrdered,
      order_unit: item.orderUnit,
      note: item.note,
    })),
  });
  if (error) return { error: error.message };
  if (typeof data !== "string" || !data) return { error: "สร้างรายการไม่สำเร็จ" };

  revalidateOrders(data);
  return { sessionId: data };
}

/**
 * A head approves WITH the quantities, in one database transaction
 * (order_review_approve, order_review_approve_migration.sql): every line is
 * checked first, each head quantity that changes is logged, then the order is
 * reviewed — or nothing is written and the message says why. `version` is
 * the order as the head's screen read it; a stale one is refused (Nik,
 * 2026-09-23: approval ends in exactly one of two states).
 */
export async function approveOrderSession(
  sessionId: string,
  version: number,
  lines: { itemId: string; qty: number }[],
): Promise<ActionResult> {
  await requireOrdering();
  if (lines.some((l) => !Number.isFinite(l.qty) || l.qty < 0)) {
    return { error: "จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป ยังไม่ได้อนุมัติ" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("order_review_approve", {
    p_session: sessionId,
    p_seen_version: version,
    p_lines: lines.map((l) => ({ id: l.itemId, qty: l.qty })),
  });
  if (error) return { error: error.message };
  revalidateOrders(sessionId);
  return {};
}

/**
 * A head returns the order to its creator, until it is sent (decision 7).
 * Both notes are kept. The head says what to fix (Nik, 2026-09-23): a return
 * with no note is refused here.
 */
export async function returnOrderSession(sessionId: string, note: string): Promise<ActionResult> {
  await requireOrdering();
  if (!note.trim()) return { error: "กรุณาระบุว่าต้องแก้อะไร ก่อนตีกลับ" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("order_return", { p_session: sessionId, p_note: note.trim() });
  if (error) return { error: error.message };
  revalidateOrders(sessionId);
  return {};
}

export type OrderItemUpdate = {
  itemId: string;
  remainingKitchenQty: number | null;
  remainingKitchenUnit: string | null;
  remainingFreezerQty: number | null;
  remainingFreezerUnit: string | null;
  qtyOrdered: number;
  orderUnit: string | null;
};

/**
 * The creator edits the lines while the order waits for review or after a
 * return (decision 6); with `resubmit`, a returned order goes back to
 * waiting. Only the creator: the database checks it (decision 14).
 */
export async function updateOrderItems(
  sessionId: string,
  items: OrderItemUpdate[],
  resubmit: boolean
): Promise<ActionResult> {
  await requireOrdering();
  const supabase = await createClient();
  const { error } = await supabase.rpc("order_edit", {
    p_session: sessionId,
    p_items: items.map((item) => ({
      id: item.itemId,
      remaining_kitchen_qty: item.remainingKitchenQty,
      remaining_kitchen_unit: item.remainingKitchenUnit,
      remaining_freezer_qty: item.remainingFreezerQty,
      remaining_freezer_unit: item.remainingFreezerUnit,
      qty_ordered: item.qtyOrdered,
      order_unit: item.orderUnit,
    })),
    p_resubmit: resubmit,
  });
  if (error) return { error: error.message };
  revalidateOrders(sessionId);
  return {};
}

/** Admin or owner records that the supplier was called (decision 5). */
export async function markOrderSent(sessionId: string): Promise<ActionResult> {
  await requireOrdering();
  const supabase = await createClient();
  const { error } = await supabase.rpc("order_mark_sent", { p_session: sessionId });
  if (error) return { error: error.message };
  revalidateOrders(sessionId);
  return {};
}

/**
 * Receiving, line by line (decision 8). The database records who received
 * each line and closes the order itself when every line has a quantity; a
 * refused line stops here with its message and nothing is marked received
 * behind it.
 */
export async function receiveOrderItems(
  sessionId: string,
  received: { itemId: string; qtyReceived: number | null }[]
): Promise<ActionResult> {
  await requireOrdering();
  const supabase = await createClient();

  for (const { itemId, qtyReceived } of received) {
    const { error } = await supabase.rpc("receive_order_item", { item_id: itemId, qty: qtyReceived });
    if (error) return { error: error.message };
  }

  revalidateOrders(sessionId);
  return {};
}

/** Cancel instead of delete (decision 10); the database decides who may, and when. */
export async function cancelOrderSession(sessionId: string, note?: string): Promise<ActionResult> {
  await requireOrdering();
  const supabase = await createClient();
  const { error } = await supabase.rpc("order_cancel", { p_session: sessionId, p_note: note?.trim() || null });
  if (error) return { error: error.message };
  revalidateOrders(sessionId);
  return {};
}
