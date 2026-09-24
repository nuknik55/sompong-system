import "server-only";
import { requireSales } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The booking fields the menu card prints or decides by, and nothing else:
 * no price, no quotation total, no internal note. Its own narrow read rather
 * than getCateringEvent, which lives in actions.ts beside the admin-only
 * operating-cost functions the card must not import.
 */
export type MenuCardEvent = {
  id: string;
  status: string;
  event_date: string;
  location_type: string;
  venue: string | null;
  offsite_address: string | null;
  table_count: number | null;
  cost_locked_at: string | null;
  /** The hand-typed lines (catering_menu_card_lines_migration.sql). */
  menu_card_lines: string | null;
  customer_name: string | null;
  customer_company_name: string | null;
  event_type_label: string | null;
};

export async function readMenuCardEvent(id: string): Promise<MenuCardEvent | null> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_events")
    .select("id, status, event_date, location_type, venue, offsite_address, table_count, cost_locked_at, menu_card_lines, catering_customers(name, company_name), catering_event_types(label)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] as T) ?? null : (v as T | null));
  const customer = one<{ name: string | null; company_name: string | null }>(r.catering_customers);
  const type = one<{ label: string | null }>(r.catering_event_types);
  return {
    id: r.id as string,
    status: r.status as string,
    event_date: r.event_date as string,
    location_type: r.location_type as string,
    venue: (r.venue as string | null) ?? null,
    offsite_address: (r.offsite_address as string | null) ?? null,
    table_count: r.table_count == null ? null : Number(r.table_count),
    cost_locked_at: (r.cost_locked_at as string | null) ?? null,
    menu_card_lines: (r.menu_card_lines as string | null) ?? null,
    customer_name: customer?.name ?? null,
    customer_company_name: customer?.company_name ?? null,
    event_type_label: type?.label ?? null,
  };
}
