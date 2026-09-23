import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/data";
import { NO_COUNTS, countsFor, type OrderCounts, type OrderStatus } from "@/lib/order-rules";

export type Station = { id: string; name: string; sortOrder: number };

export type { OrderStatus };

export type OrderSessionSummary = {
  id: string;
  stationId: string | null;
  stationName: string | null;
  status: OrderStatus;
  note: string | null;
  createdBy: string;
  createdByName: string;
  submittedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
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
  reviewerQtyOrdered: number | null;
  editorQtyOrdered: number | null;
  orderUnit: string | null;
  qtyReceived: number | null;
  /** Who received the line, and when: stored per line (item 35, decision 8). */
  receivedBy: string | null;
  receivedByName: string | null;
  receivedAt: string | null;
  note: string | null;
  sortOrder: number;
};

/** One quantity change: by the creator, a head or a receiver (item 35, decision 3). */
export type OrderItemChange = {
  id: string;
  itemId: string;
  itemName: string;
  field: "qty_ordered" | "reviewer_qty_ordered" | "qty_received";
  oldValue: number | null;
  newValue: number | null;
  changedByName: string;
  changedAt: string;
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
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  sentBy: string | null;
  receivedAt: string | null;
  createdAt: string;
  /** The head's conflict token: counted up by every edit; order_approve refuses a stale one. */
  version: number;
  returnNote: string | null;
  returnedByName: string | null;
  returnedAt: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelNote: string | null;
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
  customGroup: string | null;
  customUnit: string | null;
  defaultQty: number | null;
  kitchenUnit: string | null;
  freezerUnit: string | null;
};

export type Template = {
  id: string;
  name: string;
  createdAt: string;
};

export type TemplateItem = {
  id: string;
  templateId: string;
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string | null;
  customGroup: string | null;
  orderUnit: string | null;
  defaultQty: number | null;
  kitchenUnit: string | null;
  freezerUnit: string | null;
  sortOrder: number;
  usageUnit: string | null;
  purchaseUnitLabel: string | null;
};

export type StationTemplateRow = {
  id: string;
  stationId: string;
  ingredientId: string;
  ingredientName: string;
  ingredientCategory: string | null;
  customGroup: string | null;
  customUnit: string | null;
  defaultQty: number | null;
  sortOrder: number;
  usageUnit: string | null;
  purchaseUnitLabel: string | null;
  kitchenUnit: string | null;
  freezerUnit: string | null;
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
    customGroup: null,
    customUnit: null,
    defaultQty: null,
    kitchenUnit: null,
    freezerUnit: null,
  }));
}

export async function getAllStationTemplates(): Promise<Record<string, StationTemplateRow[]>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("station_ingredients")
    .select(`
      id, station_id, ingredient_id, custom_group, custom_unit, default_qty, sort_order, kitchen_unit, freezer_unit,
      ingredients(name, category, usage_unit, purchase_unit_label)
    `)
    .order("sort_order");
  if (error) throw new Error(error.message);

  type IngRef = { name: string; category: string | null; usage_unit: string | null; purchase_unit_label: string | null };
  type RawRow = {
    id: string; station_id: string; ingredient_id: string;
    custom_group: string | null; custom_unit: string | null;
    default_qty: number | null; sort_order: number;
    kitchen_unit: string | null; freezer_unit: string | null;
    ingredients: IngRef | IngRef[] | null;
  };

  function ingOf(r: RawRow): IngRef | null {
    if (!r.ingredients) return null;
    return Array.isArray(r.ingredients) ? r.ingredients[0] ?? null : r.ingredients;
  }

  const result: Record<string, StationTemplateRow[]> = {};
  for (const r of (data ?? []) as unknown as RawRow[]) {
    const ing = ingOf(r);
    const row: StationTemplateRow = {
      id: r.id,
      stationId: r.station_id,
      ingredientId: r.ingredient_id,
      ingredientName: ing?.name ?? "",
      ingredientCategory: ing?.category ?? null,
      customGroup: r.custom_group,
      customUnit: r.custom_unit,
      defaultQty: r.default_qty,
      sortOrder: r.sort_order,
      usageUnit: ing?.usage_unit ?? null,
      purchaseUnitLabel: ing?.purchase_unit_label ?? null,
      kitchenUnit: r.kitchen_unit,
      freezerUnit: r.freezer_unit,
    };
    if (!result[r.station_id]) result[r.station_id] = [];
    result[r.station_id].push(row);
  }
  return result;
}

