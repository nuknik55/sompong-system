"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canSeePrep, prepRecipeIdForItem, PREP_FORBIDDEN } from "@/lib/prep-access";
import { requireAdmin, requireAdminOrEditor } from "@/lib/auth";
import { savePendingChange } from "@/lib/pending-data";
import { seesCost, withoutCostFields } from "@/lib/cost-access";

// Item 12: returned, not thrown. getIngredientHistory (a read) keeps its throw.
export type QtyUpdateResult = { status: "ok" } | { status: "error"; message: string };

export async function updateMenuItemQty(itemId: string, quantity: number): Promise<QtyUpdateResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("menu_recipe_items").update({ quantity }).eq("id", itemId);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/staff", "layout");
  revalidatePath("/owner", "layout");
  return { status: "ok" };
}

export async function updatePrepItemQty(itemId: string, quantity: number): Promise<QtyUpdateResult> {
  await requireAdmin();
  // Admin is not enough: admins are named per recipe like everyone else. The
  // row is reached by ITEM id here, so the prep it belongs to has to be looked
  // up before the write — a missing row refuses rather than allows.
  const prepId = await prepRecipeIdForItem(itemId);
  if (!prepId || !(await canSeePrep(prepId))) return { status: "error", message: PREP_FORBIDDEN };
  const supabase = await createClient();
  const { error } = await supabase.from("prep_recipe_items").update({ quantity }).eq("id", itemId);
  if (error) return { status: "error", message: error.message };
  revalidatePath("/staff", "layout");
  revalidatePath("/owner", "layout");
  return { status: "ok" };
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

/**
 * Expected failures are RETURNED, not thrown. Production redacts a thrown
 * Server Action message, so a thrown "ลบไม่ได้ เพราะมีเมนูใช้วัตถุดิบนี้อยู่"
 * reached the screen as a generic RSC error — the shape queue item 12
 * exists for. The four write actions on the ingredients page return
 * { status: "error", message }; the client renders the message. Throws
 * remain only for the unexpected (auth, a failed profiles read).
 */
export type IngredientSaveResult =
  | { status: "saved"; id?: string }
  | { status: "pending" }
  | { status: "error"; message: string };

export async function updateIngredient(id: string, ingredientName: string, input: Partial<IngredientFields>): Promise<IngredientSaveResult> {
  const profile = await requireAdminOrEditor();
  // Never a price from someone who cannot see prices (lib/cost-access.ts):
  // an approved request would write the empty boxes over the real ones.
  const fields = seesCost(profile) ? input : withoutCostFields(input);

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
  if (error) return { status: "error", message: `บันทึกไม่สำเร็จ: ${error.message}` };
  revalidatePath("/owner/ingredients");
  return { status: "saved" };
}

export async function createIngredient(ingredientName: string, input: IngredientFields): Promise<IngredientSaveResult> {
  const profile = await requireAdminOrEditor();
  // The same: a new ingredient from someone who cannot see prices has none;
  // an admin sets them.
  const fields = seesCost(profile) ? input : withoutCostFields(input);

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "ingredient_create", `new:${ingredientName}`, {
      ingredientName,
      fields,
    });
    return { status: "pending" };
  }

  const supabase = await createClient();
  // The new row's id comes back so the client can append it to its list
  // and refresh the route, instead of reloading the whole page.
  const { data, error } = await supabase.from("ingredients").insert({ ...fields, is_prep: false }).select("id").single();
  if (error) return { status: "error", message: `เพิ่มไม่สำเร็จ: ${error.message}` };
  revalidatePath("/owner/ingredients");
  return { status: "saved", id: data.id as string };
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
    // Returned, not thrown: this message is the one a person needs to read,
    // and a throw would have production redact it.
    if (error.code === "23503") {
      return { status: "error", message: "ลบไม่ได้ เพราะมีเมนูหรือของเตรียมใช้วัตถุดิบนี้อยู่ — ต้องเอาออกจากสูตรทั้งหมดก่อน" };
    }
    return { status: "error", message: `ลบไม่สำเร็จ: ${error.message}` };
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

export async function deleteCategory(category: string): Promise<IngredientSaveResult> {
  const profile = await requireAdminOrEditor();

  // Was a direct write regardless of role — the one place in this file that
  // didn't follow the stage-for-editor / write-for-admin split its siblings
  // use. Fixed to match: editor's request now goes through the same
  // pending_changes approval flow as updateIngredient/createIngredient/deleteIngredient.
  if (profile.role === "editor") {
    await savePendingChange(profile.id, "ingredient_category_delete", `category:${category}`, {
      category,
    });
    return { status: "pending" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredients")
    .update({ category: null })
    .eq("category", category);
  if (error) return { status: "error", message: `ลบหมวดไม่สำเร็จ: ${error.message}` };
  revalidatePath("/owner/ingredients");
  return { status: "saved" };
}

export async function getIngredientHistory(ingredientId: string): Promise<PriceHistoryEntry[]> {
  const profile = await requireAdminOrEditor();
  // The price history is cost (Nik, 2026-09-26); the database answers a
  // switched-off editor with no rows as well.
  if (!seesCost(profile)) return [];
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
