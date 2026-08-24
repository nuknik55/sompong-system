"use server";

import { revalidatePath } from "next/cache";
import { requireSales, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { findRoomConflict } from "./conflict";
import type { RoomConflictCandidate } from "./conflict";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CateringCustomer = {
  id: string;
  name: string;
  phone: string | null;
  line_id: string | null;
  company_name: string | null;
  address: string | null;
  contact_person: string | null;
};

/**
 * Read from the catering_staff_options VIEW, never from employees directly —
 * the view exists so the sales role never receives salary columns.
 */
export type StaffOption = {
  id: string;
  nickname: string | null;
  full_name: string;
  department_name: string | null;
  is_active: boolean;
};

export type CateringEvent = {
  id: string;
  created_at: string;
  /** Bumped by trg_catering_events_updated_at on every row update — use for staleness, not a display timestamp. */
  updated_at: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_company_name: string | null;
  customer_address: string | null;
  customer_contact_person: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_type: string;
  venue: string | null;
  room_portion: string | null;
  offsite_address: string | null;
  offsite_distance_km: number | null;
  floor_level: number | null;
  booking_type: string;
  food_format: string | null;
  table_count: number | null;
  reserve_tables: number | null;
  table_label: string | null;
  guest_count: number | null;
  music_type: string;
  music_note: string | null;
  status: string;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  detail_note: string | null;
  kitchen_note: string | null;
  created_by: string | null;
  /** Resolved via profiles RLS (profiles_select_own): null for anyone else's
   *  booking unless the viewer is owner. Render "ไม่ทราบ" in that case —
   *  do not treat a null here as missing data. */
  created_by_name: string | null;
  quote_number: string | null;
  quote_revision: number;
  quoted_total: number | null;
  quoted_at: string | null;
  staff_ids: string[];
};

export type CateringCharge = {
  id: string;
  label: string;
  charge_type: string;
  unit_price: number;
  quantity: number;
  amount: number;
  note: string | null;
  /** Set only when addCateringEventMenu() created this charge; NULL for
   *  every other charge (rate picker, "+ เพิ่มรายการ", hand-typed). */
  event_menu_id: string | null;
};

export type CateringRate = {
  id: string;
  rate_type: string;
  label: string;
  amount: number;
  unit: string | null;
  note: string | null;
  min_distance_km: number | null;
  max_distance_km: number | null;
  sort_order: number;
  is_active: boolean;
};

export type CateringSettings = {
  company_name: string | null;
  address: string | null;
  tax_id: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
};

/**
 * A line in catering_event_menus — "what did we actually order for this
 * event", separate from catering_event_charges ("what's on the quotation").
 * Sale-price fields only; never joins ingredients/menu_recipe_items.
 */
export type CateringEventMenu = {
  id: string;
  set_menu_id: string | null;
  menu_id: string | null;
  name: string;
  quantity: number;
  note: string | null;
};

/** Sales-safe: name + sale price only. For the event-menu picker (part B). */
export type CateringSetMenuOption = {
  id: string;
  name: string;
  price_per_set: number;
};

/** Sales-safe: name + sale price only, from the existing menus table. */
export type CateringDishOption = {
  id: string;
  name: string;
  category: string | null;
  selling_price: number;
};

/** Admin-only management list — see set-menus/page.tsx, the one screen that renders cost. */
export type CateringSetMenu = {
  id: string;
  name: string;
  description: string | null;
  price_per_set: number;
  serves_guests: number | null;
  is_active: boolean;
  dish_count: number;
};

export type CateringSetMenuItem = {
  id: string;
  menu_id: string;
  menu_name: string;
  quantity: number;
  note: string | null;
};

const CATERING_EVENT_SELECT = `
  id, created_at, updated_at, customer_id, event_date, start_time, end_time,
  location_type, venue, room_portion, offsite_address, offsite_distance_km, floor_level,
  booking_type, food_format, table_count, reserve_tables, table_label, guest_count,
  music_type, music_note, status,
  deposit_amount, deposit_paid_at, detail_note, kitchen_note, created_by,
  quote_number, quote_revision, quoted_total, quoted_at,
  catering_customers(name, phone, company_name, address, contact_person),
  catering_event_staff(employee_id),
  profiles(full_name)
`;

function mapEventRow(r: Record<string, unknown>): CateringEvent {
  const cust = r.catering_customers as {
    name: string; phone: string | null; company_name: string | null;
    address: string | null; contact_person: string | null;
  } | null;
  const staff = (r.catering_event_staff ?? []) as { employee_id: string }[];
  const creator = r.profiles as { full_name: string } | null;
  return {
    id: r.id as string,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    customer_id: r.customer_id as string | null,
    customer_name: cust?.name ?? null,
    customer_phone: cust?.phone ?? null,
    customer_company_name: cust?.company_name ?? null,
    customer_address: cust?.address ?? null,
    customer_contact_person: cust?.contact_person ?? null,
    event_date: r.event_date as string,
    start_time: r.start_time as string | null,
    end_time: r.end_time as string | null,
    location_type: r.location_type as string,
    venue: r.venue as string | null,
    room_portion: r.room_portion as string | null,
    offsite_address: r.offsite_address as string | null,
    offsite_distance_km: r.offsite_distance_km as number | null,
    floor_level: r.floor_level as number | null,
    booking_type: r.booking_type as string,
    food_format: r.food_format as string | null,
    table_count: r.table_count as number | null,
    reserve_tables: r.reserve_tables as number | null,
    table_label: r.table_label as string | null,
    guest_count: r.guest_count as number | null,
    music_type: r.music_type as string,
    music_note: r.music_note as string | null,
    status: r.status as string,
    deposit_amount: r.deposit_amount as number | null,
    deposit_paid_at: r.deposit_paid_at as string | null,
    detail_note: r.detail_note as string | null,
    kitchen_note: r.kitchen_note as string | null,
    created_by: r.created_by as string | null,
    created_by_name: creator?.full_name ?? null,
    quote_number: r.quote_number as string | null,
    quote_revision: r.quote_revision as number,
    quoted_total: r.quoted_total as number | null,
    quoted_at: r.quoted_at as string | null,
    staff_ids: staff.map((s) => s.employee_id),
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getCateringCustomers(): Promise<CateringCustomer[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_customers")
    .select("id,name,phone,line_id,company_name,address,contact_person")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

/**
 * Returns EVERY employee, inactive included. Someone assigned to a past event
 * who has since left still has to render by name in the list; the dropdown does
 * its own is_active filtering.
 */
export async function getStaffOptions(): Promise<StaffOption[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_staff_options")
    .select("id,nickname,full_name,department_name,is_active,sort_order")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    nickname: r.nickname as string | null,
    full_name: r.full_name as string,
    department_name: r.department_name as string | null,
    is_active: (r.is_active as boolean) ?? false,
  }));
}

export async function getCateringEvents(year: number, month: number): Promise<CateringEvent[]> {
  await requireSales();
  const supabase = await createClient();
  const m = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();

  const { data, error } = await supabase
    .from("catering_events")
    .select(CATERING_EVENT_SELECT)
    .gte("event_date", `${year}-${m}-01`)
    .lte("event_date", `${year}-${m}-${String(lastDay).padStart(2, "0")}`)
    .order("event_date")
    .order("start_time", { nullsFirst: true });

  if (error) throw error;
  return (data ?? []).map((r) => mapEventRow(r as unknown as Record<string, unknown>));
}

export async function getCateringEvent(id: string): Promise<CateringEvent | null> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_events")
    .select(CATERING_EVENT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? mapEventRow(data as unknown as Record<string, unknown>) : null;
}

/**
 * For the status/pipeline overview page — unbounded by month (a pipeline
 * spans whatever event dates are still open), catering bookings only
 * (booking_type = 'catering'; table/room-only bookings aren't part of this
 * pipeline). By default excludes done/cancelled — those are historical, not
 * pipeline; pass includeHistory to fetch everything for the history toggle.
 */
export async function getCateringPipelineEvents(includeHistory: boolean): Promise<CateringEvent[]> {
  await requireSales();
  const supabase = await createClient();
  let query = supabase
    .from("catering_events")
    .select(CATERING_EVENT_SELECT)
    .eq("booking_type", "catering")
    .order("event_date");
  if (!includeHistory) {
    query = query.in("status", ["inquiry", "awaiting_deposit", "deposit_paid", "confirmed"]);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => mapEventRow(r as unknown as Record<string, unknown>));
}

/**
 * Other in-house bookings on `eventDate` holding an exclusive room
 * (room_v1/room_v2/room_v1_v2 — air_shared/offsite never conflict, see
 * findRoomConflict in conflict.ts). Cancelled bookings are excluded: a
 * cancelled booking no longer actually holds the room, so it shouldn't
 * trigger a permanent false-positive warning.
 */
export async function getRoomConflictCandidates(
  eventDate: string,
  excludeId: string | null,
): Promise<RoomConflictCandidate[]> {
  await requireSales();
  if (!eventDate) return [];
  const supabase = await createClient();
  let query = supabase
    .from("catering_events")
    .select("id, venue, start_time, end_time, catering_customers(name)")
    .eq("event_date", eventDate)
    .in("venue", ["room_v1", "room_v2", "room_v1_v2"])
    .neq("status", "cancelled");
  if (excludeId) query = query.neq("id", excludeId);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    customer_name: (r.catering_customers as { name: string } | null)?.name ?? null,
    venue: r.venue as string,
    start_time: r.start_time as string | null,
    end_time: r.end_time as string | null,
  }));
}

