"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
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
  | { status: "pending"; items: SavedItem[] };

export async function saveRecipeItems(
  target: RecipeTarget,
  parentId: string,
  items: SavedItem[],
  deletedIds: string[],
  pendingInfo?: { parentName: string }
): Promise<SaveResult> {
  const profile = await requireProfile();

  if (profile.role === "staff") {
    throw new Error("ไม่มีสิทธิ์แก้ไขสูตร");
  }

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "recipe_edit", parentId, {
      target,
      parentId,
      parentName: pendingInfo?.parentName ?? parentId,
      items: items.filter((it) => it.ingredient_id),
      deletedIds,
    });
    return { status: "pending", items };
  }

  // Admin — save directly
  const supabase = await createClient();
  const table = TABLE[target];
  const parentColumn = PARENT_COLUMN[target];

  if (deletedIds.length > 0) {
    const { error } = await supabase.from(table).delete().in("id", deletedIds);
    if (error) throw new Error(error.message);
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
      if (error) throw new Error(error.message);
      result.push({ ...item, id: data.id });
    } else {
      const { error } = await supabase
        .from(table)
        .update({ ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index })
        .eq("id", item.id);
      if (error) throw new Error(error.message);
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
