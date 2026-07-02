import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Station = { id: string; name: string; sortOrder: number };

export type OrderStatus = "submitted" | "returned" | "approved" | "sent" | "received";

export type OrderSessionSummary = {
  id: string;
  stationId: string | null;
  stationName: string | null;
  status: OrderStatus;
  note: string | null;
  createdBy: string;
  createdByName: string;
  submittedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  itemCount: number;
};

export type OrderItem = {
  id: string;
  sessionId: string;
  ingredientId: string | null;
  ingredientName: string;
  remainingKitchenQty: number | null;
  remainingKitchenUnit: string | null;
  remainingFreezerQty: number | null;
  remainingFreezerUnit: string | null;
  packCount: number | null;
  qtyPerPack: number | null;
  qtyOrdered: number;
  editorQtyOrdered: number | null;
  orderUnit: string | null;
  qtyReceived: number | null;
  note: string | null;
  sortOrder: number;
};

export type OrderSessionDetail = {
  id: string;
  stationId: string | null;
  stationName: string | null;
  status: OrderStatus;
  note: string | null;
  createdBy: string;
  createdByName: string;
  submittedAt: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  sentBy: string | null;
  receivedAt: string | null;
  createdAt: string;
  items: OrderItem[];
};

export type IngredientForOrder = {
  id: string;
  name: string;
  nameMm: string | null;
  category: string | null;
  parLevel: number | null;
  safetyNote: string | null;
  purchaseUnitLabel: string | null;
  usageUnit: string | null;
};

export async function getStations(): Promise<Station[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stations")
    .select("id, name, sort_order")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ id: s.id, name: s.name, sortOrder: s.sort_order }));
}

export async function getIngredientsForOrder(): Promise<IngredientForOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingredients")
    .select("id, name, name_mm, category, par_level, safety_note, purchase_unit_label, usage_unit")
    .eq("is_prep", false)
    .order("category", { nullsFirst: false })
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    nameMm: i.name_mm ?? null,
    category: i.category ?? null,
    parLevel: i.par_level ?? null,
    safetyNote: i.safety_note ?? null,
    purchaseUnitLabel: i.purchase_unit_label ?? null,
    usageUnit: i.usage_unit ?? null,
  }));
}

export async function getOrderSessions(): Promise<OrderSessionSummary[]> {
  const supabase = await createClient();
  const [{ data: sessions, error }, { data: itemCounts }] = await Promise.all([
    supabase
      .from("order_sessions")
      .select("id, station_id, status, note, created_by, submitted_at, approved_by, approved_at, sent_at, received_at, created_at, stations(name)")
      .order("created_at", { ascending: false }),
    supabase.from("order_items").select("session_id"),
  ]);

  if (error) throw new Error(error.message);
  if (!sessions || sessions.length === 0) return [];

  const countMap = new Map<string, number>();
  for (const row of itemCounts ?? []) {
    countMap.set(row.session_id, (countMap.get(row.session_id) ?? 0) + 1);
  }

  const allIds = [...new Set(
    sessions.flatMap((s) => [s.created_by, s.approved_by].filter(Boolean) as string[])
  )];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", allIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return sessions.map((s) => ({
    id: s.id,
    stationId: s.station_id,
    stationName: (s.stations as unknown as { name: string } | null)?.name ?? null,
    status: s.status as OrderStatus,
    note: s.note,
    createdBy: s.created_by,
    createdByName: nameById.get(s.created_by) ?? "ไม่ทราบ",
    submittedAt: s.submitted_at,
    approvedByName: s.approved_by ? (nameById.get(s.approved_by) ?? "ไม่ทราบ") : null,
    approvedAt: s.approved_at,
    sentAt: s.sent_at,
    receivedAt: s.received_at,
    createdAt: s.created_at,
    itemCount: countMap.get(s.id) ?? 0,
  }));
}

export async function getOrderSessionDetail(id: string): Promise<OrderSessionDetail | null> {
  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("order_sessions")
    .select(`
      id, station_id, status, note, created_by, submitted_at,
      approved_by, approved_at, sent_at, sent_by, received_at, created_at,
      stations(name),
      order_items(
        id, session_id, ingredient_id, ingredient_name,
        remaining_kitchen_qty, remaining_kitchen_unit,
        remaining_freezer_qty, remaining_freezer_unit,
        pack_count, qty_per_pack, qty_ordered, editor_qty_ordered, order_unit,
        qty_received, note, sort_order
      )
    `)
    .eq("id", id)
    .single();

  if (error || !session) return null;

  const allIds = [session.created_by, session.approved_by, session.sent_by].filter(Boolean) as string[];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", allIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  type RawItem = {
    id: string; session_id: string; ingredient_id: string | null;
    ingredient_name: string;
    remaining_kitchen_qty: number | null; remaining_kitchen_unit: string | null;
    remaining_freezer_qty: number | null; remaining_freezer_unit: string | null;
    pack_count: number | null; qty_per_pack: number | null;
    qty_ordered: number; editor_qty_ordered: number | null;
    order_unit: string | null; qty_received: number | null;
    note: string | null; sort_order: number;
  };
  const rawItems = (Array.isArray(session.order_items) ? session.order_items : []) as RawItem[];

  return {
    id: session.id,
    stationId: session.station_id,
    stationName: (session.stations as unknown as { name: string } | null)?.name ?? null,
    status: session.status as OrderStatus,
    note: session.note,
    createdBy: session.created_by,
    createdByName: nameById.get(session.created_by) ?? "ไม่ทราบ",
    submittedAt: session.submitted_at,
    approvedBy: session.approved_by,
    approvedByName: session.approved_by ? (nameById.get(session.approved_by) ?? "ไม่ทราบ") : null,
    approvedAt: session.approved_at,
    sentAt: session.sent_at,
    sentBy: session.sent_by,
    receivedAt: session.received_at,
    createdAt: session.created_at,
    items: rawItems
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        id: item.id,
        sessionId: item.session_id,
        ingredientId: item.ingredient_id,
        ingredientName: item.ingredient_name,
        remainingKitchenQty: item.remaining_kitchen_qty,
        remainingKitchenUnit: item.remaining_kitchen_unit,
        remainingFreezerQty: item.remaining_freezer_qty,
        remainingFreezerUnit: item.remaining_freezer_unit,
        packCount: item.pack_count,
        qtyPerPack: item.qty_per_pack,
        qtyOrdered: item.qty_ordered,
        editorQtyOrdered: item.editor_qty_ordered,
        orderUnit: item.order_unit,
        qtyReceived: item.qty_received,
        note: item.note,
        sortOrder: item.sort_order,
      })),
  };
}

/** Last used qty_per_pack for an ingredient (for pack ordering default) */
export async function getLastQtyPerPack(ingredientId: string): Promise<number | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_items")
    .select("qty_per_pack")
    .eq("ingredient_id", ingredientId)
    .not("qty_per_pack", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.qty_per_pack ?? null;
}
