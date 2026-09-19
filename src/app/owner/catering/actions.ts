"use server";

import { revalidatePath } from "next/cache";
import { requireSales, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { swapSortOrder } from "@/lib/reorder";
import { findRoomConflict } from "./conflict";
import type { RoomConflictCandidate } from "./conflict";
import { calendarGridRange } from "./calendar-grid";
import { eventMenuAccess } from "@/lib/event-menu-access";
import { isSetLine, resolveDishes, type DishSource, type EventMenuDish } from "./event-menu";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CateringCustomer = {
  id: string;
  name: string;
  phone: string | null;
  line_id: string | null;
  company_name: string | null;
  address: string | null;
  contact_person: string | null;
  tax_id: string | null;
  note: string | null;
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
  /** employees.takes_bookings through the view: may be the taker of a booking. */
  takes_bookings: boolean;
};

export type CateringEvent = {
  id: string;
  created_at: string;
  /** Bumped by trg_catering_events_updated_at on every row update — use for staleness, not a display timestamp. */
  updated_at: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  /** catering_customers.line_id — the service function sheet prints it, because
   *  that is how Nik's team actually reaches a catering customer. */
  customer_line_id: string | null;
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
  /** ประเภทงาน — what the party is FOR. NULL is normal: a booking can be
   *  taken before anyone asks. Distinct from booking_type above, which is
   *  จองโต๊ะ/จองห้อง/จองงานจัดเลี้ยง. */
  event_type_id: string | null;
  /** Joined from catering_event_types. The label lives only there, so a
   *  rename reaches every booking — see the migration header for why this is
   *  a FK and not a copied label the way charges keep theirs. */
  event_type_label: string | null;
  food_format: string | null;
  table_count: number | null;
  reserve_tables: number | null;
  table_label: string | null;
  guest_count: number | null;
  music_type: string;
  music_note: string | null;
  status: string;
  deposit_amount: number | null;
  /** The AGREED percentage (catering_event_deposit_percent_migration.sql).
   *  deposit_amount above is what was actually RECEIVED and stays the
   *  authority — the two are deliberately separate. NULL means not yet
   *  agreed, which prints as a blank, never as 0. */
  deposit_percent: number | null;
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
  /** Non-null once [id]/cost/actions.ts's lockCateringEventCost() has run —
   *  a timestamp, never the cost figures themselves, so sales-facing code
   *  (ChargesSection.tsx) can gate on "is cost locked" without needing
   *  access to catering_event_cost_snapshots (owner/admin-only RLS). Set
   *  and cleared ONLY by lockCateringEventCost()/unlockCateringEventCost()
   *  — never included in upsertCateringEvent's payload below, so the
   *  ordinary sales-facing edit form can never touch it. */
  cost_locked_at: string | null;
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
  /** Which rate produced this charge (rate-picker inserts only) — NULL for
   *  menu lines, hand-typed lines, discounts, and every charge from before
   *  catering_rate_provenance_migration.sql. */
  rate_id: string | null;
  /** The linked rate's type and customer label, joined at read. Structural
   *  facts the UI used to guess from label text: rate_type drives the price
   *  box section, rate_display_label the printed name on the quote. */
  rate_type: string | null;
  rate_display_label: string | null;
  /** Derived from the linked catering_event_menus row's set_menu_id/menu_id
   *  (see getCateringCharges) — null whenever event_menu_id is null. Purely
   *  a display tag ("ชุดเมนู"/"เมนูเดี่ยว") for the unified line-item table;
   *  never round-tripped back through saveCateringCharges. */
  event_menu_kind: "set" | "dish" | null;
};

export type CateringRate = {
  id: string;
  rate_type: string;
  /** Internal name — what staff pick from; stays on the booking screen and
   *  both function sheets. */
  label: string;
  /** Customer-facing name, printed on quote/deposit/invoice ONLY. NULL =
   *  fall back to label. See catering_rate_provenance_migration.sql. */
  display_label: string | null;
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
  /** "set": a shared set, or a custom set that names neither a set nor a dish; "dish": a single dish (event-menu.ts isSetLine). */
  kind: "set" | "dish";
  /**
   * The set's name as THIS booking knows it — stamped when its dishes were
   * copied (catering_copy_set_menu) or typed for a custom set; null on a set
   * line from before the copy existed and on a dish line. Its presence is
   * what says "a copy was made", whatever the copy holds now. Read
   * tolerantly: until the migration runs the column is absent and every line
   * reads as not copied.
   */
  set_name: string | null;
  copied: boolean;
  name: string;
  quantity: number;
  note: string | null;
  /** menus.selling_price for a DISH line — the kitchen sheet prints it as the
   *  portion size on รายการอาหารเพิ่มเติม rows. null for a set line, whose
   *  dishes carry their own prices through the set expansion. */
  selling_price: number | null;
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
  /**
   * Rows per section, keyed by section value — the list row shows the whole
   * breakdown so an incomplete package is visible without opening it.
   *
   * Replaces the old `dish_count`, which counted every row and was named as
   * though it counted dishes. Once a package can hold a dessert, a drink and
   * four free items, "13 เมนู" stops being an answer to any question.
   */
  section_counts: Record<string, number>;
};

export type CateringSetMenuItem = {
  id: string;
  menu_id: string;
  menu_name: string;
  quantity: number;
  note: string | null;
  /** dish | dessert | drink | free — which group this row prints under on the
   *  three documents. See catering_set_menu_sections_migration.sql. */
  section: string;
  /** menus.selling_price. On the KITCHEN sheet this is the PORTION SIZE the
   *  chef plates to, not a cost and not a total — see src/lib/kitchen-sheet.ts.
   *  menus already grants SELECT to sales (sales_read_menus), the same grant
   *  getCateringDishOptions relies on, so this exposes nothing new. */
  selling_price: number;
};

const CATERING_EVENT_SELECT = `
  id, created_at, updated_at, customer_id, event_date, start_time, end_time,
  location_type, venue, room_portion, offsite_address, offsite_distance_km, floor_level,
  booking_type, event_type_id, food_format, table_count, reserve_tables, table_label, guest_count,
  music_type, music_note, status,
  deposit_amount, deposit_percent, deposit_paid_at, detail_note, kitchen_note, created_by,
  quote_number, quote_revision, quoted_total, quoted_at, cost_locked_at,
  catering_customers(name, phone, line_id, company_name, address, contact_person),
  catering_event_types(label),
  catering_event_staff(employee_id),
  profiles(full_name)
`;

function mapEventRow(r: Record<string, unknown>): CateringEvent {
  const cust = r.catering_customers as {
    name: string; phone: string | null; line_id: string | null; company_name: string | null;
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
    customer_line_id: cust?.line_id ?? null,
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
    event_type_id: r.event_type_id as string | null,
    event_type_label: (r.catering_event_types as { label: string } | null)?.label ?? null,
    food_format: r.food_format as string | null,
    table_count: r.table_count as number | null,
    reserve_tables: r.reserve_tables as number | null,
    table_label: r.table_label as string | null,
    guest_count: r.guest_count as number | null,
    music_type: r.music_type as string,
    music_note: r.music_note as string | null,
    status: r.status as string,
    deposit_amount: r.deposit_amount as number | null,
    deposit_percent: r.deposit_percent as number | null,
    deposit_paid_at: r.deposit_paid_at as string | null,
    detail_note: r.detail_note as string | null,
    kitchen_note: r.kitchen_note as string | null,
    created_by: r.created_by as string | null,
    created_by_name: creator?.full_name ?? null,
    quote_number: r.quote_number as string | null,
    quote_revision: r.quote_revision as number,
    quoted_total: r.quoted_total as number | null,
    quoted_at: r.quoted_at as string | null,
    cost_locked_at: r.cost_locked_at as string | null,
    staff_ids: staff.map((s) => s.employee_id),
  };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getCateringCustomers(): Promise<CateringCustomer[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_customers")
    .select("id,name,phone,line_id,company_name,address,contact_person,tax_id,note")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getCateringCustomer(id: string): Promise<CateringCustomer | null> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_customers")
    .select("id,name,phone,line_id,company_name,address,contact_person,tax_id,note")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export type CateringCustomerListItem = {
  id: string;
  name: string;
  phone: string | null;
  company_name: string | null;
  event_count: number;
  last_event_date: string | null;
};

/**
 * Two plain queries + in-memory grouping, not a view/RPC — simplest thing
 * that works at this app's scale (every other list page in this module is
 * unpaginated too). Counts/dates are catering bookings only (booking_type
 * = 'catering'), matching the pipeline/status page's same scope decision.
 */
export async function getCateringCustomerList(): Promise<CateringCustomerListItem[]> {
  await requireSales();
  const supabase = await createClient();
  const [{ data: customers, error: custError }, { data: events, error: evError }] = await Promise.all([
    supabase.from("catering_customers").select("id, name, phone, company_name").order("name"),
    supabase.from("catering_events").select("customer_id, event_date").eq("booking_type", "catering"),
  ]);
  if (custError) throw custError;
  if (evError) throw evError;

  const statsByCustomer = new Map<string, { count: number; lastDate: string | null }>();
  for (const e of events ?? []) {
    const customerId = e.customer_id as string | null;
    if (!customerId) continue;
    const s = statsByCustomer.get(customerId) ?? { count: 0, lastDate: null };
    s.count += 1;
    const eventDate = e.event_date as string;
    if (!s.lastDate || eventDate > s.lastDate) s.lastDate = eventDate;
    statsByCustomer.set(customerId, s);
  }

  return (customers ?? []).map((c: Record<string, unknown>) => {
    const s = statsByCustomer.get(c.id as string);
    return {
      id: c.id as string,
      name: c.name as string,
      phone: c.phone as string | null,
      company_name: c.company_name as string | null,
      event_count: s?.count ?? 0,
      last_event_date: s?.lastDate ?? null,
    };
  });
}

export type CateringCustomerEventSummary = {
  id: string;
  event_date: string;
  location_type: string;
  venue: string | null;
  room_portion: string | null;
  status: string;
  quote_number: string | null;
  quoted_total: number | null;
};

export async function getCateringCustomerEvents(customerId: string): Promise<CateringCustomerEventSummary[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_events")
    .select("id, event_date, location_type, venue, room_portion, status, quote_number, quoted_total")
    .eq("customer_id", customerId)
    .eq("booking_type", "catering")
    .order("event_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CateringCustomerEventSummary[];
}

export async function updateCateringCustomer(
  id: string,
  data: {
    name: string;
    phone: string | null;
    line_id: string | null;
    company_name: string | null;
    address: string | null;
    contact_person: string | null;
    tax_id: string | null;
    note: string | null;
  },
): Promise<void> {
  await requireSales();
  const supabase = await createClient();
  const { error } = await supabase
    .from("catering_customers")
    .update({
      name: data.name.trim(),
      phone: data.phone?.trim() || null,
      line_id: data.line_id?.trim() || null,
      company_name: data.company_name?.trim() || null,
      address: data.address?.trim() || null,
      contact_person: data.contact_person?.trim() || null,
      tax_id: data.tax_id?.trim() || null,
      note: data.note?.trim() || null,
    })
    .eq("id", id);
  if (error) throw error;
  revalidatePath(`/owner/catering/customers/${id}`);
  revalidatePath("/owner/catering/customers");
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
    .select("id,nickname,full_name,department_name,is_active,takes_bookings,sort_order")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    nickname: r.nickname as string | null,
    full_name: r.full_name as string,
    department_name: r.department_name as string | null,
    is_active: (r.is_active as boolean) ?? false,
    takes_bookings: (r.takes_bookings as boolean) ?? false,
  }));
}

/**
 * For the list page (both เดือน and ปี modes) only — calendar/page.tsx uses
 * getCateringEventsForCalendar() below instead (needs a wider date range to
 * cover the grid's muted adjacent-month days, which this month-only range
 * can't). Deliberately unscoped by booking_type — this is a general
 * table/room/catering booking log, not a catering-only view (new bookings
 * created here default to booking_type='table', see blankForm() in
 * shared.tsx). Adding an .eq("booking_type", "catering") filter here once
 * hid every table/room booking from production and had to be reverted (see
 * git history) — the status/customers pages are legitimately catering-
 * scoped by purpose; this one and the calendar are not. Do not add that
 * filter here again.
 */
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

/**
 * For calendar/page.tsx only. Deliberately unscoped by booking_type — same
 * general table/room/catering log as getCateringEvents() above (see its
 * comment; don't add that filter here either — same standing constraint).
 * Range is widened beyond the viewed month to cover every cell the grid can
 * render, including muted leading/trailing days from adjacent months — see
 * calendar-grid.ts for why the fetch range and the render grid share one
 * source of truth instead of being computed twice (that mismatch is exactly
 * how adjacent-month days ended up unable to ever show event markers).
 */
export async function getCateringEventsForCalendar(year: number, month: number): Promise<CateringEvent[]> {
  await requireSales();
  const supabase = await createClient();
  const { start, end } = calendarGridRange(year, month);

  const { data, error } = await supabase
    .from("catering_events")
    .select(CATERING_EVENT_SELECT)
    .gte("event_date", start)
    .lte("event_date", end)
    .order("event_date")
    .order("start_time", { nullsFirst: true });

  if (error) throw error;
  return (data ?? []).map((r) => mapEventRow(r as unknown as Record<string, unknown>));
}

/**
 * For the list page's ปี (year) view — same unscoped booking_type as
 * getCateringEvents() above (this page is a general table/room/catering
 * booking log, not catering-only — see the note on getCateringEvents),
 * just spanning a full year instead of one month.
 */
export async function getCateringEventsForYear(year: number): Promise<CateringEvent[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_events")
    .select(CATERING_EVENT_SELECT)
    .gte("event_date", `${year}-01-01`)
    .lte("event_date", `${year}-12-31`)
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
    .select("id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, rate_id, catering_event_menus(set_menu_id, menu_id), catering_rates(rate_type, display_label)")
    .eq("event_id", eventId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const linked = r.catering_event_menus as { set_menu_id: string | null; menu_id: string | null } | null;
    // A custom set names neither a set nor a dish and is still a set line.
    const event_menu_kind: "set" | "dish" | null = linked ? (isSetLine(linked) ? "set" : "dish") : null;
    const rate = r.catering_rates as { rate_type: string; display_label: string | null } | null;
    return {
      id: r.id as string,
      label: r.label as string,
      charge_type: r.charge_type as string,
      unit_price: r.unit_price as number,
      quantity: r.quantity as number,
      amount: r.amount as number,
      note: r.note as string | null,
      event_menu_id: r.event_menu_id as string | null,
      event_menu_kind,
      rate_id: r.rate_id as string | null,
      rate_type: rate?.rate_type ?? null,
      rate_display_label: rate?.display_label ?? null,
    };
  });
}