export async function getStationTemplate(stationId: string): Promise<StationTemplateRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("station_ingredients")
    .select(`
      id, station_id, ingredient_id, custom_group, custom_unit, default_qty, sort_order, kitchen_unit, freezer_unit,
      ingredients(name, category, usage_unit, purchase_unit_label)
    `)
    .eq("station_id", stationId)
    .order("sort_order");
  if (error) throw new Error(error.message);

  type IngRef2 = { name: string; category: string | null; usage_unit: string | null; purchase_unit_label: string | null };
  type RawRow2 = {
    id: string; station_id: string; ingredient_id: string;
    custom_group: string | null; custom_unit: string | null;
    default_qty: number | null; sort_order: number;
    kitchen_unit: string | null; freezer_unit: string | null;
    ingredients: IngRef2 | IngRef2[] | null;
  };

  return (data ?? [] as unknown as RawRow2[]).map((r) => {
    const ing = r.ingredients ? (Array.isArray(r.ingredients) ? r.ingredients[0] : r.ingredients) : null;
    return {
      id: r.id,
      stationId: r.station_id,
      ingredientId: r.ingredient_id,
      ingredientName: ing?.name ?? "",
      ingredientCategory: ing?.category ?? null,
      customGroup: r.custom_group,
      customUnit: r.custom_unit,
      defaultQty: r.default_qty,
      sortOrder: r.sort_order,
      usageUnit: ing?.usage_unit ?? null,
      purchaseUnitLabel: ing?.purchase_unit_label ?? null,
      kitchenUnit: r.kitchen_unit,
      freezerUnit: r.freezer_unit,
    };
  });
}