export async function getCateringCharges(eventId: string): Promise<CateringCharge[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_charges")
    .select("id, label, charge_type, unit_price, quantity, amount, note, event_menu_id")
    .eq("event_id", eventId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as CateringCharge[];
}

export async function getCateringRates(): Promise<CateringRate[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_rates")
    .select("id, rate_type, label, amount, unit, note, min_distance_km, max_distance_km, sort_order, is_active")
    .eq("is_active", true)
    .order("rate_type")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as CateringRate[];
}

/** Admin-only management list — includes inactive rows, unlike getCateringRates(). */
export async function getAllCateringRates(): Promise<CateringRate[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_rates")
    .select("id, rate_type, label, amount, unit, note, min_distance_km, max_distance_km, sort_order, is_active")
    .order("rate_type")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as CateringRate[];
}

export async function getCateringSettings(): Promise<CateringSettings | null> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_settings")
    .select("company_name, address, tax_id, phone, bank_name, bank_account_name, bank_account_number")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ─── Event menus (sales-safe — sale price only, never cost) ───────────────────
// Deliberately kept in this file, never importing getCostingContext/
// computeMenuCost, so there is no code path here that could accidentally end
// up cost-bearing. The one place that computes cost lives entirely in
// set-menus/page.tsx (admin-only) and is never exported for reuse.

export async function getCateringEventMenus(eventId: string): Promise<CateringEventMenu[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_menus")
    .select("id, set_menu_id, menu_id, quantity, note, catering_set_menus(name), menus(name)")
    .eq("event_id", eventId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const setMenu = r.catering_set_menus as { name: string } | null;
    const dish = r.menus as { name: string } | null;
    return {
      id: r.id as string,
      set_menu_id: r.set_menu_id as string | null,
      menu_id: r.menu_id as string | null,
      name: setMenu?.name ?? dish?.name ?? "-",
      quantity: r.quantity as number,
      note: r.note as string | null,
    };
  });
}