export async function getCateringRates(): Promise<CateringRate[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_rates")
    .select("id, rate_type, label, display_label, amount, unit, note, min_distance_km, max_distance_km, sort_order, is_active")
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
    .select("id, rate_type, label, display_label, amount, unit, note, min_distance_km, max_distance_km, sort_order, is_active")
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
    // catering_event_charges(label): a CUSTOM set (catering per-event menus)
    // names neither a shared set nor a dish, so its name is the label of the
    // charge created with it. Read from the charge rather than the new
    // set_name column so this query needs nothing the migration adds.
    .select("id, set_menu_id, menu_id, quantity, note, set_name, catering_set_menus(name), menus(name, selling_price), catering_event_charges(label)")
    .eq("event_id", eventId)
    .order("sort_order");
  // Until catering_event_menu_items_migration.sql runs there is no set_name
  // column and this read fails. Read again without it, so the booking screen
  // keeps working before the SQL; every line then reads as not copied.
  const rows = error && isMissingSchemaError(error)
    ? await supabase
        .from("catering_event_menus")
        .select("id, set_menu_id, menu_id, quantity, note, catering_set_menus(name), menus(name, selling_price), catering_event_charges(label)")
        .eq("event_id", eventId)
        .order("sort_order")
        .then((res) => { if (res.error) throw res.error; return (res.data ?? []) as Record<string, unknown>[]; })
    : (() => { if (error) throw error; return (data ?? []) as Record<string, unknown>[]; })();
  return rows.map((r: Record<string, unknown>) => {
    const setMenu = r.catering_set_menus as { name: string } | null;
    const dish = r.menus as { name: string; selling_price: number } | null;
    const linkedCharges = r.catering_event_charges as { label: string }[] | null;
    const line = { set_menu_id: r.set_menu_id as string | null, menu_id: r.menu_id as string | null };
    const set_name = (r.set_name as string | null | undefined) ?? null;
    return {
      id: r.id as string,
      set_menu_id: line.set_menu_id,
      menu_id: line.menu_id,
      kind: isSetLine(line) ? "set" as const : "dish" as const,
      set_name,
      copied: set_name != null,
      // The booking's own name for the set first — a shared set renamed later
      // must not rename a past booking's menu (review, 2026-09-19).
      name: set_name ?? setMenu?.name ?? dish?.name ?? linkedCharges?.[0]?.label ?? "ชุดเมนูของงาน",
      quantity: r.quantity as number,
      note: r.note as string | null,
      selling_price: dish?.selling_price ?? null,
    };
  });
}

// ─── Activity log ───────────────────────────────────────────────────────────
// Simple who/what/when, no field-level diffs. Every event-scoped write
// action below calls logCateringActivity() right after its own write
// succeeds. deleteCateringEvent is deliberately NOT logged — the log rows
// cascade-delete along with the event, so a "deleted" entry would never be
// visible to anyone.

export type CateringActivityLogEntry = {
  id: string;
  action_key: string;
  description: string;
  created_at: string;
  actor_name: string | null;
};

export async function getCateringActivityLog(eventId: string): Promise<CateringActivityLogEntry[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_activity_log")
    .select("id, action_key, description, created_at, profiles(full_name)")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    action_key: r.action_key as string,
    description: r.description as string,
    created_at: r.created_at as string,
    actor_name: (r.profiles as { full_name: string } | null)?.full_name ?? null,
  }));
}

// No row came back from a history update or delete: the line is already gone
// (another tab deleted it), or the database refused it, which it does for
// every one until catering_history_owner_edit_migration.sql has run. Once it
// has, only the first cause is left, so that one leads. Not exported: a
// "use server" file may export only async functions.
const HISTORY_WRITE_REFUSED =
  "ทำไม่สำเร็จ — ไม่พบบรรทัดนี้ (อาจถูกลบไปแล้ว) หรือฐานข้อมูลยังไม่อนุญาตให้แก้ไขประวัติ (ต้องรัน catering_history_owner_edit_migration.sql ก่อน)";

/**
 * The owner corrects a history line's TEXT, from the booking page (Nik,
 * 2026-09-17: he cannot use the Supabase dashboard). Who wrote the line,
 * when, and for which booking stay as written. The database enforces both
 * the owner-only rule and the text-only rule
 * (catering_history_owner_edit_migration.sql); until that file has run it
 * refuses every update by matching no row, so "no row changed" is reported
 * as a refusal here rather than as success. Returned, not thrown, so the
 * owner reads the reason in production.
 */
