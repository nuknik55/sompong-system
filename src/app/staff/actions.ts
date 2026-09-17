"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canSeePrep, PREP_FORBIDDEN } from "@/lib/prep-access";
import { requireProfile } from "@/lib/auth";
import { editAccess } from "@/lib/edit-access";
import { savePendingChange } from "@/lib/pending-data";

export type RecipeTarget = "menu" | "prep";

const TABLE: Record<RecipeTarget, string> = {
  menu: "menu_recipe_items",
  prep: "prep_recipe_items",
};
const PARENT_COLUMN: Record<RecipeTarget, string> = {
  menu: "menu_id",
  prep: "prep_recipe_id",
};

export type SavedItem = {
  id: string;
  ingredient_id: string | null;
  quantity: number;
  unit: string | null;
};

export type SaveResult =
  | { status: "saved"; items: SavedItem[] }
  | { status: "pending"; items: SavedItem[] }
  // Item 12: the message production would redact if thrown. getRecipeHistory
  // (a read) keeps its throw.
  | { status: "error"; message: string };

export async function saveRecipeItems(
  target: RecipeTarget,
  parentId: string,
  items: SavedItem[],
  deletedIds: string[],
  pendingInfo?: { parentName: string }
): Promise<SaveResult> {
  const profile = await requireProfile();

  // Owner and admin save, an editor files a request, and every other role
  // is refused: the same rule the recipe pages show (editAccess). This used
  // to refuse only staff, so hr and sales reached the direct save below,
  // where the table skipped their edits and deletions without an error and
  // the screen said it had saved; only an added line failed (item 34).
  const access = editAccess(profile.role);
  if (access === "view") {
    return { status: "error", message: "ไม่มีสิทธิ์แก้ไขสูตร" };
  }

  // The target is sent by the browser. Approval treats anything but "menu"
  // as a prep, so anything but the two known values is refused here, before
  // the prep check below could be skipped (item 31).
  if (target !== "menu" && target !== "prep") {
    return { status: "error", message: "ประเภทสูตรไม่ถูกต้อง" };
  }

  // Admins are named per recipe like everyone else, so the role check above is
  // not the whole answer for a prep. Refused rather than silently ignored: an
  // edit that appears to save and does not is worse than a message.
  if (target === "prep" && !(await canSeePrep(parentId))) {
    return { status: "error", message: PREP_FORBIDDEN };
  }

  if (access === "request") {
    await savePendingChange(profile.id, "recipe_edit", parentId, {
      target,
      parentId,
      parentName: pendingInfo?.parentName ?? parentId,
      items: items.filter((it) => it.ingredient_id),
      deletedIds,
    });
    return { status: "pending", items };
  }

  // Owner or admin: save directly
  const supabase = await createClient();
  const table = TABLE[target];
  const parentColumn = PARENT_COLUMN[target];

  if (deletedIds.length > 0) {
    const { error } = await supabase.from(table).delete().in("id", deletedIds);
    if (error) return { status: "error", message: error.message };
  }

  const result: SavedItem[] = [];

  for (const [index, item] of items.entries()) {
    if (!item.ingredient_id) continue;

    if (item.id.startsWith("new-")) {
      const { data, error } = await supabase
        .from(table)
        .insert({ [parentColumn]: parentId, ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index })
        .select("id")
        .single();
      if (error) return { status: "error", message: error.message };
      result.push({ ...item, id: data.id });
    } else {
      const { error } = await supabase
        .from(table)
        .update({ ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index })
        .eq("id", item.id);
      if (error) return { status: "error", message: error.message };
      result.push(item);
    }
  }

  revalidatePath(`/staff/${target}/${parentId}`);
  return { status: "saved", items: result };
}

export type RecipeHistoryEntry = {
  id: string;
  action: "insert" | "update" | "delete";
  ingredientName: string;
  oldQuantity: number | null;
  newQuantity: number | null;
  changedByName: string;
  changedAt: string;
};

export async function getRecipeHistory(target: RecipeTarget, parentId: string): Promise<RecipeHistoryEntry[]> {
  await requireProfile();
  // A prep's edit history is a second copy of its composition: ingredient
  // names with old and new quantities, enough to rebuild the recipe. This
  // action takes an arbitrary parentId, so requireProfile() alone let any
  // logged-in user read any prep's history by id. Empty rather than an error:
  // a hidden prep should look absent, not defended.
  if (target === "prep" && !(await canSeePrep(parentId))) return [];
  const supabase = await createClient();

  const { data: history, error } = await supabase
    .from("recipe_item_history")
    .select("id, action, ingredient_id, old_quantity, new_quantity, changed_by, changed_at")
    .eq("target_type", target)
    .eq("parent_id", parentId)
    .order("changed_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  if (!history || history.length === 0) return [];

  const ingredientIds = [...new Set(history.map((h) => h.ingredient_id).filter(Boolean))] as string[];
  const changerIds = [...new Set(history.map((h) => h.changed_by).filter(Boolean))] as string[];

  const [{ data: ingredientRows }, { data: profileRows }] = await Promise.all([
    ingredientIds.length
      ? supabase.from("ingredients").select("id, name").in("id", ingredientIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    changerIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", changerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const ingredientNameById = new Map((ingredientRows ?? []).map((r) => [r.id, r.name]));
  const profileNameById = new Map((profileRows ?? []).map((r) => [r.id, r.full_name]));

  return history.map((h) => ({
    id: h.id,
    action: h.action as "insert" | "update" | "delete",
    ingredientName: h.ingredient_id ? ingredientNameById.get(h.ingredient_id) ?? "ไม่ทราบชื่อ" : "-",
    oldQuantity: h.old_quantity,
    newQuantity: h.new_quantity,
    changedByName: h.changed_by ? profileNameById.get(h.changed_by) ?? "ไม่ทราบชื่อ" : "ระบบ",
    changedAt: h.changed_at,
  }));
}