export async function getCateringSetMenuOptions(): Promise<CateringSetMenuOption[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_set_menus")
    .select("id, name, price_per_set")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []) as CateringSetMenuOption[];
}

/** menus already grants SELECT to sales (sales_read_menus) — same query shape. */
export async function getCateringDishOptions(): Promise<CateringDishOption[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menus")
    .select("id, name, category, selling_price")
    .order("name");
  if (error) throw error;
  return (data ?? []) as CateringDishOption[];
}

// ─── Set menu management (owner/admin only — set-menus/page.tsx) ──────────────

export async function getCateringSetMenus(): Promise<CateringSetMenu[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_set_menus")
    .select("id, name, description, price_per_set, serves_guests, is_active, catering_set_menu_items(count)")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const countRow = (r.catering_set_menu_items as { count: number }[] | null)?.[0];
    return {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string | null,
      price_per_set: r.price_per_set as number,
      serves_guests: r.serves_guests as number | null,
      is_active: r.is_active as boolean,
      dish_count: countRow?.count ?? 0,
    };
  });
}

export async function getCateringSetMenuItems(setMenuId: string): Promise<CateringSetMenuItem[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_set_menu_items")
    .select("id, menu_id, quantity, note, menus(name)")
    .eq("set_menu_id", setMenuId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    menu_id: r.menu_id as string,
    menu_name: (r.menus as { name: string } | null)?.name ?? "-",
    quantity: r.quantity as number,
    note: r.note as string | null,
  }));
}