export async function updateCateringActivityLine(
  eventId: string,
  lineId: string,
  description: string,
): Promise<{ error?: string }> {
  const profile = await requireSales();
  if (profile.role !== "owner") return { error: "แก้ไขประวัติได้เฉพาะเจ้าของร้าน" };
  const text = description.trim();
  if (!text) return { error: "กรุณาใส่ข้อความ" };
  if (text.length > 500) return { error: "ข้อความยาวเกิน 500 ตัวอักษร" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_activity_log")
    .update({ description: text })
    .eq("id", lineId)
    .eq("event_id", eventId)
    .select("id");
  if (error) return { error: `แก้ไขไม่สำเร็จ: ${error.message}` };
  if (!data || data.length === 0) return { error: HISTORY_WRITE_REFUSED };
  revalidatePath(`/owner/catering/${eventId}`);
  return {};
}

/** The owner removes a history line. Same rules and reporting as updateCateringActivityLine. */
export async function deleteCateringActivityLine(eventId: string, lineId: string): Promise<{ error?: string }> {
  const profile = await requireSales();
  if (profile.role !== "owner") return { error: "ลบประวัติได้เฉพาะเจ้าของร้าน" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_activity_log")
    .delete()
    .eq("id", lineId)
    .eq("event_id", eventId)
    .select("id");
  if (error) return { error: `ลบไม่สำเร็จ: ${error.message}` };
  if (!data || data.length === 0) return { error: HISTORY_WRITE_REFUSED };
  revalidatePath(`/owner/catering/${eventId}`);
  return {};
}

/**
 * Best-effort: a logging failure must never fail the write that already
 * succeeded by the time this runs — the user's actual change (event saved,
 * quote issued, box checked, ...) already went through.
 */
async function logCateringActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  actorId: string,
  actionKey: string,
  description: string,
): Promise<void> {
  const { error } = await supabase.from("catering_event_activity_log").insert({
    event_id: eventId,
    actor: actorId,
    action_key: actionKey,
    description,
  });
  if (error) console.error("logCateringActivity failed:", error);
}

/**
 * Throws if the event's cost has been locked (see lockCateringEventCost in
 * [id]/cost/actions.ts) — called before any write that would change what a
 * locked P&L was computed from (menu quantities, charges, labor entries).
 * The UI already disables the controls that reach these functions, but that
 * alone isn't a "permanently frozen" guarantee — this is the server-side
 * backstop. cost_locked_at is sales-readable (see its comment on
 * CateringEvent in the type above), so this check works under either role's
 * RLS without needing admin access to catering_event_cost_snapshots.
 */
async function assertCostNotLocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("catering_events")
    .select("cost_locked_at")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  // maybeSingle() returns { data: null, error: null } for zero matching
  // rows — distinguish that from "found, but unlocked" explicitly, so a
  // bad/stale eventId fails with a clear message instead of silently
  // passing the guard and only failing later (or not at all, for a delete
  // matching zero rows) inside the caller's own write.
  if (!data) throw new Error("ไม่พบข้อมูลงาน");
  if (data.cost_locked_at) {
    throw new Error("ต้นทุนของงานนี้ถูกล็อกแล้ว ปลดล็อกก่อนจึงจะแก้ไขได้");
  }
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
    // section rather than count(): the list needs the breakdown, not a total,
    // and counting in JS avoids one embedded aggregate per section. A package
    // holds of the order of ten rows, so this is cheaper than it looks.
    .select("id, name, description, price_per_set, serves_guests, is_active, catering_set_menu_items(section)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const rows = (r.catering_set_menu_items as { section: string }[] | null) ?? [];
    const section_counts: Record<string, number> = {};
    for (const row of rows) section_counts[row.section] = (section_counts[row.section] ?? 0) + 1;
    return {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string | null,
      price_per_set: r.price_per_set as number,
      serves_guests: r.serves_guests as number | null,
      is_active: r.is_active as boolean,
      section_counts,
    };
  });
}

export async function getCateringSetMenuItems(setMenuId: string): Promise<CateringSetMenuItem[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_set_menu_items")
    .select("id, menu_id, quantity, note, section, menus(name, selling_price)")
    .eq("set_menu_id", setMenuId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    menu_id: r.menu_id as string,
    menu_name: (r.menus as { name: string; selling_price: number } | null)?.name ?? "-",
    selling_price: (r.menus as { selling_price: number } | null)?.selling_price ?? 0,
    quantity: r.quantity as number,
    note: r.note as string | null,
    section: r.section as string,
  }));
}

/**
 * The same rows as getCateringSetMenuItems, for MANY sets at once and behind
 * requireSales() instead of requireAdmin() — the service function sheet is a
 * service-team document and a sales session must be able to print it.
 *
 * A separate function rather than relaxing the gate above, deliberately.
 * getCateringSetMenuItems is called by the set-menu editor and by the event
 * cost page, both of which are admin-only by design and say so at the top of
 * their files; widening its gate would widen theirs. Nothing here is
 * cost-bearing — this table holds no price and no recipe, only which dish sits
 * in which package — and RLS on catering_set_menu_items already admits
 * 'sales', so this grants no access the role did not have.
 *
 * One query for every set on the booking, keyed by set_menu_id, rather than
 * the per-set loop the cost page does.
 */
export async function getCateringSetMenuItemsForSets(
  setMenuIds: string[],
): Promise<Map<string, CateringSetMenuItem[]>> {
  await requireSales();
  const out = new Map<string, CateringSetMenuItem[]>();
  if (setMenuIds.length === 0) return out;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_set_menu_items")
    .select("id, set_menu_id, menu_id, quantity, note, section, menus(name, selling_price)")
    .in("set_menu_id", setMenuIds)
    .order("sort_order");
  if (error) throw error;
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const key = r.set_menu_id as string;
    const list = out.get(key) ?? [];
    list.push({
      id: r.id as string,
      menu_id: r.menu_id as string,
      menu_name: (r.menus as { name: string; selling_price: number } | null)?.name ?? "-",
      selling_price: (r.menus as { selling_price: number } | null)?.selling_price ?? 0,
      quantity: r.quantity as number,
      note: r.note as string | null,
      section: r.section as string,
    });
    out.set(key, list);
  }
  return out;
}