export async function getOrderSessions(opts?: {
  status?: OrderStatus | OrderStatus[];
  mineOrSent?: string;
}): Promise<OrderSessionSummary[]> {
  const supabase = await createClient();

  let query = supabase
    .from("order_sessions")
    .select("id, station_id, status, note, created_by, submitted_at, reviewed_by, reviewed_at, approved_by, approved_at, sent_at, received_at, created_at, stations(name)")
    .order("created_at", { ascending: false });

  if (opts?.mineOrSent) {
    query = query.or(`created_by.eq.${opts.mineOrSent},status.eq.sent`);
  } else if (opts?.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    query = query.in("status", statuses);
  }

  // Every line's order id, paged: an unpaged read stops at 1,000 rows and
  // the counts beyond it silently read 0 (item 35, the smaller findings).
  const [{ data: sessions, error }, itemCounts] = await Promise.all([
    query,
    fetchAllRows<{ session_id: string }>(({ from, to }) =>
      supabase.from("order_items").select("session_id").order("id").range(from, to)
    ),
  ]);

  if (error) throw new Error(error.message);
  if (!sessions || sessions.length === 0) return [];

  const countMap = new Map<string, number>();
  for (const row of itemCounts ?? []) {
    countMap.set(row.session_id, (countMap.get(row.session_id) ?? 0) + 1);
  }

  const allIds = [...new Set(
    sessions.flatMap((s) => [s.created_by, s.approved_by, s.reviewed_by].filter(Boolean) as string[])
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
    reviewedByName: s.reviewed_by ? (nameById.get(s.reviewed_by) ?? "ไม่ทราบ") : null,
    reviewedAt: s.reviewed_at,
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
      reviewed_by, reviewed_at,
      approved_by, approved_at, sent_at, sent_by, received_at, created_at,
      version, return_note, returned_by, returned_at, cancelled_by, cancelled_at, cancel_note,
      stations(name),
      order_items(
        id, session_id, ingredient_id, ingredient_name,
        remaining_kitchen_qty, remaining_kitchen_unit,
        remaining_freezer_qty, remaining_freezer_unit,
        pack_count, qty_per_pack, qty_ordered,
        reviewer_qty_ordered, editor_qty_ordered,
        order_unit, qty_received, received_by, received_at, note, sort_order
      )
    `)
    .eq("id", id)
    .single();

  if (error || !session) return null;

  type RawItem = {
    id: string; session_id: string; ingredient_id: string | null;
    ingredient_name: string;
    remaining_kitchen_qty: number | null; remaining_kitchen_unit: string | null;
    remaining_freezer_qty: number | null; remaining_freezer_unit: string | null;
    pack_count: number | null; qty_per_pack: number | null;
    qty_ordered: number; reviewer_qty_ordered: number | null; editor_qty_ordered: number | null;
    order_unit: string | null; qty_received: number | null;
    received_by: string | null; received_at: string | null;
    note: string | null; sort_order: number;
  };
  const rawItems = (Array.isArray(session.order_items) ? session.order_items : []) as RawItem[];

  const allIds = [...new Set([
    session.created_by, session.reviewed_by, session.approved_by, session.sent_by,
    session.returned_by, session.cancelled_by, ...rawItems.map((i) => i.received_by),
  ].filter(Boolean) as string[])];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", allIds);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? "ไม่ทราบ") : null);

  return {
    id: session.id,
    stationId: session.station_id,
    stationName: (session.stations as unknown as { name: string } | null)?.name ?? null,
    status: session.status as OrderStatus,
    note: session.note,
    createdBy: session.created_by,
    createdByName: nameById.get(session.created_by) ?? "ไม่ทราบ",
    submittedAt: session.submitted_at,
    reviewedBy: session.reviewed_by,
    reviewedByName: session.reviewed_by ? (nameById.get(session.reviewed_by) ?? "ไม่ทราบ") : null,
    reviewedAt: session.reviewed_at,
    approvedBy: session.approved_by,
    approvedByName: session.approved_by ? (nameById.get(session.approved_by) ?? "ไม่ทราบ") : null,
    approvedAt: session.approved_at,
    sentAt: session.sent_at,
    sentBy: session.sent_by,
    receivedAt: session.received_at,
    createdAt: session.created_at,
    version: session.version,
    returnNote: session.return_note,
    returnedByName: nameOf(session.returned_by),
    returnedAt: session.returned_at,
    cancelledByName: nameOf(session.cancelled_by),
    cancelledAt: session.cancelled_at,
    cancelNote: session.cancel_note,
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
        reviewerQtyOrdered: item.reviewer_qty_ordered,
        editorQtyOrdered: item.editor_qty_ordered,
        orderUnit: item.order_unit,
        qtyReceived: item.qty_received,
        receivedBy: item.received_by,
        receivedByName: nameOf(item.received_by),
        receivedAt: item.received_at,
        note: item.note,
        sortOrder: item.sort_order,
      })),
  };
}

/** The order's quantity changes, oldest first, with the names (item 35, decision 3). */
export async function getOrderChanges(sessionId: string): Promise<OrderItemChange[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_item_changes")
    .select("id, item_id, field, old_value, new_value, changed_by, changed_at, order_items(ingredient_name)")
    .eq("session_id", sessionId)
    .order("changed_at")
    .order("id")
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.changed_by as string))];
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  return rows.map((r) => {
    const item = r.order_items as unknown as { ingredient_name: string } | { ingredient_name: string }[] | null;
    const name = Array.isArray(item) ? item[0]?.ingredient_name : item?.ingredient_name;
    return {
      id: r.id as string,
      itemId: r.item_id as string,
      itemName: name ?? "",
      field: r.field as OrderItemChange["field"],
      oldValue: r.old_value as number | null,
      newValue: r.new_value as number | null,
      changedByName: nameById.get(r.changed_by as string) ?? "ไม่ทราบ",
      changedAt: r.changed_at as string,
    };
  });
}

/**
 * "Waiting for you" for this person (order-rules.ts, OrderCounts): each count
 * the role has, read as a head-only count; the rest are 0. A failed read
 * counts 0, so the badge never blocks a page.
 */
export async function getOrderCounts(profile: { id: string; role: string }): Promise<OrderCounts> {
  const has = countsFor(profile.role);
  if (!has.mine && !has.review && !has.purchase && !has.receive) return NO_COUNTS;
  const supabase = await createClient();
  const count = async (status: OrderStatus, mine: boolean) => {
    let q = supabase.from("order_sessions").select("id", { count: "exact", head: true }).eq("status", status);
    if (mine) q = q.eq("created_by", profile.id);
    const { count: n } = await q;
    return n ?? 0;
  };
  const [mine, review, purchase, receive] = await Promise.all([
    has.mine ? count("returned", true) : 0,
    has.review ? count("submitted", false) : 0,
    has.purchase ? count("reviewed", false) : 0,
    has.receive ? count("sent", true) : 0,
  ]);
  return { mine, review, purchase, receive };
}

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

export async function getTemplates(): Promise<Template[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .select("id, name, created_at")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export async function getTemplateItems(templateId: string): Promise<TemplateItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("template_items")
    .select(`
      id, template_id, ingredient_id, order_unit, default_qty,
      kitchen_unit, freezer_unit, custom_group, sort_order,
      ingredients(name, category, usage_unit, purchase_unit_label)
    `)
    .eq("template_id", templateId)
    .order("sort_order");
  if (error) throw new Error(error.message);

  type IngRef = { name: string; category: string | null; usage_unit: string | null; purchase_unit_label: string | null };
  type RawItem = {
    id: string; template_id: string; ingredient_id: string;
    order_unit: string | null; default_qty: number | null;
    kitchen_unit: string | null; freezer_unit: string | null;
    custom_group: string | null; sort_order: number;
    ingredients: IngRef | IngRef[] | null;
  };

  return ((data ?? []) as unknown as RawItem[]).map((r) => {
    const ing = r.ingredients
      ? Array.isArray(r.ingredients) ? r.ingredients[0] ?? null : r.ingredients
      : null;
    return {
      id: r.id,
      templateId: r.template_id,
      ingredientId: r.ingredient_id,
      ingredientName: ing?.name ?? "",
      ingredientCategory: ing?.category ?? null,
      customGroup: r.custom_group,
      orderUnit: r.order_unit,
      defaultQty: r.default_qty,
      kitchenUnit: r.kitchen_unit,
      freezerUnit: r.freezer_unit,
      sortOrder: r.sort_order,
      usageUnit: ing?.usage_unit ?? null,
      purchaseUnitLabel: ing?.purchase_unit_label ?? null,
    };
  });
}