export async function saveCateringSetMenu(data: {
  id?: string;
  name: string;
  description: string | null;
  price_per_set: number;
  serves_guests: number | null;
  items: { menu_id: string; quantity: number; note: string | null }[];
}): Promise<string> {
  await requireAdmin();
  const supabase = await createClient();

  const payload = {
    name: data.name.trim(),
    description: data.description?.trim() || null,
    price_per_set: data.price_per_set,
    serves_guests: data.serves_guests,
  };

  let setMenuId = data.id;
  if (setMenuId) {
    const { error } = await supabase.from("catering_set_menus").update(payload).eq("id", setMenuId);
    if (error) throw error;
  } else {
    const { data: created, error } = await supabase
      .from("catering_set_menus")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw error;
    setMenuId = created.id;
  }

  // Replace the dish list wholesale — same reasoning as catering_event_staff /
  // catering_event_charges: simpler than diffing, and the row count is tiny.
  // The picker on the client already dedupes by menu_id (bumps quantity
  // instead of adding a second row), which catering_set_menu_items requires
  // anyway via its UNIQUE (set_menu_id, menu_id) constraint.
  await supabase.from("catering_set_menu_items").delete().eq("set_menu_id", setMenuId);
  if (data.items.length > 0) {
    const { error } = await supabase.from("catering_set_menu_items").insert(
      data.items.map((it, i) => ({
        set_menu_id: setMenuId,
        menu_id: it.menu_id,
        quantity: it.quantity,
        note: it.note?.trim() || null,
        sort_order: (i + 1) * 10,
      })),
    );
    if (error) throw error;
  }

  revalidatePath("/owner/catering/set-menus");
  return setMenuId!;
}

export async function toggleCateringSetMenuActive(id: string, isActive: boolean): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("catering_set_menus").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering/set-menus");
}

export async function deleteCateringSetMenu(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  // catering_set_menu_items cascades; catering_event_menus.set_menu_id is
  // ON DELETE RESTRICT, so this throws 23503 if any event has already
  // ordered this set — surfaced below with a friendly message.
  const { error } = await supabase.from("catering_set_menus").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("ลบไม่ได้ เพราะมีการจองงานที่ใช้ชุดเมนูนี้อยู่ — เอาออกจากการจองทั้งหมดก่อน หรือปิดใช้งานแทนการลบ");
    }
    throw error;
  }
  revalidatePath("/owner/catering/set-menus");
}

// ─── Rate management (owner/admin only — see catering_rates_all RLS) ──────────

export async function addCateringRate(data: {
  rate_type: string;
  label: string;
  amount: number;
  unit: string | null;
  note: string | null;
  min_distance_km: number | null;
  max_distance_km: number | null;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: last } = await supabase
    .from("catering_rates")
    .select("sort_order")
    .eq("rate_type", data.rate_type)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;

  const { error } = await supabase.from("catering_rates").insert({ ...data, sort_order: nextSort });
  if (error) throw error;
  revalidatePath("/owner/catering/settings");
}

export async function updateCateringRate(
  id: string,
  data: {
    rate_type: string;
    label: string;
    amount: number;
    unit: string | null;
    note: string | null;
    min_distance_km: number | null;
    max_distance_km: number | null;
  },
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("catering_rates").update(data).eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering/settings");
}

export async function toggleCateringRateActive(id: string, isActive: boolean): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("catering_rates").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering/settings");
}

export async function deleteCateringRate(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("catering_rates").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering/settings");
}

