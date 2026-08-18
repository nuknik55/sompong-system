"use server";

import { revalidatePath } from "next/cache";
import { requireSales } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CateringCustomer = {
  id: string;
  name: string;
  phone: string | null;
  line_id: string | null;
  company_name: string | null;
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
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  venue: string;
  booking_type: string;
  food_format: string | null;
  table_count: number | null;
  reserve_tables: number | null;
  table_label: string | null;
  guest_count: number | null;
  status: string;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  detail_note: string | null;
  kitchen_note: string | null;
  staff_ids: string[];
};

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getCateringCustomers(): Promise<CateringCustomer[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_customers")
    .select("id,name,phone,line_id,company_name")
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
    .select(`
      id, customer_id, event_date, start_time, end_time, venue, booking_type,
      food_format, table_count, reserve_tables, table_label, guest_count, status,
      deposit_amount, deposit_paid_at, detail_note, kitchen_note,
      catering_customers(name, phone),
      catering_event_staff(employee_id)
    `)
    .gte("event_date", `${year}-${m}-01`)
    .lte("event_date", `${year}-${m}-${String(lastDay).padStart(2, "0")}`)
    .order("event_date")
    .order("start_time", { nullsFirst: true });

  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => {
    const cust = r.catering_customers as { name: string; phone: string | null } | null;
    const staff = (r.catering_event_staff ?? []) as { employee_id: string }[];
    return {
      id: r.id as string,
      customer_id: r.customer_id as string | null,
      customer_name: cust?.name ?? null,
      customer_phone: cust?.phone ?? null,
      event_date: r.event_date as string,
      start_time: r.start_time as string | null,
      end_time: r.end_time as string | null,
      venue: r.venue as string,
      booking_type: r.booking_type as string,
      food_format: r.food_format as string | null,
      table_count: r.table_count as number | null,
      reserve_tables: r.reserve_tables as number | null,
      table_label: r.table_label as string | null,
      guest_count: r.guest_count as number | null,
      status: r.status as string,
      deposit_amount: r.deposit_amount as number | null,
      deposit_paid_at: r.deposit_paid_at as string | null,
      detail_note: r.detail_note as string | null,
      kitchen_note: r.kitchen_note as string | null,
      staff_ids: staff.map((s) => s.employee_id),
    };
  });
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
  } | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  venue: string;
  booking_type: string;
  food_format: string | null;
  table_count: number | null;
  reserve_tables: number | null;
  table_label: string | null;
  guest_count: number | null;
  status: string;
  deposit_amount: number | null;
  deposit_paid_at: string | null;
  detail_note: string | null;
  kitchen_note: string | null;
  staff_ids: string[];
}): Promise<void> {
  await requireSales();
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
      })
      .select("id")
      .single();
    if (custError) throw custError;
    customerId = created.id;
  }

  const payload = {
    customer_id: customerId,
    event_date: data.event_date,
    start_time: data.start_time || null,
    end_time: data.end_time || null,
    venue: data.venue,
    booking_type: data.booking_type,
    food_format: data.food_format || null,
    table_count: data.table_count,
    reserve_tables: data.reserve_tables,
    table_label: data.table_label?.trim() || null,
    guest_count: data.guest_count,
    status: data.status,
    deposit_amount: data.deposit_amount,
    deposit_paid_at: data.deposit_paid_at || null,
    detail_note: data.detail_note?.trim() || null,
    kitchen_note: data.kitchen_note?.trim() || null,
  };

  let eventId = data.id;
  if (eventId) {
    const { error } = await supabase.from("catering_events").update(payload).eq("id", eventId);
    if (error) throw error;
  } else {
    const { data: created, error } = await supabase
      .from("catering_events")
      .insert(payload)
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
}

export async function deleteCateringEvent(id: string): Promise<void> {
  await requireSales();
  const supabase = await createClient();
  // catering_event_staff rows go with it via ON DELETE CASCADE.
  const { error } = await supabase.from("catering_events").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/owner/catering");
}