export async function saveCateringSetMenu(data: {
  id?: string;
  name: string;
  description: string | null;
  price_per_set: number;
  serves_guests: number | null;
  items: { menu_id: string; quantity: number; note: string | null; section: string }[];
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
  // Checked, not fire-and-forget: this is a replace, so if the delete fails
  // silently and the insert below succeeds, the set ends up with the new rows
  // ON TOP of the old ones rather than instead of them. Duplication is worse
  // than the save failing outright — it looks like success.
  {
    const { error } = await supabase.from("catering_set_menu_items").delete().eq("set_menu_id", setMenuId);
    if (error) throw error;
  }
  if (data.items.length > 0) {
    const { error } = await supabase.from("catering_set_menu_items").insert(
      data.items.map((it, i) => ({
        set_menu_id: setMenuId,
        menu_id: it.menu_id,
        quantity: it.quantity,
        note: it.note?.trim() || null,
        // Sent explicitly rather than left to the column default: this is a
        // replace, so every row is an INSERT and a row whose section the admin
        // changed from 'dish' would silently revert on the next save.
        section: it.section,
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
  display_label: string | null;
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
    display_label: string | null;
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

/**
 * One column, inline from the ราคา list rows — the modal field survives, but
 * filling 20 rates through 20 modals is the kind of chore that does not get
 * done, and an unfilled display_label is the whole reason a customer still
 * reads "ระยะ 11-15 กม.".
 *
 * NORMALISED TO NULL server-side, not only in the client: blank means "use
 * the internal label", and a value EQUAL to the internal label saves as NULL
 * too — otherwise a later rename of the internal label would leave a stale
 * copy that looks deliberate. NULL-as-fallback is the living link; a copy is
 * a snapshot pretending to be one.
 */
export async function updateCateringRateDisplayLabel(id: string, displayLabel: string | null): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const trimmed = displayLabel?.trim() || null;
  const { data: row, error: readError } = await supabase
    .from("catering_rates").select("label").eq("id", id).single();
  if (readError) throw readError;
  const value = trimmed !== null && trimmed === (row.label as string).trim() ? null : trimmed;
  const { error } = await supabase.from("catering_rates").update({ display_label: value }).eq("id", id);
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

  try {
    await swapSortOrder(supabase, "catering_rates", "id", siblings[idx]!.id, siblings[swapIdx]!.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "สลับลำดับไม่สำเร็จ" };
  }

  revalidatePath("/owner/catering/settings");
  return {};
}

// ─── ประเภทงาน (catering_event_types) ──────────────────────────────────────
//
// Mirrors the rate management above — same is_active convention, same
// sort_order in tens, same reorder-by-swap — with ONE deliberate difference,
// in deleteCateringEventType: a type a booking uses cannot be deleted.
//
// These return a discriminated result instead of throwing, unlike the rate
// actions a few lines up. Item 12 converted the rest of the app and
// deliberately skipped catering; new code here follows the converted shape
// because the delete refusal is a message a person must READ, and production
// redacts thrown Server Action messages.

export type CateringEventType = {
  id: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export type EventTypeResult = { status: "ok" } | { status: "error"; message: string };

function mapEventType(r: Record<string, unknown>): CateringEventType {
  return {
    id: r.id as string,
    label: r.label as string,
    sort_order: (r.sort_order as number) ?? 0,
    is_active: (r.is_active as boolean) ?? true,
  };
}

/** The picker: ACTIVE types only, so a retired one disappears from new bookings. */
export async function getCateringEventTypes(): Promise<CateringEventType[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("catering_event_types")
    .select("id, label, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order");
  return (data ?? []).map(mapEventType);
}

/** The settings screen: every type, active or not. */
export async function getAllCateringEventTypes(): Promise<CateringEventType[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("catering_event_types")
    .select("id, label, sort_order, is_active")
    .order("sort_order");
  return (data ?? []).map(mapEventType);
}

/** How many bookings carry each type — so the delete refusal can say a number. */
export async function getCateringEventTypeUsage(): Promise<Record<string, number>> {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase
    .from("catering_events")
    .select("event_type_id")
    .not("event_type_id", "is", null);
  const counts: Record<string, number> = {};
  for (const r of data ?? []) {
    const id = r.event_type_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export async function addCateringEventType(label: string): Promise<EventTypeResult> {
  await requireAdmin();
  const name = label.trim();
  if (!name) return { status: "error", message: "กรุณาใส่ชื่อประเภทงาน" };
  const supabase = await createClient();

  const { data: last } = await supabase
    .from("catering_event_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;

  const { error } = await supabase.from("catering_event_types").insert({ label: name, sort_order: nextSort });
  // 23505 is the UNIQUE (label) constraint. Two types reading the same on a
  // printed sheet would be worse than a refusal.
  if (error) {
    return {
      status: "error",
      message: error.code === "23505" ? `มี "${name}" อยู่แล้ว` : error.message,
    };
  }
  revalidatePath("/owner/catering/settings");
  return { status: "ok" };
}

export async function renameCateringEventType(id: string, label: string): Promise<EventTypeResult> {
  await requireAdmin();
  const name = label.trim();
  if (!name) return { status: "error", message: "กรุณาใส่ชื่อประเภทงาน" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("catering_event_types")
    .update({ label: name, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return {
      status: "error",
      message: error.code === "23505" ? `มี "${name}" อยู่แล้ว` : error.message,
    };
  }
  // A rename reaches every booking of that kind, by design — the label lives
  // only in this table. Both function sheets read it through the join.
  revalidatePath("/owner/catering", "layout");
  return { status: "ok" };
}

export async function toggleCateringEventTypeActive(id: string, isActive: boolean): Promise<EventTypeResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("catering_event_types")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/owner/catering", "layout");
  return { status: "ok" };
}

/**
 * Nik's rule: a type no booking uses is deleted outright; a type in use is
 * NOT — it must be ปิดใช้ instead, so the bookings carrying it keep printing
 * it. The count is read first so the refusal can name how many, and the FK is
 * ON DELETE RESTRICT so the rule still holds if someone assigns the type
 * between this count and the delete.
 */
export async function deleteCateringEventType(id: string): Promise<EventTypeResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { count } = await supabase
    .from("catering_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type_id", id);
  if ((count ?? 0) > 0) {
    return {
      status: "error",
      message: `ลบไม่ได้ — มีการจอง ${count} รายการใช้ประเภทนี้อยู่ ให้กด "ปิดใช้" แทน (งานเดิมจะยังพิมพ์ชื่อนี้ได้)`,
    };
  }

  const { error } = await supabase.from("catering_event_types").delete().eq("id", id);
  if (error) {
    // The database's own refusal, if a booking took this type in the moment
    // between the count above and here.
    return {
      status: "error",
      message: error.code === "23503"
        ? 'ลบไม่ได้ — มีการจองใช้ประเภทนี้อยู่ ให้กด "ปิดใช้" แทน'
        : error.message,
    };
  }
  revalidatePath("/owner/catering/settings");
  return { status: "ok" };
}

/** Same swap-with-neighbour approach as reorderCateringRate. */
export async function reorderCateringEventType(id: string, direction: "up" | "down"): Promise<EventTypeResult> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: siblings } = await supabase
    .from("catering_event_types").select("id,sort_order").order("sort_order");
  if (!siblings) return { status: "error", message: "ไม่พบข้อมูล" };

  const idx = siblings.findIndex((s) => s.id === id);
  if (idx < 0) return { status: "error", message: "ไม่พบรายการ" };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return { status: "ok" };

  try {
    await swapSortOrder(supabase, "catering_event_types", "id", siblings[idx]!.id, siblings[swapIdx]!.id);
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "สลับลำดับไม่สำเร็จ" };
  }

  revalidatePath("/owner/catering/settings");
  return { status: "ok" };
}

// ─── Internal transfer-cost rate management ────────────────────────────────
// owner/admin ONLY — see catering_transfer_cost_rates_rw RLS. Unlike
// catering_rates, sales has zero access here, not even read, so there is no
// sales-safe read function for this table anywhere in this module.

export type CateringTransferCostRate = {
  id: string;
  cost_type: string;
  label: string;
  amount: number;
  unit: string | null;
  sort_order: number;
  is_active: boolean;
};

export async function getCateringTransferCostRates(): Promise<CateringTransferCostRate[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_transfer_cost_rates")
    .select("id, cost_type, label, amount, unit, sort_order, is_active")
    .order("cost_type")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as CateringTransferCostRate[];
}

export async function addCateringTransferCostRate(data: {
  cost_type: string;
  label: string;
  amount: number;
  unit: string | null;
}): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: last } = await supabase
    .from("catering_transfer_cost_rates")
    .select("sort_order")
    .eq("cost_type", data.cost_type)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;

  const { error } = await supabase.from("catering_transfer_cost_rates").insert({ ...data, sort_order: nextSort });
  if (error) throw error;
  revalidatePath("/owner/catering/cost-settings");
}

export async function updateCateringTransferCostRate(
  id: string,
  data: { cost_type: string; label: string; amount: number; unit: string | null },
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("catering_transfer_cost_rates").update(data).eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering/cost-settings");
}

export async function toggleCateringTransferCostRateActive(id: string, isActive: boolean): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("catering_transfer_cost_rates").update({ is_active: isActive }).eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering/cost-settings");
}

export async function deleteCateringTransferCostRate(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("catering_transfer_cost_rates").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering/cost-settings");
}

/** Same swap-sort_order-with-neighbor approach as reorderCateringRate above. */
export async function reorderCateringTransferCostRate(id: string, costType: string, direction: "up" | "down"): Promise<{ error?: string }> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: siblings } = await supabase
    .from("catering_transfer_cost_rates").select("id,sort_order").eq("cost_type", costType).order("sort_order");
  if (!siblings) return { error: "ไม่พบข้อมูล" };

  const idx = siblings.findIndex((s) => s.id === id);
  if (idx < 0) return { error: "ไม่พบรายการ" };
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= siblings.length) return {};

  try {
    await swapSortOrder(supabase, "catering_transfer_cost_rates", "id", siblings[idx]!.id, siblings[swapIdx]!.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "สลับลำดับไม่สำเร็จ" };
  }

  revalidatePath("/owner/catering/cost-settings");
  return {};
}

// ─── Per-event labor/vehicle cost entries ──────────────────────────────────
// owner/admin ONLY — see catering_event_labor RLS; sales has zero access.
// Plain CRUD against a snapshot table, no ingredient/food-cost computation
// here — that lives entirely in [id]/cost/page.tsx (the only other place in
// this module allowed to import getCostingContext/computeMenuCost, see the
// comment there and in set-menus/page.tsx).

export type CateringEventLabor = {
  id: string;
  cost_rate_id: string | null;
  label: string;
  quantity: number;
  unit_amount: number;
  amount: number;
  note: string | null;
};

export async function getCateringEventLabor(eventId: string): Promise<CateringEventLabor[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_labor")
    .select("id, cost_rate_id, label, quantity, unit_amount, amount, note")
    .eq("event_id", eventId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as CateringEventLabor[];
}

export async function addCateringEventLabor(
  eventId: string,
  data: { cost_rate_id: string | null; label: string; quantity: number; unit_amount: number; amount: number; note: string | null },
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await assertCostNotLocked(supabase, eventId);
  const { error } = await supabase.from("catering_event_labor").insert({ event_id: eventId, ...data });
  if (error) throw error;
  revalidatePath(`/owner/catering/${eventId}/cost`);
}

export async function deleteCateringEventLabor(id: string, eventId: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  await assertCostNotLocked(supabase, eventId);
  const { error } = await supabase.from("catering_event_labor").delete().eq("id", id);
  if (error) throw error;
  revalidatePath(`/owner/catering/${eventId}/cost`);
}

// ─── Writes ───────────────────────────────────────────────────────────────────

async function upsertCateringEvent(data: {
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
  event_type_id: string | null;
  food_format: string | null;
  table_count: number | null;
  reserve_tables: number | null;
  table_label: string | null;
  guest_count: number | null;
  music_type: string;
  music_note: string | null;
  status: string;
  deposit_amount: number | null;
  /** The AGREED percentage (catering_event_deposit_percent_migration.sql).
   *  deposit_amount above is what was actually RECEIVED and stays the
   *  authority — the two are deliberately separate. NULL means not yet
   *  agreed, which prints as a blank, never as 0. */
  deposit_percent: number | null;
  deposit_paid_at: string | null;
  detail_note: string | null;
  kitchen_note: string | null;
  staff_ids: string[];
}): Promise<string> {
  const profile = await requireSales();
  const supabase = await createClient();

  let customerId = data.customer_id ?? null;
  if (!customerId && data.new_customer && data.new_customer.name.trim()) {
    const trimmedName = data.new_customer.name.trim();
    const trimmedPhone = data.new_customer.phone?.trim() || null;

    // Dedup safety net: this path runs any time customer_id is null when
    // the form is saved — not just for a genuinely new name. Retyping the
    // query box after picking a suggestion resets customerId to null (see
    // CustomerCombobox's onQueryChange in shared.tsx), and staff can save
    // without ever clicking a dropdown suggestion at all, so a name that
    // already exists can reach here unselected. Match on name alone
    // (case-insensitive) — a shared full name is far more likely the same
    // person (with a new/updated phone) than two different customers, so
    // phone is only a tie-breaker among multiple same-name matches, never
    // a requirement.
    const { data: nameMatches, error: matchError } = await supabase
      .from("catering_customers")
      .select("id, phone")
      .ilike("name", trimmedName);
    if (matchError) throw matchError;

    const existing = nameMatches && nameMatches.length > 0
      ? nameMatches.find((m) => (m.phone as string | null)?.trim() === trimmedPhone) ?? nameMatches[0]
      : null;

    if (existing) {
      customerId = existing.id;
    } else {
      const { data: created, error: custError } = await supabase
        .from("catering_customers")
        .insert({
          name: trimmedName,
          phone: trimmedPhone,
          line_id: data.new_customer.line_id?.trim() || null,
          company_name: data.new_customer.company_name?.trim() || null,
          address: data.new_customer.address?.trim() || null,
          contact_person: data.new_customer.contact_person?.trim() || null,
        })
        .select("id")
        .single();
      if (custError) throw custError;
      customerId = created.id;
    }
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

  // Deliberately no cost_locked_at key here — this function is
  // requireSales()-gated and reachable from the ordinary sales-facing edit
  // form, so it must never write that column. It's set/cleared exclusively
  // by lockCateringEventCost()/unlockCateringEventCost() in
  // [id]/cost/actions.ts, both requireAdmin()-gated. Even setting
  // status: "done" here has no effect on cost_locked_at — the two are
  // deliberately decoupled (see COST_SNAPSHOT_DESIGN.md).
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
    event_type_id: data.event_type_id || null,
    food_format: data.food_format || null,
    table_count: data.table_count,
    reserve_tables: data.reserve_tables,
    table_label: data.table_label?.trim() || null,
    guest_count: data.guest_count,
    music_type: data.music_type,
    music_note: data.music_note?.trim() || null,
    status: data.status,
    deposit_amount: data.deposit_amount,
    deposit_percent: data.deposit_percent,
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

  const isCreate = !data.id;
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
  // Checked for the same reason as the set-menu items above: an unchecked
  // delete before an insert turns a replace into an append, so the event
  // would show every assigned staff member twice.
  {
    const { error } = await supabase.from("catering_event_staff").delete().eq("event_id", eventId);
    if (error) throw error;
  }
  if (data.staff_ids.length > 0) {
    const { error } = await supabase.from("catering_event_staff").insert(
      data.staff_ids.map((employee_id) => ({ event_id: eventId, employee_id, role: "taker" })),
    );
    if (error) throw error;
  }

  await logCateringActivity(
    supabase,
    eventId as string,
    profile.id,
    isCreate ? "created" : "edited",
    isCreate ? "สร้างการจอง" : "แก้ไขข้อมูลงาน",
  );

  revalidatePath("/owner/catering");
  revalidatePath(`/owner/catering/${eventId}`);
  // The id, so the one-screen save (saveBooking) can attach menus and
  // charges to a booking it just created. Existing callers awaited void.
  return eventId as string;
}

/** One line of the booking screen's price box. Menu lines reference a set menu or dish; charge lines are rates, hand-typed items, or the discount. */
export type BookingLine =
  | { kind: "set" | "dish"; refId: string; eventMenuId: string | null; quantity: number }
  | { kind: "charge"; label: string; charge_type: string; unit_price: number; quantity: number; amount: number; note: string | null; rate_id: string | null };

export type SaveBookingResult =
  | { ok: true; id: string; quoteNumber: string | null }
  | { ok: false; error: string };

/**
 * THE ONE SAVE. Booking fields, price box, and optionally the quote number,
 * in one call, in this order — each step relies on the one before:
 *
 *   0. an existing booking's cost lock, before anything is written
 *   1. upsertCateringEvent  → the event id (created or existing)
 *   2. menu lines dropped from the box → removeCateringEventMenu
 *   3. menu lines new to the box      → addCateringEventMenu (creates the
 *                                        catering_event_menus row and its
 *                                        charge at the set/dish price)
 *   4. saveCateringCharges with every line: menu-linked rows carry their
 *      event_menu_id and the box's quantity; rate/manual/discount rows as
 *      typed. This is what keeps catering_event_menus.quantity in sync.
 *   5. issueCateringQuote when asked — it totals from the rows just written.
 *
 * Expected failures are RETURNED (the room-conflict block, a cost lock, a
 * refused charge): production redacts a thrown Server Action message, and a
 * sales person needs to read why the save was refused.
 *
 * Not one transaction: the Supabase client cannot open one, and these
 * steps were already separate writes on the old three-page path. A failure
 * mid-way leaves the booking saved with whatever lines landed, which the
 * screen shows on refresh; nothing here can double a line, because step 4
 * replaces the charge list wholesale.
 *
 * THE FIVE STEPS ARE NOT EXPORTED, deliberately, since 2026-09-16. Every
 * export of a "use server" file is a network-callable endpoint, and until
 * then a sales session could call saveCateringCharges or issueCateringQuote
 * on its own, outside the order above, although nothing in the app did.
 * Each keeps its own requireSales(); the only way in is this function.
 * Do not re-export one to reuse it: call saveBooking.
 */
export async function saveBooking(input: {
  event: Parameters<typeof upsertCateringEvent>[0];
  lines: BookingLine[];
  issueQuote: boolean;
  /**
   * The menu lines the screen HAD when it loaded (their event_menu ids). A
   * line absent from `lines` is removed only if it is here: the screen
   * dropped it. A line absent from both was created since the screen loaded
   * — by the menu page in another tab, since 2026-09-19 a second writer of
   * set lines — and is kept, charge and copy included. Undefined from an
   * older bundle mid-deploy means "every stored line", the old behaviour.
   */
  knownMenuIds?: string[];
}): Promise<SaveBookingResult> {
  await requireSales();
  try {
    // A cost-locked booking is frozen. Steps 2-4 check the lock too, but
    // step 1 ran first and had already rewritten the staff list, created a
    // typed-in customer, added an "แก้ไขข้อมูลงาน" history line and, for
    // owner and admin, saved the booking's own fields by the time they
    // refused (queue item 33). So the lock is checked before any write. Like
    // every other lock check in the app it has no role exception: owner and
    // admin unlock on the cost page first. A refusal is returned by the catch
    // below, so the screen shows it in production.
    if (input.event.id) {
      await assertCostNotLocked(await createClient(), input.event.id);
    }

    const eventId = await upsertCateringEvent(input.event);

    const before = await getCateringCharges(eventId);
    const keptMenuIds = new Set(input.lines.flatMap((l) => (l.kind !== "charge" && l.eventMenuId ? [l.eventMenuId] : [])));
    const known = input.knownMenuIds ? new Set(input.knownMenuIds) : null;
    // Lines the screen never saw are not the screen's to drop.
    const unknownMenuIds = new Set(
      before.flatMap((c) => (c.event_menu_id && !keptMenuIds.has(c.event_menu_id) && known && !known.has(c.event_menu_id) ? [c.event_menu_id] : [])),
    );
    for (const c of before) {
      if (c.event_menu_id && !keptMenuIds.has(c.event_menu_id) && !unknownMenuIds.has(c.event_menu_id)) await removeCateringEventMenu(c.event_menu_id, eventId);
    }
    for (const l of input.lines) {
      if (l.kind !== "charge" && !l.eventMenuId) await addCateringEventMenu(eventId, { kind: l.kind, id: l.refId, quantity: l.quantity, note: null });
    }

    // Re-read: the adds above created event_menu ids the client cannot know.
    const after = await getCateringCharges(eventId);
    const menuRows = await getCateringEventMenus(eventId);
    const chargeByMenuId = new Map(after.filter((c) => c.event_menu_id).map((c) => [c.event_menu_id as string, c]));
    const menuIdByRef = new Map(menuRows.map((m) => [m.set_menu_id ?? m.menu_id ?? "", m.id]));

    const payload: Parameters<typeof saveCateringCharges>[1] = [];
    for (const l of input.lines) {
      if (l.kind === "charge") {
        payload.push({ label: l.label, charge_type: l.charge_type, unit_price: l.unit_price, quantity: l.quantity, amount: l.amount, note: l.note, event_menu_id: null, rate_id: l.rate_id });
        continue;
      }
      const menuId = l.eventMenuId ?? menuIdByRef.get(l.refId);
      const row = menuId ? chargeByMenuId.get(menuId) : undefined;
      if (!row) return { ok: false, error: "บันทึกรายการเมนูไม่สำเร็จ — กรุณาอ่านหน้านี้ใหม่แล้วลองอีกครั้ง" };
      payload.push({
        label: row.label, charge_type: "food", unit_price: row.unit_price,
        quantity: l.quantity, amount: row.unit_price * l.quantity, note: row.note, event_menu_id: row.event_menu_id,
        rate_id: null,
      });
    }
    // The charges of lines the screen never saw, as they are: the replace
    // below would otherwise delete them and leave those lines priceless.
    for (const c of after) {
      if (c.event_menu_id && unknownMenuIds.has(c.event_menu_id)) {
        payload.push({ label: c.label, charge_type: c.charge_type, unit_price: c.unit_price, quantity: c.quantity, amount: c.amount, note: c.note, event_menu_id: c.event_menu_id, rate_id: null });
      }
    }
    await saveCateringCharges(eventId, payload);

    let quoteNumber: string | null = null;
    if (input.issueQuote) {
      await issueCateringQuote(eventId);
      const ev = await getCateringEvent(eventId);
      quoteNumber = ev?.quote_number ?? null;
    }
    return { ok: true, id: eventId, quoteNumber };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" };
  }
}

/**
 * Replaces the full charge list wholesale — same reasoning as
 * catering_event_staff above: simpler than diffing, and the row count per
 * event is tiny.
 */
async function saveCateringCharges(
  eventId: string,
  charges: {
    label: string;
    charge_type: string;
    unit_price: number;
    quantity: number;
    amount: number;
    note: string | null;
    event_menu_id: string | null;
    rate_id: string | null;
  }[],
): Promise<void> {
  const profile = await requireSales();
  const supabase = await createClient();
  await assertCostNotLocked(supabase, eventId);

  // "food" without a linked menu row would claim real recipe cost behind a
  // charge that has none — MenuPicker is the only path that both sets
  // event_menu_id and produces charge_type "food" now: food_set rates are
  // no longer offered anywhere in the quotation-side rate picker (see
  // RATE_PICKER_TYPE_OPTIONS) or creatable in settings, and
  // MANUAL_CHARGE_TYPE_OPTIONS excludes "food" from the hand-typed row's
  // own dropdown — so a legitimate save should never hit this. Server-side
  // because the UI restriction alone isn't a guarantee, same reasoning as
  // assertCostNotLocked above.
  if (charges.some((c) => c.event_menu_id === null && c.charge_type === "food")) {
    throw new Error("รายการที่ไม่ได้เลือกจากเมนู ต้องไม่ใช้ประเภท \"อาหาร\" — ประเภทนี้ใช้ได้เฉพาะรายการที่เพิ่มผ่าน + เพิ่มเมนู เท่านั้น");
  }

  // Deletes and reinserts every row, so event_menu_id MUST be threaded
  // through the caller's payload — otherwise this silently drops every link
  // to catering_event_menus on the very next unrelated charges edit. See
  // ChargeRow/rowFromCharge/toPayload in ChargesSection.tsx.
  // Checked: this is the money-affecting one. saveCateringCharges' whole
  // contract is "replace the charge list wholesale", so an unchecked delete
  // that silently fails leaves the old lines in place and the insert adds the
  // new ones alongside them — a quotation with every line item twice, and a
  // quoted_total to match. Absence would be noticed; duplication might not.
  {
    const { error } = await supabase.from("catering_event_charges").delete().eq("event_id", eventId);
    if (error) throw error;
  }
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
        // Threaded like event_menu_id, and for the same reason: this is a
        // wholesale replace, so a payload without it silently strips every
        // charge of its rate provenance on the next unrelated edit.
        rate_id: c.rate_id,
        sort_order: (i + 1) * 10,
      })),
    );
    if (error) throw error;
  }

  // Keep catering_event_menus.quantity (read by the cost page and the
  // function-sheet) in sync with whatever quantity the sales rep just saved
  // on a menu-linked row — otherwise editing quantity here would silently
  // desync from the "what did we actually order" record. Safe to assume at
  // most one charge row per event_menu_id: addCateringEventMenu bumps the
  // existing linked row in place on repeat-add rather than inserting a
  // second one (see its comment), so there's never an ambiguous group to
  // reconcile here.
  for (const c of charges) {
    if (c.event_menu_id) {
      const { error: syncError } = await supabase
        .from("catering_event_menus")
        .update({ quantity: c.quantity })
        .eq("id", c.event_menu_id);
      if (syncError) throw syncError;
    }
  }

  // One coarse entry per save, not per line item — favors a readable log
  // over a noisy one, per your call.
  await logCateringActivity(supabase, eventId, profile.id, "charges_updated", "แก้ไขรายการค่าใช้จ่าย");

  revalidatePath(`/owner/catering/${eventId}`);
}

