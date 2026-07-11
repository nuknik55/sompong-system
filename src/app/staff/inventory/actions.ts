"use server";

import { revalidatePath } from "next/cache";
import { requireProfile, requireAdminOrEditor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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

export async function createOrderSession(
  stationId: string | null,
  note: string | null,
  items: OrderItemInput[]
): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const filtered = items.filter(
    (i) =>
      i.qtyOrdered > 0 ||
      i.remainingKitchenQty !== null ||
      i.remainingFreezerQty !== null
  );
  if (filtered.length === 0) {
    return { error: "กรุณากรอกข้อมูลอย่างน้อย 1 รายการ (คงเหลือ หรือ จำนวนสั่ง)" };
  }

  const { data: session, error: sessionErr } = await supabase
    .from("order_sessions")
    .insert({
      station_id: stationId || null,
      note: note || null,
      created_by: profile.id,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (sessionErr || !session) {
    return { error: sessionErr?.message ?? "สร้างรายการไม่สำเร็จ" };
  }

  const { error: itemsErr } = await supabase.from("order_items").insert(
    filtered.map((item, idx) => ({
      session_id: session.id,
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
      sort_order: idx,
    }))
  );

  if (itemsErr) {
    await supabase.from("order_sessions").delete().eq("id", session.id);
    return { error: itemsErr.message };
  }

  revalidatePath("/staff/inventory");
  revalidatePath("/staff/inventory/review");
  revalidatePath("/staff/inventory/purchase");
  revalidatePath("/staff/inventory/receive-queue");
  revalidatePath("/staff/inventory/history");
  revalidatePath(`/staff/inventory/${session.id}`);
  return { sessionId: session.id };
}

/** Editor+ ตรวจสอบใบสั่งของ: submitted → reviewed */
export async function reviewOrderSession(sessionId: string): Promise<ActionResult> {
  const profile = await requireAdminOrEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("order_sessions")
    .update({
      status: "reviewed",
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", "submitted");
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory");
  revalidatePath("/staff/inventory/review");
  revalidatePath("/staff/inventory/purchase");
  revalidatePath("/staff/inventory/receive-queue");
  revalidatePath("/staff/inventory/history");
  revalidatePath(`/staff/inventory/${sessionId}`);
  return {};
}

/** Editor+ ตีกลับ — ใช้ได้จากทั้ง submitted และ reviewed */
export async function returnOrderSession(
  sessionId: string,
  note?: string
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("order_sessions")
    .update({
      status: "returned",
      ...(note ? { note } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .in("status", ["submitted", "reviewed"]);
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory");
  revalidatePath("/staff/inventory/review");
  revalidatePath("/staff/inventory/purchase");
  revalidatePath("/staff/inventory/receive-queue");
  revalidatePath("/staff/inventory/history");
  revalidatePath(`/staff/inventory/${sessionId}`);
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

/** Creator or editor+ edits items in a returned session and resubmits */
export async function updateItemsAndResubmit(
  sessionId: string,
  items: OrderItemUpdate[]
): Promise<ActionResult> {
  await requireProfile();
  const supabase = createAdminClient();

  const { data: session } = await supabase
    .from("order_sessions")
    .select("created_by, status")
    .eq("id", sessionId)
    .single();

  if (!session || session.status !== "returned") {
    return { error: "ไม่สามารถแก้ไขได้ (สถานะไม่ใช่ 'ตีกลับ')" };
  }

  for (const item of items) {
    const { error } = await supabase
      .from("order_items")
      .update({
        remaining_kitchen_qty: item.remainingKitchenQty,
        remaining_kitchen_unit: item.remainingKitchenUnit,
        remaining_freezer_qty: item.remainingFreezerQty,
        remaining_freezer_unit: item.remainingFreezerUnit,
        qty_ordered: item.qtyOrdered,
        order_unit: item.orderUnit,
      })
      .eq("id", item.itemId)
      .eq("session_id", sessionId);
    if (error) return { error: error.message };
  }

  const { error } = await supabase
    .from("order_sessions")
    .update({ status: "submitted", submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) return { error: error.message };

  revalidatePath("/staff/inventory");
  revalidatePath("/staff/inventory/review");
  revalidatePath("/staff/inventory/purchase");
  revalidatePath("/staff/inventory/receive-queue");
  revalidatePath("/staff/inventory/history");
  revalidatePath(`/staff/inventory/${sessionId}`);
  return {};
}

/** Staff resubmits a returned session after editing */
export async function resubmitOrderSession(sessionId: string): Promise<ActionResult> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("order_sessions")
    .select("created_by, status")
    .eq("id", sessionId)
    .single();

  if (!session || session.status !== "returned") {
    return { error: "ไม่สามารถส่งซ้ำได้ (สถานะไม่ใช่ 'ตีกลับ')" };
  }
  if (session.created_by !== profile.id) {
    return { error: "เฉพาะผู้กรอกเดิมเท่านั้นที่ส่งซ้ำได้" };
  }

  const { error } = await supabase
    .from("order_sessions")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory");
  revalidatePath("/staff/inventory/review");
  revalidatePath("/staff/inventory/purchase");
  revalidatePath("/staff/inventory/receive-queue");
  revalidatePath("/staff/inventory/history");
  revalidatePath(`/staff/inventory/${sessionId}`);
  return {};
}

/** Editor+ บันทึกว่าส่งสั่งของแล้ว: reviewed → sent */
export async function markOrderSent(sessionId: string): Promise<ActionResult> {
  const profile = await requireAdminOrEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("order_sessions")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("status", "reviewed");
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory");
  revalidatePath("/staff/inventory/review");
  revalidatePath("/staff/inventory/purchase");
  revalidatePath("/staff/inventory/receive-queue");
  revalidatePath("/staff/inventory/history");
  revalidatePath(`/staff/inventory/${sessionId}`);
  return {};
}

/** Reviewer แก้จำนวนตอน review (reviewer_qty_ordered) */
export async function saveReviewerItemEdit(
  itemId: string,
  reviewerQtyOrdered: number | null,
  sessionId: string
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("order_items")
    .update({ reviewer_qty_ordered: reviewerQtyOrdered })
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory");
  revalidatePath(`/staff/inventory/${sessionId}`);
  return {};
}

/** Purchaser แก้จำนวนตอนโทรซัพ (editor_qty_ordered) — any authenticated */
export async function saveEditorItemEdit(
  itemId: string,
  editorQtyOrdered: number | null,
  sessionId: string
): Promise<ActionResult> {
  await requireProfile();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("order_items")
    .update({ editor_qty_ordered: editorQtyOrdered })
    .eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory");
  revalidatePath(`/staff/inventory/${sessionId}`);
  return {};
}

export async function receiveOrderItems(
  sessionId: string,
  received: { itemId: string; qtyReceived: number | null }[]
): Promise<ActionResult> {
  await requireProfile();
  const supabase = await createClient();

  for (const { itemId, qtyReceived } of received) {
    const { error } = await supabase.rpc("receive_order_item", {
      item_id: itemId,
      qty: qtyReceived,
    });
    if (error) return { error: error.message };
  }

  const { data: allItems } = await supabase
    .from("order_items")
    .select("qty_received")
    .eq("session_id", sessionId);

  const allReceived = (allItems ?? []).every((i) => i.qty_received !== null);

  if (allReceived) {
    const { error } = await supabase
      .from("order_sessions")
      .update({ status: "received", received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("status", "sent");
    if (error) return { error: error.message };
  }

  revalidatePath("/staff/inventory");
  revalidatePath("/staff/inventory/review");
  revalidatePath("/staff/inventory/purchase");
  revalidatePath("/staff/inventory/receive-queue");
  revalidatePath("/staff/inventory/history");
  revalidatePath(`/staff/inventory/${sessionId}`);
  return {};
}
