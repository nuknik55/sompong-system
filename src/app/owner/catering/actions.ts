"use server";

import { revalidatePath } from "next/cache";
import { requireSales, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { findRoomConflict } from "./conflict";
import type { RoomConflictCandidate } from "./conflict";
import { CHECKLIST_STEPS } from "./checklist";
import { calendarGridRange } from "./calendar-grid";
import { STATUS_LABEL, isValidCateringStatus } from "./event-status";

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
  /** Derived from the linked catering_event_menus row's set_menu_id/menu_id
   *  (see getCateringCharges) — null whenever event_menu_id is null. Purely
   *  a display tag ("ชุดเมนู"/"เมนูเดี่ยว") for the unified line-item table;
   *  never round-tripped back through saveCateringCharges. */
  event_menu_kind: "set" | "dish" | null;
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
  quote_number, quote_revision, quoted_total, quoted_at, cost_locked_at,
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
    .select("id, label, charge_type, unit_price, quantity, amount, note, event_menu_id, catering_event_menus(set_menu_id, menu_id)")
    .eq("event_id", eventId)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const linked = r.catering_event_menus as { set_menu_id: string | null; menu_id: string | null } | null;
    const event_menu_kind: "set" | "dish" | null = linked ? (linked.set_menu_id ? "set" : "dish") : null;
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
    };
  });
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

export type TaskCompletion = {
  task_key: string;
  completed_at: string | null;
};

export async function getCateringTaskCompletions(eventId: string): Promise<TaskCompletion[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_task_completions")
    .select("task_key, completed_at")
    .eq("event_id", eventId);
  if (error) throw error;
  return (data ?? []) as TaskCompletion[];
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

/**
 * Status-only update, for the inline status control on the event detail
 * page. Deliberately NOT routed through upsertCateringEvent: that function
 * rewrites all ~20 event fields from a full form payload and re-runs the
 * room-conflict check, so using it here would mean a status change could
 * fail on an unrelated pre-existing conflict, or silently rewrite fields
 * from stale form state. requireSales() matches upsertCateringEvent's own
 * gate exactly — same roles that can change status via the edit form can
 * change it here, no more, no less.
 *
 * status is validated against event-status.ts's shared list before the
 * write; the column has its own CHECK constraint too (see
 * catering_migration.sql), this just fails with a readable message instead
 * of a raw Postgres error.
 */
export async function updateCateringEventStatus(eventId: string, status: string): Promise<void> {
  const profile = await requireSales();
  const supabase = await createClient();

  if (!isValidCateringStatus(status)) throw new Error("สถานะไม่ถูกต้อง");

  const { error } = await supabase
    .from("catering_events")
    .update({ status })
    .eq("id", eventId);
  if (error) throw error;

  await logCateringActivity(supabase, eventId, profile.id, "status_changed", `เปลี่ยนสถานะเป็น: ${STATUS_LABEL[status]}`);

  revalidatePath("/owner/catering");
  revalidatePath(`/owner/catering/${eventId}`);
}

/**
 * Upserts a single row per (event_id, task_key) — checking sets
 * completed_at/completed_by, unchecking clears both back to NULL on the
 * same row rather than deleting it. task_key isn't validated against
 * CHECKLIST_STEPS here; the template is the only source of truth for which
 * keys are meaningful, matching the migration's deliberately unconstrained
 * task_key column.
 */
export async function setCateringTaskCompletion(eventId: string, taskKey: string, completed: boolean): Promise<void> {
  const profile = await requireSales();
  const supabase = await createClient();
  const { error } = await supabase
    .from("catering_event_task_completions")
    .upsert(
      {
        event_id: eventId,
        task_key: taskKey,
        completed_at: completed ? new Date().toISOString() : null,
        completed_by: completed ? profile.id : null,
      },
      { onConflict: "event_id,task_key" },
    );
  if (error) throw error;

  const stepLabel = CHECKLIST_STEPS.find((s) => s.key === taskKey)?.label ?? taskKey;
  await logCateringActivity(
    supabase,
    eventId,
    profile.id,
    completed ? "task_completed" : "task_uncompleted",
    completed ? `ทำเครื่องหมายเสร็จ: ${stepLabel}` : `ยกเลิกเครื่องหมาย: ${stepLabel}`,
  );

  revalidatePath(`/owner/catering/${eventId}`);
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
    .order("created_at", { ascending: false });
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

  const current = siblings[idx]!;
  const swap = siblings[swapIdx]!;
  await supabase.from("catering_transfer_cost_rates").update({ sort_order: swap.sort_order }).eq("id", current.id);
  await supabase.from("catering_transfer_cost_rates").update({ sort_order: current.sort_order }).eq("id", swap.id);

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
export async function addCateringEventMenu(
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
export async function removeCateringEventMenu(id: string, eventId: string): Promise<void> {
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
export async function issueCateringQuote(eventId: string): Promise<void> {
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
    .select("quote_number, quote_revision")
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

export async function deleteCateringEvent(id: string): Promise<void> {
  await requireSales();
  const supabase = await createClient();
  // catering_event_staff rows go with it via ON DELETE CASCADE.
  const { error } = await supabase.from("catering_events").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering");
}
