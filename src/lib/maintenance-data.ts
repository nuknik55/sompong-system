import "server-only";
import { createClient } from "@/lib/supabase/server";

export type MaintenanceStatus = "new" | "in_progress" | "done";

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

export async function getMaintenanceReport(id: string): Promise<MaintenanceReport | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("maintenance_reports")
    .select("*")
    .eq("id", id)
    .single();
  return data ? mapRow(data) : null;
}
