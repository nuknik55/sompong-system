"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CANCEL_NOTE_MAX, isMaintenanceHead, type MaintenanceStatus } from "@/lib/maintenance-rules";

// Every write goes through a maint_* function with the person's OWN session
// (catering_typed_dishes_per_head_and_maintenance_migration.sql, part C):
// direct writes on maintenance_reports are closed for every app role. Each
// function checks role, status and reporter itself and refuses with a Thai
// message, returned here as it is. The checks below are only the cheap ones
// the screen can answer without a round trip; the database is the authority.

// Location OR description, here, in the form and in the database: a report
// with neither was accepted and listed as "อื่นๆ — ไม่ระบุจุด" — a defect,
// not flexibility.
function missingWhat(data: { location: string; description: string }): string | null {
  if (!data.location.trim() && !data.description.trim()) {
    return "กรุณาระบุจุดที่เสียหาย หรือรายละเอียด อย่างน้อยหนึ่งอย่าง";
  }
  return null;
}

/**
 * The database's refusal as the screen shows it. A function that does not
 * exist yet (the code deployed before its migration ran) is said plainly
 * rather than as PostgREST's English (review, 2026-09-25).
 */
function refusal(error: { code?: string; message: string }): string {
  if (error.code === "PGRST202" || error.code === "42883") return "ระบบแจ้งซ่อมยังไม่พร้อม (ยังไม่ได้รัน migration ของแจ้งซ่อม) — แจ้งเจ้าของร้าน";
  return error.message;
}

function revalidateReport(id?: string) {
  revalidatePath("/maintenance");
  if (id) revalidatePath(`/maintenance/${id}`);
}

export async function createReport(data: {
  category: string;
  location: string;
  description: string;
  isUrgent: boolean;
  photoBefore: string | null;
}): Promise<{ error?: string }> {
  await requireProfile();
  const missing = missingWhat(data);
  if (missing) return { error: missing };

  const supabase = await createClient();
  const { error } = await supabase.rpc("maint_create", {
    p_category: data.category || "อื่นๆ",
    p_location: data.location.trim(),
    p_description: data.description.trim(),
    p_is_urgent: data.isUrgent,
    p_photo_before: data.photoBefore ?? null,
  });
  if (error) return { error: refusal(error) };
  revalidateReport();
  return {};
}

export async function editReport(
  id: string,
  data: { category: string; location: string; description: string; isUrgent: boolean; photoBefore: string | null }
): Promise<{ error?: string }> {
  await requireProfile();
  const missing = missingWhat(data);
  if (missing) return { error: missing };

  const supabase = await createClient();
  const { error } = await supabase.rpc("maint_edit", {
    p_id: id,
    p_category: data.category || "อื่นๆ",
    p_location: data.location.trim(),
    p_description: data.description.trim(),
    p_is_urgent: data.isUrgent,
    p_photo_before: data.photoBefore ?? null,
  });
  if (error) return { error: refusal(error) };
  revalidateReport(id);
  return {};
}

/**
 * The two moves a head makes: "in_progress" is maint_take (new → in
 * progress, the taker recorded as resolver: "แจ้งแล้ว" with nobody named was
 * the defect the live data showed), "done" is maint_done (from new or in
 * progress, with the optional after-photo and note). Any other target is
 * refused here; cancelling is cancelReport.
 */
export async function updateReportStatus(
  id: string,
  status: MaintenanceStatus,
  opts?: { photoAfter?: string | null; resolverNote?: string }
): Promise<{ error?: string }> {
  const profile = await requireProfile();
  if (!isMaintenanceHead(profile.role)) return { error: "ไม่มีสิทธิ์เปลี่ยนสถานะ" };

  if (status !== "in_progress" && status !== "done") return { error: "เปลี่ยนสถานะนี้ไม่ได้" };

  const supabase = await createClient();
  const { error } =
    status === "in_progress"
      ? await supabase.rpc("maint_take", { p_id: id })
      : await supabase.rpc("maint_done", {
          p_id: id,
          p_note: opts?.resolverNote?.trim() || null,
          p_photo_after: opts?.photoAfter || null,
        });
  if (error) return { error: refusal(error) };
  revalidateReport(id);
  return {};
}

/**
 * Cancel instead of delete (Nik, 2026-09-25): maint_cancel lets the reporter
 * cancel while the report is new, a head while it is new or in progress,
 * and nobody once it is done. The note is optional.
 */
export async function cancelReport(id: string, note: string): Promise<{ error?: string }> {
  await requireProfile();
  const trimmed = note.trim();
  // Counted in characters, as char_length does, not UTF-16 units.
  if ([...trimmed].length > CANCEL_NOTE_MAX) {
    return { error: `หมายเหตุยาวเกินไป (ไม่เกิน ${CANCEL_NOTE_MAX} ตัวอักษร)` };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("maint_cancel", { p_id: id, p_note: trimmed || null });
  if (error) return { error: refusal(error) };
  revalidateReport(id);
  return {};
}