/** Same swap-sort_order-with-neighbor approach as reorderCoaAccount in accounting/actions.ts. */
export async function reorderCateringRate(id: string, rateType: string, direction: "up" | "down"): Promise<{ error?: string }> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: siblings } = await supabase
    .from("catering_rates").select("id,sort_order").eq("rate_type", rateType).order("sort_order");
  if (!siblings) return { error: "ไม่พบข้อมูล" };

  const idx = siblings.findIndex((s) => s.id === id);
  if (idx < 0) return { error: "ไม่พบรายการ" };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return {};

  const current = siblings[idx]!;
  const swap = siblings[swapIdx]!;
  await supabase.from("catering_rates").update({ sort_order: swap.sort_order }).eq("id", current.id);
  await supabase.from("catering_rates").update({ sort_order: current.sort_order }).eq("id", swap.id);

  revalidatePath("/owner/catering/settings");
  return {};
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function upsertCateringEvent(data: {
  id?: string;
  /** Existing customer. Mutually exclusive with new_customer. */
  customer_id?: string | null;
  /** Created inline so the person on the phone never has to leave the form. */
  new_customer?: {
    name: string;
    phone?: string | null;
    line_id?: string | null;
    company_name?: string | null;
    address?: string | null;
    contact_person?: string | null;
  } | null;
  /** Address/contact edits to an EXISTING customer, saved alongside the event. */
  customer_edits?: { address: string | null; contact_person: string | null } | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_type: string;
  /** In-house room. Must be null when location_type = 'offsite'. */
  venue: string | null;
  /** half/full — only valid when venue is room_v1 or room_v2. */
  room_portion: string | null;
  offsite_address: string | null;
  offsite_distance_km: number | null;
  floor_level: number | null;
  booking_type: string;
  food_format: string | null;
  table_count: number | null;
  reserve_tables: number | null;
  table_label: string | null;
  guest_count: number | null;
  music_type: string;
  music_note: string | null;
  status: string;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  detail_note: string | null;
  kitchen_note: string | null;
  staff_ids: string[];
}): Promise<void> {
  const profile = await requireSales();
  const supabase = await createClient();

  let customerId = data.customer_id ?? null;
  if (!customerId && data.new_customer && data.new_customer.name.trim()) {
    const { data: created, error: custError } = await supabase
      .from("catering_customers")
      .insert({
        name: data.new_customer.name.trim(),
        phone: data.new_customer.phone?.trim() || null,
        line_id: data.new_customer.line_id?.trim() || null,
        company_name: data.new_customer.company_name?.trim() || null,
        address: data.new_customer.address?.trim() || null,
        contact_person: data.new_customer.contact_person?.trim() || null,
      })
      .select("id")
      .single();
    if (custError) throw custError;
    customerId = created.id;
  } else if (customerId && data.customer_edits) {
    const { error: custUpdateError } = await supabase
      .from("catering_customers")
      .update({
        address: data.customer_edits.address?.trim() || null,
        contact_person: data.customer_edits.contact_person?.trim() || null,
      })
      .eq("id", customerId);
    if (custUpdateError) throw custUpdateError;
  }

  const payload = {
    customer_id: customerId,
    event_date: data.event_date,
    start_time: data.start_time || null,
    end_time: data.end_time || null,
    location_type: data.location_type,
    venue: data.venue,
    room_portion: data.room_portion,
    offsite_address: data.offsite_address?.trim() || null,
    offsite_distance_km: data.offsite_distance_km,
    floor_level: data.floor_level,
    booking_type: data.booking_type,
    food_format: data.food_format || null,
    table_count: data.table_count,
    reserve_tables: data.reserve_tables,
    table_label: data.table_label?.trim() || null,
    guest_count: data.guest_count,
    music_type: data.music_type,
    music_note: data.music_note?.trim() || null,
    status: data.status,
    deposit_amount: data.deposit_amount,
    deposit_paid_at: data.deposit_paid_at || null,
    detail_note: data.detail_note?.trim() || null,
    kitchen_note: data.kitchen_note?.trim() || null,
  };

  // Same rule the client already warned with (see conflict.ts) — enforced
  // again here so two people racing to save around the same time can't both
  // pass the client-side check and land a genuine double-booking.
  if (payload.location_type === "in_house" && payload.venue) {
    const candidates = await getRoomConflictCandidates(payload.event_date, data.id ?? null);
    const conflict = findRoomConflict(payload.venue, payload.start_time, payload.end_time, candidates);
    if (conflict) {
      throw new Error(
        `ห้องชนกับการจองอื่น: ${conflict.customer_name ?? "-"} ในวันเดียวกัน — ไม่สามารถบันทึกได้`,
      );
    }
  }

  let eventId = data.id;
  if (eventId) {
    // created_by is set once, on creation, and never touched by an edit.
    const { error } = await supabase.from("catering_events").update(payload).eq("id", eventId);
    if (error) throw error;
  } else {
    const { data: created, error } = await supabase
      .from("catering_events")
      .insert({ ...payload, created_by: profile.id })
      .select("id")
      .single();
    if (error) throw error;
    eventId = created.id;
  }

  // Replace the staff assignment set wholesale — simpler than diffing, and the
  // row count per event is tiny.
  await supabase.from("catering_event_staff").delete().eq("event_id", eventId);
  if (data.staff_ids.length > 0) {
    const { error } = await supabase.from("catering_event_staff").insert(
      data.staff_ids.map((employee_id) => ({ event_id: eventId, employee_id, role: "taker" })),
    );
    if (error) throw error;
  }

  revalidatePath("/owner/catering");
  revalidatePath(`/owner/catering/${eventId}`);
}