/**
 * Adds one line to catering_event_menus (the "what did we order" list) and a
 * matching line to catering_event_charges (the quotation), so the two never
 * drift apart at the moment of entry.
 *
 * The same dish/set added twice bumps quantity on the existing
 * catering_event_menus row AND on its linked charge row (never inserts a
 * second charge row for the same item) — the linked row's label/unit_price
 * stay frozen from the first add, same snapshot-at-write-time convention
 * used elsewhere; only quantity/amount move. This keeps a strict 1:1 between
 * a catering_event_menus row and its charge row, which saveCateringCharges'
 * quantity-sync relies on. Once a row exists, later charge-side edits
 * (label/unit_price/note on a *manual* row, or quantity on any row via
 * saveCateringCharges) are the only way those fields change — this function
 * only ever runs at initial-add or repeat-add time.
 *
 * Resolves name/price from catering_set_menus or menus only — both already
 * sales-readable sale-price data, never touching ingredients/menu_recipe_items.
 */
async function addCateringEventMenu(
  eventId: string,
  item: { kind: "set" | "dish"; id: string; quantity: number; note: string | null },
): Promise<void> {
  const profile = await requireSales();
  const supabase = await createClient();
  await assertCostNotLocked(supabase, eventId);

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

    const { data: linkedCharge } = await supabase
      .from("catering_event_charges")
      .select("id, unit_price, quantity")
      .eq("event_menu_id", eventMenuId)
      .order("sort_order")
      .limit(1)
      .maybeSingle();

    if (linkedCharge) {
      const newQty = (linkedCharge.quantity as number) + item.quantity;
      const { error: bumpError } = await supabase
        .from("catering_event_charges")
        .update({ quantity: newQty, amount: (linkedCharge.unit_price as number) * newQty })
        .eq("id", linkedCharge.id);
      if (bumpError) throw bumpError;

      await logCateringActivity(supabase, eventId, profile.id, "menu_added", `เพิ่มเมนู: ${name}`);
      revalidatePath(`/owner/catering/${eventId}`);
      return;
    }
    // No linked charge found (shouldn't happen — every catering_event_menus
    // row is created together with its charge row below) — fall through to
    // insert one fresh, same as the brand-new-row path.
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
    // PICKING A SET COPIES ITS DISHES INTO THE BOOKING (catering per-event
    // menus, Nik 2026-09-19): from here the copy is the record, and editing it
    // never touches the shared set. The database function does the copy under
    // its own checks, so a sales session gets exactly that and nothing else.
    // Until its migration runs the function is missing; then there is no copy
    // and every screen falls back to the shared set, as before.
    if (item.kind === "set") await copySetMenuIntoLine(supabase, eventMenuId);
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

  await logCateringActivity(supabase, eventId, profile.id, "menu_added", `เพิ่มเมนู: ${name}`);

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
async function removeCateringEventMenu(id: string, eventId: string): Promise<void> {
  const profile = await requireSales();
  const supabase = await createClient();
  await assertCostNotLocked(supabase, eventId);

  // Resolved before the delete purely for the activity-log description —
  // the row (and its name join) won't exist to read afterward.
  const { data: row } = await supabase
    .from("catering_event_menus")
    .select("catering_set_menus(name), menus(name)")
    .eq("id", id)
    .maybeSingle();
  const r = row as Record<string, unknown> | null;
  const setMenu = r?.catering_set_menus as { name: string } | null;
  const dish = r?.menus as { name: string } | null;
  const name = setMenu?.name ?? dish?.name ?? "-";

  const { error } = await supabase.from("catering_event_menus").delete().eq("id", id);
  if (error) throw error;

  await logCateringActivity(supabase, eventId, profile.id, "menu_removed", `ลบเมนู: ${name}`);

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
async function issueCateringQuote(eventId: string): Promise<void> {
  const profile = await requireSales();
  const supabase = await createClient();

  const { data: charges, error: chargesError } = await supabase
    .from("catering_event_charges")
    .select("amount")
    .eq("event_id", eventId);
  if (chargesError) throw chargesError;
  const total = (charges ?? []).reduce((sum, c) => sum + (c.amount as number), 0);

  const { data: event, error: eventError } = await supabase
    .from("catering_events")
    .select("quote_number, quote_revision, location_type")
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;

  const isReissue = !!event.quote_number;
  let quoteNumber = event.quote_number as string | null;
  const nextRevision = quoteNumber ? ((event.quote_revision as number) ?? 0) + 1 : 0;

  if (!quoteNumber) {
    const now = new Date();
    const beYY = String((now.getFullYear() + 543) % 100).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yymm = `${beYY}${mm}`;

    // The prefix reflects location_type AT ISSUE TIME and is deliberately NOT
    // recomputed afterwards. This whole block sits inside if (!quoteNumber),
    // so re-issuing an already-numbered event skips it entirely: the same
    // number is written back and only quote_revision increments. Changing an
    // event from offsite to in-house therefore leaves QSP-OUT... in place
    // while the event itself correctly reads in-house, and that is correct.
    //
    // A quote number is a document reference, not a live status label. It is
    // printed on paper the customer holds; renaming it would mean a customer
    // quoting OUT-001 back at you finds nothing. Standard practice for
    // quotations and invoices is that an issued number is immutable — if the
    // job changes enough to matter, issue a new document. It is also why the
    // two legacy mislabelled numbers were not renamed.
    //
    // Do not "fix" this into staying in sync with the event. Note also that
    // the sequence RPC below is inside the same guard, so a re-issue does not
    // burn a counter value — moving the prefix logic out would break that too.
    //
    // IN for in-house, OUT for offsite. This used to be a hardcoded "IN", and
    // the select above did not even fetch location_type — the data needed to
    // choose was not in scope of the function, which is why this read as an
    // omission rather than a decision. Every offsite quote issued before the
    // fix (2 of 2) carried the wrong prefix.
    //
    // Deliberately no default. location_type is NOT NULL with
    // CHECK (location_type IN ('in_house','offsite')), so a third value cannot
    // exist without a migration — and if someone adds one, they must decide
    // what prefix it takes rather than inheriting whichever branch happened to
    // be the else. Silently falling back to "IN" is precisely the bug being
    // fixed here, so an unknown value stops the issue instead.
    const location = event.location_type as string;
    let prefix: string;
    if (location === "in_house") prefix = "IN";
    else if (location === "offsite") prefix = "OUT";
    else throw new Error(`ไม่รู้จักประเภทสถานที่ "${location}" — ไม่สามารถออกเลขที่ใบเสนอราคาได้`);

    // One shared counter per yymm, both prefixes drawing from it (Nik's call).
    // Numbers stay unique within the month; each prefix's own run has gaps,
    // e.g. an offsite quote after IN-005 is OUT-006. That is why
    // next_catering_quote_seq still takes only p_yymm and needs no migration.
    const { data: seq, error: seqError } = await supabase.rpc("next_catering_quote_seq", { p_yymm: yymm });
    if (seqError) throw seqError;
    quoteNumber = `QSP-${prefix}${yymm}-${String(seq as number).padStart(3, "0")}`;
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

  await logCateringActivity(
    supabase,
    eventId,
    profile.id,
    "quote_issued",
    isReissue ? `ออกใบเสนอราคาใหม่ (แก้ไขครั้งที่ ${nextRevision})` : "ออกใบเสนอราคา",
  );

  revalidatePath("/owner/catering");
  revalidatePath(`/owner/catering/${eventId}`);
  revalidatePath(`/owner/catering/${eventId}/quote`);
}

export async function deleteCateringEvent(id: string): Promise<{ error?: string }> {
  await requireSales();
  const supabase = await createClient();
  // A cost-locked event is frozen, deletion included: its locked P&L would
  // go with it (queue item 33). Returned rather than thrown, so the refusal
  // reaches the person in production, where a thrown message is hidden.
  try {
    await assertCostNotLocked(supabase, id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "ลบไม่สำเร็จ" };
  }
  // catering_event_staff rows go with it via ON DELETE CASCADE.
  const { error } = await supabase.from("catering_events").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering");
  return {};
}

// ─── A booking's own menu (catering per-event menus, round 1 — Nik, 2026-09-19) ──
//
// The dishes a booking carries for each of its set lines: copied from a shared
// set when the set was picked, or added from scratch to a custom set. The copy
// is the record. Who may EDIT is eventMenuAccess() — one place — and every
// write below checks it and the cost lock before touching a row; the database
// (catering_event_menu_items_migration.sql) checks both again.

export type EventMenuActionResult = { status: "ok" } | { status: "error"; message: string };

type Db = Awaited<ReturnType<typeof createClient>>;

const EVENT_MENU_SECTIONS = ["dish", "dessert", "drink", "free"];
const EDIT_REFUSED = "เฉพาะเจ้าของร้านและผู้จัดการเท่านั้นที่แก้ไขรายการอาหารของงานได้";
const COPY_FIRST = "รายการนี้ยังอ่านจากชุดเมนูกลาง — กด \"คัดลอกมาเป็นของงานนี้\" ก่อน แล้วจึงเพิ่มหรือเปลี่ยนเมนู";

/**
 * The reads and calls that fail only because the schema is not there yet —
 * the table or the function of catering_event_menu_items_migration.sql before
 * it has run. Treated as "no copies", never as an error, so this code can
 * deploy before the SQL and every screen keeps reading the shared set.
 */
function isMissingSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && ["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code)) return true;
  return /schema cache|does not exist/i.test(error.message ?? "");
}

/** The ONE way a copy is made: the database function, under the caller's own session. */
async function copySetMenuIntoLine(supabase: Db, eventMenuId: string): Promise<number> {
  const { data, error } = await supabase.rpc("catering_copy_set_menu", { p_event_menu_id: eventMenuId });
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw new Error(error.message);
  }
  return typeof data === "number" ? data : 0;
}

function toEventMenuDish(it: CateringSetMenuItem, sort_order: number): EventMenuDish {
  return { id: it.id, menu_id: it.menu_id, menu_name: it.menu_name, selling_price: it.selling_price, quantity: it.quantity, section: it.section, sort_order, note: it.note };
}

/**
 * What is served at each set line of a booking — the booking's own copy, or
 * the shared set for a line from before the copy existed. Sales-safe: names,
 * per-table counts, sections and customer prices only. Every screen that
 * expands a set (kitchen sheet, function sheet, quotation, cost page, the
 * lock, the menu page) reads THIS, so they cannot disagree.
 */
export async function getEventMenuDishes(eventId: string): Promise<Map<string, { source: DishSource; dishes: EventMenuDish[] }>> {
  await requireSales();
  const supabase = await createClient();
  const lines = (await getCateringEventMenus(eventId)).filter((l) => l.kind === "set");
  const out = new Map<string, { source: DishSource; dishes: EventMenuDish[] }>();
  if (lines.length === 0) return out;

  const copyByLine = new Map<string, EventMenuDish[]>();
  const { data, error } = await supabase
    .from("catering_event_menu_items")
    .select("id, event_menu_id, menu_id, quantity, section, sort_order, note, menus(name, selling_price)")
    .eq("event_id", eventId)
    .order("sort_order")
    .order("id");
  if (error && !isMissingSchemaError(error)) throw error;
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const menu = r.menus as { name: string; selling_price: number } | null;
    const key = r.event_menu_id as string;
    const list = copyByLine.get(key) ?? [];
    list.push({
      id: r.id as string,
      menu_id: r.menu_id as string,
      menu_name: menu?.name ?? "-",
      selling_price: Number(menu?.selling_price ?? 0),
      quantity: Number(r.quantity),
      section: r.section as string,
      sort_order: Number(r.sort_order),
      note: r.note as string | null,
    });
    copyByLine.set(key, list);
  }

  // The shared set, for lines NEVER copied: bookings from before the feature.
  // A line whose copy was made and then emptied is a copy with no rows, not a
  // fall-back (resolveDishes) — so the shared set is fetched only for lines
  // without the marker and without rows.
  const needShared = lines.filter((l) => l.set_menu_id && !l.copied && !(copyByLine.get(l.id)?.length));
  const sharedBySet = await getCateringSetMenuItemsForSets([...new Set(needShared.map((l) => l.set_menu_id as string))]);
  for (const l of lines) {
    const shared = l.set_menu_id && !l.copied ? sharedBySet.get(l.set_menu_id)?.map((it, i) => toEventMenuDish(it, (i + 1) * 10)) : undefined;
    out.set(l.id, resolveDishes(copyByLine.get(l.id), shared, l.copied));
  }
  return out;
}

/** Every edit starts here: the role, then the lock. Returns the refusal to show, or the session to write with. */
async function beginEventMenuEdit(eventId: string): Promise<{ ok: true; supabase: Db; actorId: string } | { ok: false; message: string }> {
  const profile = await requireSales();
  if (eventMenuAccess(profile.role) !== "edit") return { ok: false, message: EDIT_REFUSED };
  const supabase = await createClient();
  try {
    await assertCostNotLocked(supabase, eventId);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "ต้นทุนของงานนี้ถูกล็อกแล้ว" };
  }
  return { ok: true, supabase, actorId: profile.id };
}

