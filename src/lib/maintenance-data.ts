import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isMaintenanceHead, type MaintenanceStatus } from "@/lib/maintenance-rules";

// The status type and the rules live in the plain module, so the client
// components import them from there, never from this server-only file.
export type { MaintenanceStatus };

export type MaintenanceReport = {
  id: string;
  reporterId: string;
  reporterName: string;
  category: string;
  location: string;
  description: string;
  isUrgent: boolean;
  photoBefore: string | null;
  photoAfter: string | null;
  status: MaintenanceStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolverNote: string | null;
  /** Copied at accept/done like reporterName; NULL on rows closed before the column existed. */
  resolverName: string | null;
  /** Set only on a cancelled report (maint_cancel); the name is copied like reporterName. */
  cancelledAt: string | null;
  cancelledByName: string | null;
  cancelNote: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(d: any): MaintenanceReport {
  return {
    id: d.id,
    reporterId: d.reporter_id,
    reporterName: d.reporter_name ?? "",
    category: d.category ?? "อื่นๆ",
    location: d.location ?? "",
    description: d.description ?? "",
    isUrgent: d.is_urgent ?? false,
    photoBefore: d.photo_before ?? null,
    photoAfter: d.photo_after ?? null,
    status: d.status ?? "new",
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    resolvedAt: d.resolved_at ?? null,
    resolverNote: d.resolver_note ?? null,
    resolverName: d.resolver_name ?? null,
    cancelledAt: d.cancelled_at ?? null,
    cancelledByName: d.cancelled_by_name ?? null,
    cancelNote: d.cancel_note ?? null,
  };
}

export async function getMaintenanceReports(): Promise<MaintenanceReport[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("maintenance_reports")
    .select("*")
    .order("created_at", { ascending: false });
  return (data ?? []).map(mapRow);
}

/**
 * The roles that act on a report — the same three the maint_* functions
 * admit (part C of catering_typed_dishes_per_head_and_maintenance_migration.sql).
 * The one list is isMaintenanceHead in maintenance-rules; this name stays
 * for the layouts.
 */
export function canManageMaintenance(role: string): boolean {
  return isMaintenanceHead(role);
}

/**
 * Open = new + in_progress (isOpen in maintenance-rules; cancelled and done
 * are closed): the count on the แจ้งซ่อม nav entry. Shown only
 * to the roles that act — the layouts pass 0 for everyone else, and zero
 * hides the badge. It exists because the one real reporter got no response
 * three times: nothing told the people who act that anything was waiting.
 */
export async function getOpenRepairCount(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("maintenance_reports")
    .select("id", { count: "exact", head: true })
    .in("status", ["new", "in_progress"]);
  return count ?? 0;
}

export async function getMaintenanceReport(id: string): Promise<MaintenanceReport | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("maintenance_reports")
    .select("*")
    .eq("id", id)
    .single();
  return data ? mapRow(data) : null;
}