/**
 * Replaces the full charge list wholesale — same reasoning as
 * catering_event_staff above: simpler than diffing, and the row count per
 * event is tiny.
 */
export async function saveCateringCharges(
  eventId: string,
  charges: {
    label: string;
    charge_type: string;
    unit_price: number;
    quantity: number;
    amount: number;
    note: string | null;
    event_menu_id: string | null;
  }[],
): Promise<void> {
  await requireSales();
  const supabase = await createClient();

  // Deletes and reinserts every row, so event_menu_id MUST be threaded
  // through the caller's payload — otherwise this silently drops every link
  // to catering_event_menus on the very next unrelated charges edit. See
  // ChargeRow/rowFromCharge/toPayload in ChargesSection.tsx.
  await supabase.from("catering_event_charges").delete().eq("event_id", eventId);
  if (charges.length > 0) {
    const { error } = await supabase.from("catering_event_charges").insert(
      charges.map((c, i) => ({
        event_id: eventId,
        label: c.label.trim(),
        charge_type: c.charge_type,
        unit_price: c.unit_price,
        quantity: c.quantity,
        amount: c.amount,
        note: c.note?.trim() || null,
        event_menu_id: c.event_menu_id,
        sort_order: (i + 1) * 10,
      })),
    );
    if (error) throw error;
  }

  revalidatePath(`/owner/catering/${eventId}`);
}

/**
 * Adds one line to catering_event_menus (the "what did we order" list) and a
 * matching line to catering_event_charges (the quotation), so the two never
 * drift apart at the moment of entry. They are NOT linked afterward — editing
 * or removing one never touches the other, since the charge may since have
 * been hand-adjusted (a different price agreed, split into two lines, etc).
 *
 * The same dish/set added twice bumps quantity on the existing
 * catering_event_menus row instead of creating a duplicate line (that table
 * has no such row to begin with, unlike charges) — but the charge line always
 * inserts fresh, same as every other line in ChargesSection, so duplicates
 * are expected to stack there.
 *
 * Resolves name/price from catering_set_menus or menus only — both already
 * sales-readable sale-price data, never touching ingredients/menu_recipe_items.
 */