async function loadSetLine(supabase: Db, eventId: string, eventMenuId: string) {
  const { data, error } = await supabase
    .from("catering_event_menus")
    .select("id, event_id, set_menu_id, menu_id, set_name, catering_set_menus(name), catering_event_charges(label)")
    .eq("id", eventMenuId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const r = data as Record<string, unknown> | null;
  if (!r || r.event_id !== eventId) return null;
  const line = { set_menu_id: r.set_menu_id as string | null, menu_id: r.menu_id as string | null };
  if (!isSetLine(line)) return null;
  const setMenu = r.catering_set_menus as { name: string } | null;
  const charges = r.catering_event_charges as { label: string }[] | null;
  const set_name = (r.set_name as string | null) ?? null;
  return { id: r.id as string, ...line, copied: set_name != null, name: set_name ?? setMenu?.name ?? charges?.[0]?.label ?? "ชุดเมนูของงาน" };
}

async function loadEventMenuItem(supabase: Db, eventId: string, itemId: string) {
  const { data, error } = await supabase
    .from("catering_event_menu_items")
    .select("id, event_id, event_menu_id, menu_id, quantity, menus(name, selling_price)")
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const r = data as Record<string, unknown> | null;
  if (!r || r.event_id !== eventId) return null;
  const menu = r.menus as { name: string; selling_price: number } | null;
  return { id: r.id as string, event_menu_id: r.event_menu_id as string, menu_id: r.menu_id as string, quantity: Number(r.quantity), menu_name: menu?.name ?? "-" };
}

async function dishName(supabase: Db, menuId: string): Promise<string | null> {
  const { data } = await supabase.from("menus").select("name").eq("id", menuId).maybeSingle();
  return (data?.name as string | undefined) ?? null;
}

function eventMenuError(err: unknown, fallback: string): EventMenuActionResult {
  const message = err instanceof Error ? err.message : fallback;
  // The UNIQUE (event_menu_id, menu_id): the same dish twice in one set.
  if (/duplicate key|23505/.test(message)) return { status: "error", message: "เมนูนี้มีอยู่ในชุดนี้แล้ว" };
  return { status: "error", message };
}

function revalidateEventMenu(eventId: string) {
  revalidatePath(`/owner/catering/${eventId}`);
  revalidatePath(`/owner/catering/${eventId}/menu`);
}

/** A line from before the copy existed: make its copy now, explicitly. */
export async function copyEventMenuFromSet(eventId: string, eventMenuId: string): Promise<EventMenuActionResult> {
  const ctx = await beginEventMenuEdit(eventId);
  if (!ctx.ok) return { status: "error", message: ctx.message };
  try {
    const line = await loadSetLine(ctx.supabase, eventId, eventMenuId);
    if (!line) return { status: "error", message: "ไม่พบรายการชุดเมนูของงานนี้" };
    if (!line.set_menu_id) return { status: "error", message: "รายการนี้ไม่ได้อ้างอิงชุดเมนูกลาง จึงไม่มีอะไรให้คัดลอก" };
    const { error } = await ctx.supabase.rpc("catering_copy_set_menu", { p_event_menu_id: eventMenuId });
    if (error) {
      if (isMissingSchemaError(error)) return { status: "error", message: "ระบบสำเนาชุดเมนูยังไม่พร้อม (ยังไม่ได้รัน migration)" };
      return { status: "error", message: error.message };
    }
    await logCateringActivity(ctx.supabase, eventId, ctx.actorId, "menu_edited", `คัดลอกชุดเมนูมาเป็นของงาน: ${line.name}`);
    revalidateEventMenu(eventId);
    return { status: "ok" };
  } catch (err) {
    return eventMenuError(err, "คัดลอกชุดเมนูไม่สำเร็จ");
  }
}

/**
 * A custom set for this booking: a set line with its own name and price per
 * table and no shared source, plus the food charge every set line has — the
 * same pair addCateringEventMenu writes, so the price box and the quotation
 * treat it exactly like a picked set. Dishes are then added one by one.
 */
export async function createCustomEventMenu(
  eventId: string,
  input: { name: string; pricePerTable: number; tables: number },
): Promise<EventMenuActionResult> {
  const name = input.name.trim();
  if (!name) return { status: "error", message: "กรุณาตั้งชื่อชุด" };
  if (!Number.isFinite(input.pricePerTable) || input.pricePerTable < 0) return { status: "error", message: "ราคาต่อโต๊ะไม่ถูกต้อง" };
  if (!Number.isFinite(input.tables) || input.tables <= 0) return { status: "error", message: "จำนวนโต๊ะต้องมากกว่า 0" };
  const ctx = await beginEventMenuEdit(eventId);
  if (!ctx.ok) return { status: "error", message: ctx.message };
  const { supabase } = ctx;
  try {
    const { data: last } = await supabase.from("catering_event_menus").select("sort_order").eq("event_id", eventId).order("sort_order", { ascending: false }).limit(1);
    const nextSort = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;
    const { data: created, error } = await supabase
      .from("catering_event_menus")
      .insert({ event_id: eventId, set_menu_id: null, menu_id: null, set_name: name, quantity: input.tables, sort_order: nextSort })
      .select("id")
      .single();
    if (error) {
      if (isMissingSchemaError(error) || /one_target/.test(error.message)) {
        return { status: "error", message: "ระบบชุดเมนูของงานยังไม่พร้อม (ยังไม่ได้รัน migration)" };
      }
      throw new Error(error.message);
    }
    const { data: lastCharge } = await supabase.from("catering_event_charges").select("sort_order").eq("event_id", eventId).order("sort_order", { ascending: false }).limit(1);
    const nextChargeSort = ((lastCharge?.[0]?.sort_order as number | undefined) ?? 0) + 10;
    const { error: chargeError } = await supabase.from("catering_event_charges").insert({
      event_id: eventId, label: name, charge_type: "food", unit_price: input.pricePerTable, quantity: input.tables,
      amount: input.pricePerTable * input.tables, note: null, event_menu_id: created.id, sort_order: nextChargeSort,
    });
    if (chargeError) throw new Error(chargeError.message);
    await logCateringActivity(supabase, eventId, ctx.actorId, "menu_added", `สร้างชุดเมนูของงาน: ${name} (${input.tables} โต๊ะ)`);
    revalidateEventMenu(eventId);
    return { status: "ok" };
  } catch (err) {
    return eventMenuError(err, "สร้างชุดเมนูไม่สำเร็จ");
  }
}

export async function addEventMenuDish(eventId: string, eventMenuId: string, menuId: string, section: string): Promise<EventMenuActionResult> {
  if (!EVENT_MENU_SECTIONS.includes(section)) return { status: "error", message: "หมวดไม่ถูกต้อง" };
  const ctx = await beginEventMenuEdit(eventId);
  if (!ctx.ok) return { status: "error", message: ctx.message };
  const { supabase } = ctx;
  try {
    const line = await loadSetLine(supabase, eventId, eventMenuId);
    if (!line) return { status: "error", message: "ไม่พบรายการชุดเมนูของงานนี้" };
    // A line still reading the shared set (never copied) has no copy to add
    // to: adding one dish would make a one-dish copy and silently drop the
    // other courses. A copied line with no rows is different — it was
    // emptied on purpose and may be rebuilt (review, 2026-09-19).
    if (line.set_menu_id && !line.copied) return { status: "error", message: COPY_FIRST };
    const name = await dishName(supabase, menuId);
    if (!name) return { status: "error", message: "ไม่พบเมนูที่เลือก" };
    const { data: last } = await supabase.from("catering_event_menu_items").select("sort_order").eq("event_menu_id", eventMenuId).order("sort_order", { ascending: false }).limit(1);
    const nextSort = ((last?.[0]?.sort_order as number | undefined) ?? 0) + 10;
    const { error } = await supabase.from("catering_event_menu_items").insert({
      event_id: eventId, event_menu_id: eventMenuId, menu_id: menuId, quantity: 1, section, sort_order: nextSort, source_set_menu_id: null,
    });
    if (error) throw new Error(error.message);
    await logCateringActivity(supabase, eventId, ctx.actorId, "menu_edited", `เพิ่มเมนูในชุด ${line.name}: ${name}`);
    revalidateEventMenu(eventId);
    return { status: "ok" };
  } catch (err) {
    return eventMenuError(err, "เพิ่มเมนูไม่สำเร็จ");
  }
}

/** Swap a course for another dish. The >10% price warning is the screen's; this does the swap the person confirmed. */
export async function replaceEventMenuDish(eventId: string, itemId: string, newMenuId: string): Promise<EventMenuActionResult> {
  const ctx = await beginEventMenuEdit(eventId);
  if (!ctx.ok) return { status: "error", message: ctx.message };
  const { supabase } = ctx;
  try {
    const item = await loadEventMenuItem(supabase, eventId, itemId);
    if (!item) return { status: "error", message: "ไม่พบรายการอาหารของงานนี้" };
    if (item.menu_id === newMenuId) return { status: "ok" };
    const newName = await dishName(supabase, newMenuId);
    if (!newName) return { status: "error", message: "ไม่พบเมนูที่เลือก" };
    const { error } = await supabase.from("catering_event_menu_items").update({ menu_id: newMenuId, updated_at: new Date().toISOString() }).eq("id", itemId);
    if (error) throw new Error(error.message);
    await logCateringActivity(supabase, eventId, ctx.actorId, "menu_edited", `เปลี่ยนเมนู: ${item.menu_name} → ${newName}`);
    revalidateEventMenu(eventId);
    return { status: "ok" };
  } catch (err) {
    return eventMenuError(err, "เปลี่ยนเมนูไม่สำเร็จ");
  }
}

export async function updateEventMenuItem(
  eventId: string,
  itemId: string,
  patch: { quantity?: number; section?: string; note?: string | null },
): Promise<EventMenuActionResult> {
  if (patch.quantity !== undefined && (!Number.isFinite(patch.quantity) || patch.quantity <= 0)) return { status: "error", message: "จำนวนต่อโต๊ะต้องมากกว่า 0" };
  if (patch.section !== undefined && !EVENT_MENU_SECTIONS.includes(patch.section)) return { status: "error", message: "หมวดไม่ถูกต้อง" };
  const ctx = await beginEventMenuEdit(eventId);
  if (!ctx.ok) return { status: "error", message: ctx.message };
  const { supabase } = ctx;
  try {
    const item = await loadEventMenuItem(supabase, eventId, itemId);
    if (!item) return { status: "error", message: "ไม่พบรายการอาหารของงานนี้" };
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.quantity !== undefined) update.quantity = patch.quantity;
    if (patch.section !== undefined) update.section = patch.section;
    if (patch.note !== undefined) update.note = patch.note?.trim() || null;
    const { error } = await supabase.from("catering_event_menu_items").update(update).eq("id", itemId);
    if (error) throw new Error(error.message);
    const what = patch.quantity !== undefined ? `จำนวน ${item.quantity} → ${patch.quantity} ต่อโต๊ะ` : patch.section !== undefined ? `หมวด → ${patch.section}` : "หมายเหตุ";
    await logCateringActivity(supabase, eventId, ctx.actorId, "menu_edited", `แก้ไข ${item.menu_name}: ${what}`);
    revalidateEventMenu(eventId);
    return { status: "ok" };
  } catch (err) {
    return eventMenuError(err, "แก้ไขรายการไม่สำเร็จ");
  }
}

export async function removeEventMenuDish(eventId: string, itemId: string): Promise<EventMenuActionResult> {
  const ctx = await beginEventMenuEdit(eventId);
  if (!ctx.ok) return { status: "error", message: ctx.message };
  const { supabase } = ctx;
  try {
    const item = await loadEventMenuItem(supabase, eventId, itemId);
    if (!item) return { status: "error", message: "ไม่พบรายการอาหารของงานนี้" };
    const { error } = await supabase.from("catering_event_menu_items").delete().eq("id", itemId);
    if (error) throw new Error(error.message);
    await logCateringActivity(supabase, eventId, ctx.actorId, "menu_edited", `ลบเมนูออกจากชุด: ${item.menu_name}`);
    revalidateEventMenu(eventId);
    return { status: "ok" };
  } catch (err) {
    return eventMenuError(err, "ลบเมนูไม่สำเร็จ");
  }
}
