"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MaintenanceStatus } from "@/lib/maintenance-data";

export async function createReport(data: {
  category: string;
  location: string;
  description: string;
  isUrgent: boolean;
  photoBefore: string | null;
}): Promise<{ error?: string }> {
  const profile = await requireProfile();
  const supabase = createAdminClient();

  const { error } = await supabase.from("maintenance_reports").insert({
    reporter_id: profile.id,
    reporter_name: profile.full_name ?? "",
    category: data.category || "อื่นๆ",
    location: data.location.trim(),
    description: data.description.trim(),
    is_urgent: data.isUrgent,
    photo_before: data.photoBefore ?? null,
    status: "new",
  });

  if (error) return { error: error.message };
  revalidatePath("/maintenance");
  return {};
}

export async function updateReportStatus(
  id: string,
  status: MaintenanceStatus,
  opts?: { photoAfter?: string | null; resolverNote?: string }
): Promise<{ error?: string }> {
  const profile = await requireProfile();
  if (!["owner", "admin", "editor"].includes(profile.role)) {
    return { error: "ไม่มีสิทธิ์เปลี่ยนสถานะ" };
  }

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: Record<string, any> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === "done") {
    updates.resolved_at = new Date().toISOString();
    updates.resolver_id = profile.id;
    if (opts?.photoAfter) updates.photo_after = opts.photoAfter;
    if (opts?.resolverNote?.trim()) updates.resolver_note = opts.resolverNote.trim();
  }

  const { error } = await supabase
    .from("maintenance_reports")
    .update(updates)
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/maintenance");
  revalidatePath(`/maintenance/${id}`);
  return {};
}