export async function addCateringEventMenu(
  eventId: string,
  item: { kind: "set" | "dish"; id: string; quantity: number; note: string | null },
): Promise<void> {
  await requireSales();
  const supabase = await createClient();

  let name: string;
  let unitPrice: number;
  if (item.kind === "set") {
    const { data, error } = await supabase
      .from("catering_set_menus")
      .select("name, price_per_set")
      .eq("id", item.id)
      .single();
    if (error) throw error;
    name = data.name;
    unitPrice = data.price_per_set;
  } else {
    const { data, error } = await supabase
      .from("menus")
      .select("name, selling_price")
      .eq("id", item.id)
      .single();
    if (error) throw error;
    name = data.name;
    unitPrice = data.selling_price;
  }

  let existingQuery = supabase
    .from("catering_event_menus")
    .select("id, quantity")
    .eq("event_id", eventId);
  existingQuery = item.kind === "set"
    ? existingQuery.eq("set_menu_id", item.id)
    : existingQuery.eq("menu_id", item.id);
  const { data: existingRow } = await existingQuery.maybeSingle();

  let eventMenuId: string;

  if (existingRow) {
    eventMenuId = existingRow.id as string;
    const { error } = await supabase
      .from("catering_event_menus")
      .update({ quantity: (existingRow.quantity as number) + item.quantity })
      .eq("id", eventMenuId);
    if (error) throw error;
  } else {
    const { data: last } = await supabase
      .from("catering_event_menus")
      .select("sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextSort = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;
    const { data: created, error } = await supabase
      .from("catering_event_menus")
      .insert({
        event_id: eventId,
        set_menu_id: item.kind === "set" ? item.id : null,
        menu_id: item.kind === "dish" ? item.id : null,
        quantity: item.quantity,
        note: item.note?.trim() || null,
        sort_order: nextSort,
      })
      .select("id")
      .single();
    if (error) throw error;
    eventMenuId = created.id;
  }

  const { data: lastCharge } = await supabase
    .from("catering_event_charges")
    .select("sort_order")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextChargeSort = ((lastCharge?.[0]?.sort_order as number | undefined) ?? 0) + 10;
  const { error: chargeError } = await supabase.from("catering_event_charges").insert({
    event_id: eventId,
    label: name,
    charge_type: "food",
    unit_price: unitPrice,
    quantity: item.quantity,
    amount: unitPrice * item.quantity,
    note: item.note?.trim() || null,
    event_menu_id: eventMenuId,
    sort_order: nextChargeSort,
  });
  if (chargeError) throw chargeError;

  revalidatePath(`/owner/catering/${eventId}`);
}

/**
 * Relies entirely on catering_event_charges.event_menu_id's ON DELETE
 * CASCADE (see catering_event_menu_link_migration.sql) to remove every
 * charge line this menu row is linked to — a single menu row can be linked
 * to more than one charge row (re-adding the same dish/set bumps quantity
 * here but always inserts a fresh charge, see addCateringEventMenu above),
 * so an explicit single-row delete here would miss the rest. No separate
 * catering_event_charges delete needed.
 */
export async function removeCateringEventMenu(id: string, eventId: string): Promise<void> {
  await requireSales();
  const supabase = await createClient();
  const { error } = await supabase.from("catering_event_menus").delete().eq("id", id);
  if (error) throw error;
  revalidatePath(`/owner/catering/${eventId}`);
}

/**
 * Issues (or re-issues) the quotation. Recomputes quoted_total from the
 * catering_event_charges rows actually in the database — not from whatever
 * the caller thinks the total is — so this must run after
 * saveCateringCharges, never before.
 *
 * quote_number is assigned once via next_catering_quote_seq() (see
 * supabase/catering_quote_sequence_function.sql) and never changes after
 * that; quote_revision increments on every subsequent call.
 */
export async function issueCateringQuote(eventId: string): Promise<void> {
  await requireSales();
  const supabase = await createClient();

  const { data: charges, error: chargesError } = await supabase
    .from("catering_event_charges")
    .select("amount")
    .eq("event_id", eventId);
  if (chargesError) throw chargesError;
  const total = (charges ?? []).reduce((sum, c) => sum + (c.amount as number), 0);

  const { data: event, error: eventError } = await supabase
    .from("catering_events")
    .select("quote_number, quote_revision")
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;

  let quoteNumber = event.quote_number as string | null;
  const nextRevision = quoteNumber ? ((event.quote_revision as number) ?? 0) + 1 : 0;

  if (!quoteNumber) {
    const now = new Date();
    const beYY = String((now.getFullYear() + 543) % 100).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yymm = `${beYY}${mm}`;

    const { data: seq, error: seqError } = await supabase.rpc("next_catering_quote_seq", { p_yymm: yymm });
    if (seqError) throw seqError;
    quoteNumber = `QSP-IN${yymm}-${String(seq as number).padStart(3, "0")}`;
  }

  const { error: updateError } = await supabase
    .from("catering_events")
    .update({
      quote_number: quoteNumber,
      quote_revision: nextRevision,
      quoted_total: total,
      quoted_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (updateError) throw updateError;

  revalidatePath("/owner/catering");
  revalidatePath(`/owner/catering/${eventId}`);
  revalidatePath(`/owner/catering/${eventId}/quote`);
}

export async function deleteCateringEvent(id: string): Promise<void> {
  await requireSales();
  const supabase = await createClient();
  // catering_event_staff rows go with it via ON DELETE CASCADE.
  const { error } = await supabase.from("catering_events").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering");
}
