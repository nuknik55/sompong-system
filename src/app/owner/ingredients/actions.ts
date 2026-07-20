"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireAdminOrEditor } from "@/lib/auth";
import { savePendingChange } from "@/lib/pending-data";

export async function updateMenuItemQty(itemId: string, quantity: number) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("menu_recipe_items").update({ quantity }).eq("id", itemId);
  if (error) throw new Error(error.message);
  revalidatePath("/staff", "layout");
  revalidatePath("/owner", "layout");
}

export async function updatePrepItemQty(itemId: string, quantity: number) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("prep_recipe_items").update({ quantity }).eq("id", itemId);
  if (error) throw new Error(error.message);
  revalidatePath("/staff", "layout");
  revalidatePath("/owner", "layout");
}

export type IngredientFields = {
  name: string;
  category: string | null;
  purchase_unit_label: string | null;
  purchase_cost: number | null;
  receive_qty: number;
  yield_qty: number | null;
  usage_unit: string | null;
  par_level?: number | null;
};

export type IngredientSaveResult = { status: "saved" } | { status: "pending" };

export async function updateIngredient(id: string, ingredientName: string, fields: Partial<IngredientFields>): Promise<IngredientSaveResult> {
  const profile = await requireAdminOrEditor();

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "ingredient_edit", id, {
      ingredientId: id,
      ingredientName,
      fields,
    });
    return { status: "pending" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ingredients").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/ingredients");
  return { status: "saved" };
}

export async function createIngredient(ingredientName: string, fields: IngredientFields): Promise<IngredientSaveResult> {
  const profile = await requireAdminOrEditor();

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "ingredient_create", `new:${ingredientName}`, {
      ingredientName,
      fields,
    });
    return { status: "pending" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("ingredients").insert({ ...fields, is_prep: false });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/ingredients");
  return { status: "saved" };
}

export async function deleteIngredient(id: string, ingredientName: string): Promise<IngredientSaveResult> {
  const profile = await requireAdminOrEditor();
  const supabase = await createClient();

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "ingredient_delete", id, {
      ingredientId: id,
      ingredientName,
    });
    return { status: "pending" };
  }

  const { error } = await supabase.from("ingredients").delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      throw new Error("ลบไม่ได้ เพราะมีเมนูหรือของเตรียมใช้วัตถุดิบนี้อยู่ — ต้องเอาออกจากสูตรทั้งหมดก่อน");
    }
    throw new Error(error.message);
  }
  revalidatePath("/owner/ingredients");
  return { status: "saved" };
}

export type PriceHistoryEntry = {
  id: string;
  changedByName: string;
  oldPurchaseCost: number | null;
  newPurchaseCost: number | null;
  oldReceiveQty: number | null;
  newReceiveQty: number | null;
  oldYieldQty: number | null;
  newYieldQty: number | null;
  changedAt: string;
};

export async function deleteCategory(category: string): Promise<void> {
  await requireAdminOrEditor();
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredients")
    .update({ category: null })
    .eq("category", category);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/ingredients");
}

export async function getIngredientHistory(ingredientId: string): Promise<PriceHistoryEntry[]> {
  await requireAdminOrEditor();
  const supabase = await createClient();

  const { data: history, error } = await supabase
    .from("ingredient_price_history")
    .select("id, changed_by, old_purchase_cost, new_purchase_cost, old_receive_qty, new_receive_qty, old_yield_qty, new_yield_qty, changed_at")
    .eq("ingredient_id", ingredientId)
    .order("changed_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  if (!history || history.length === 0) return [];

  const changerIds = [...new Set(history.map((h) => h.changed_by).filter(Boolean))] as string[];
  const nameById = new Map<string, string>();
  if (changerIds.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", changerIds);
    for (const p of profiles ?? []) nameById.set(p.id, p.full_name);
  }

  return history.map((h) => ({
    id: h.id,
    changedByName: h.changed_by ? nameById.get(h.changed_by) ?? "ไม่ทราบชื่อ" : "ระบบ",
    oldPurchaseCost: h.old_purchase_cost,
    newPurchaseCost: h.new_purchase_cost,
    oldReceiveQty: h.old_receive_qty,
    newReceiveQty: h.new_receive_qty,
    oldYieldQty: h.old_yield_qty,
    newYieldQty: h.new_yield_qty,
    changedAt: h.changed_at,
  }));
}
