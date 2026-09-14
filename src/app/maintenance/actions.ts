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
  // Location OR description, here and in the form: a report with neither was
  // accepted and listed as "อื่นๆ — ไม่ระบุจุด" — a defect, not flexibility.
  if (!data.location.trim() && !data.description.trim()) {
    return { error: "กรุณาระบุจุดที่เสียหาย หรือรายละเอียด อย่างน้อยหนึ่งอย่าง" };
  }
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

export async function editReport(
  id: string,
  data: { category: string; location: string; description: string; isUrgent: boolean; photoBefore: string | null }
): Promise<{ error?: string }> {
  const profile = await requireProfile();
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("maintenance_reports")
    .select("reporter_id, status")
    .eq("id", id)
    .single();

  if (!existing) return { error: "ไม่พบรายการ" };
  if (existing.reporter_id !== profile.id && !["owner", "admin", "editor"].includes(profile.role)) {
    return { error: "ไม่มีสิทธิ์แก้ไข" };
  }
  if (existing.status !== "new") return { error: "ไม่สามารถแก้ไขได้ — อยู่ระหว่างดำเนินการแล้ว" };
  if (!data.location.trim() && !data.description.trim()) {
    return { error: "กรุณาระบุจุดที่เสียหาย หรือรายละเอียด อย่างน้อยหนึ่งอย่าง" };
  }

  const { error } = await supabase
    .from("maintenance_reports")
    .update({
      category: data.category || "อื่นๆ",
      location: data.location.trim(),
      description: data.description.trim(),
      is_urgent: data.isUrgent,
      photo_before: data.photoBefore,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

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

  // Who took it is recorded at ACCEPT, not only at done. "แจ้งแล้ว" with
  // nobody named was the defect the live data showed — a report in
  // "กำลังซ่อม" for weeks with no name on it. The name is copied the way
  // reporter_name is: profiles is select-own under RLS, so the list could
  // not read it at render time.
  if (status === "in_progress" || status === "done") {
    updates.resolver_id = profile.id;
    updates.resolver_name = profile.full_name ?? "";
  }
  if (status === "done") {
    updates.resolved_at = new Date().toISOString();
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
