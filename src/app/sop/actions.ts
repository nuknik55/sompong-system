"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAdminOrEditor } from "@/lib/auth";
import { savePendingChange } from "@/lib/pending-data";
import { photoOnlyStepProblem } from "@/components/sop-rules";

export type SopStepSave = {
  text: string;
  photoUrl: string | null;
};

export type SopSaveData = {
  menuId: string;
  authorName: string;
  updatedAt: string;
  demoVideoUrl: string;
  ingredientNotes: Record<string, string>;
  prepSteps: SopStepSave[];
  cookSteps: SopStepSave[];
  platingSteps: SopStepSave[];
  checklist: SopStepSave[];
};

// Item 12: the error arm carries the Thai message production would redact
// if thrown. Auth throws stay; unexpected exceptions still throw.
export type SopSaveResult = { status: "saved"; sopId: string } | { status: "pending" } | { status: "error"; message: string };

export async function upsertSop(data: SopSaveData, menuName?: string): Promise<SopSaveResult> {
  const profile = await requireAdminOrEditor();
  const supabase = await createClient();

  // Queue item 43: refused BEFORE anything is saved or filed for approval —
  // the save below keeps only steps with words, so the photo would vanish.
  const photoOnly = photoOnlyStepProblem(data);
  if (photoOnly) return { status: "error", message: photoOnly };

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "sop_upsert", data.menuId, {
      sopData: data,
      menuName: menuName ?? data.menuId,
    });
    return { status: "pending" };
  }

  // Admin — save directly
  const { data: sop, error: sopErr } = await supabase
    .from("menu_sops")
    .upsert(
      { menu_id: data.menuId, author_name: data.authorName || null, updated_at: data.updatedAt, demo_video_url: data.demoVideoUrl.trim() || null },
      { onConflict: "menu_id" }
    )
    .select("id")
    .single();
  if (sopErr) return { status: "error", message: sopErr.message };
  const sopId = sop.id;

  const { error: delNotesErr } = await supabase.from("menu_sop_ingredient_notes").delete().eq("sop_id", sopId);
  if (delNotesErr) return { status: "error", message: delNotesErr.message };

  const noteRows = Object.entries(data.ingredientNotes)
    .filter(([, note]) => note.trim())
    .map(([ingredientId, note]) => ({ sop_id: sopId, ingredient_id: ingredientId, note: note.trim() }));
  if (noteRows.length > 0) {
    const { error } = await supabase.from("menu_sop_ingredient_notes").insert(noteRows);
    if (error) return { status: "error", message: error.message };
  }

  const { error: delStepsErr } = await supabase.from("menu_sop_steps").delete().eq("sop_id", sopId);
  if (delStepsErr) return { status: "error", message: delStepsErr.message };

  const stepRows = [
    ...data.prepSteps.map((s, i) => ({ sop_id: sopId, section: "prep", sort_order: i, text: s.text, photo_url: s.photoUrl })),
    ...data.cookSteps.map((s, i) => ({ sop_id: sopId, section: "cook", sort_order: i, text: s.text, photo_url: s.photoUrl })),
    ...data.platingSteps.map((s, i) => ({ sop_id: sopId, section: "plating", sort_order: i, text: s.text, photo_url: s.photoUrl })),
    ...data.checklist.map((s, i) => ({ sop_id: sopId, section: "checklist", sort_order: i, text: s.text, photo_url: null })),
  ].filter((s) => s.text.trim());

  if (stepRows.length > 0) {
    const { error } = await supabase.from("menu_sop_steps").insert(stepRows);
    if (error) return { status: "error", message: error.message };
  }

  revalidatePath("/sop");
  revalidatePath(`/sop/${data.menuId}`);
  revalidatePath(`/sop/${data.menuId}/edit`);
  return { status: "saved", sopId };
}

export type SopDeleteResult = { status: "saved" } | { status: "pending" } | { status: "error"; message: string };

export async function deleteSop(menuId: string, menuName?: string): Promise<SopDeleteResult> {
  const profile = await requireAdminOrEditor();

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "sop_delete", menuId, {
      menuId,
      menuName: menuName ?? menuId,
    });
    return { status: "pending" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("menu_sops").delete().eq("menu_id", menuId);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/sop");
  revalidatePath(`/sop/${menuId}`);
  return { status: "saved" };
}

export type SopVisibilityResult = { status: "saved" } | { status: "error"; message: string };

/**
 * Who sees an SOP (Nik, 2026-09-26): owner and admin only. THE one save of
 * the setting and its chosen accounts, in one transaction, by the database's
 * sop_set_visibility, which checks the role, the SOP and every account again.
 */
export async function setSopVisibility(sopId: string, menuId: string, visibility: string, viewerIds: string[]): Promise<SopVisibilityResult> {
  await requireAdmin();
  if (visibility !== "all" && visibility !== "chosen") return { status: "error", message: "การตั้งค่าไม่ถูกต้อง" };
  if (!Array.isArray(viewerIds) || viewerIds.length > 200 || viewerIds.some((v) => typeof v !== "string")) {
    return { status: "error", message: "รายชื่อไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("sop_set_visibility", {
    p_sop: sopId,
    p_visibility: visibility,
    p_viewers: visibility === "chosen" ? viewerIds : [],
  });
  if (error) return { status: "error", message: `บันทึกไม่สำเร็จ: ${error.message}` };
  revalidatePath("/sop");
  revalidatePath(`/sop/${menuId}`);
  return { status: "saved" };
}
