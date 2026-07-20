"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireAdminOrEditor } from "@/lib/auth";
import { savePendingChange } from "@/lib/pending-data";
import { createClient } from "@/lib/supabase/server";

export type PrepSaveResult = { status: "saved" } | { status: "pending" };

export async function createPrep(name: string, category: string, batchYieldQty: number, batchYieldUnit: string): Promise<string> {
  const profile = await requireAdminOrEditor();
  if (!name.trim()) throw new Error("กรุณาใส่ชื่อของเตรียม");

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "prep_create", `new:${name.trim()}`, {
      name: name.trim(),
      category: category.trim() || null,
      batchYieldQty: batchYieldQty || 1,
      batchYieldUnit: batchYieldUnit.trim() || "กรัม",
    });
    return "__pending__";
  }

  const supabase = await createClient();

  // Check for existing ingredient with same name before creating prep
  const { data: existingIngredient } = await supabase
    .from("ingredients")
    .select("id, is_prep")
    .eq("name", name.trim())
    .maybeSingle();

  if (existingIngredient && !existingIngredient.is_prep) {
    throw new Error(`ชื่อ "${name.trim()}" มีในวัตถุดิบดิบแล้ว กรุณาใช้ชื่ออื่น`);
  }

  const { data: newPrep, error: insertError } = await supabase
    .from("prep_recipes")
    .insert({ name: name.trim(), category: category.trim() || null, batch_yield_qty: batchYieldQty || 1, batch_yield_unit: batchYieldUnit.trim() || "กรัม" })
    .select("id")
    .single();
  if (insertError || !newPrep) throw new Error(insertError?.message ?? "สร้างของเตรียมไม่สำเร็จ");

  if (existingIngredient?.is_prep) {
    // Orphaned prep ingredient — relink it to the new prep recipe
    const { error: updateError } = await supabase
      .from("ingredients")
      .update({ category: category.trim() || "prep", usage_unit: batchYieldUnit.trim() || "กรัม", prep_recipe_id: newPrep.id })
      .eq("id", existingIngredient.id);
    if (updateError) throw new Error(updateError.message);
  } else {
    const { error: ingredientError } = await supabase.from("ingredients").insert({
      name: name.trim(),
      category: category.trim() || "prep",
      is_prep: true,
      usage_unit: batchYieldUnit.trim() || "กรัม",
      prep_recipe_id: newPrep.id,
    });
    if (ingredientError) throw new Error(ingredientError.message);
  }

  revalidatePath("/staff");
  revalidatePath("/owner/ingredients");

  return newPrep.id;
}

export async function updatePrepYield(
  prepId: string,
  batchYieldQty: number,
  batchYieldUnit: string,
  pendingInfo?: { prepName: string }
): Promise<PrepSaveResult> {
  const profile = await requireAdminOrEditor();

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "prep_yield_edit", prepId, {
      parentId: prepId,
      parentName: pendingInfo?.prepName ?? prepId,
      qty: batchYieldQty,
      unit: batchYieldUnit,
    });
    return { status: "pending" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("prep_recipes")
    .update({ batch_yield_qty: batchYieldQty, batch_yield_unit: batchYieldUnit })
    .eq("id", prepId);
  if (error) throw new Error(error.message);
  revalidatePath(`/staff/prep/${prepId}`);
  return { status: "saved" };
}

export async function duplicatePrep(prepId: string, newName: string, newCategory: string): Promise<string> {
  const profile = await requireAdminOrEditor();
  if (!newName.trim()) throw new Error("กรุณาใส่ชื่อของเตรียมใหม่");

  if (profile.role === "editor") {
    const supabase = await createClient();
    const { data: original } = await supabase.from("prep_recipes").select("batch_yield_qty, batch_yield_unit").eq("id", prepId).single();
    await savePendingChange(profile.id, "prep_create", `dup:${prepId}`, {
      name: newName.trim(),
      category: newCategory.trim() || null,
      batchYieldQty: original?.batch_yield_qty ?? 1,
      batchYieldUnit: original?.batch_yield_unit ?? "กรัม",
      duplicatedFrom: prepId,
    });
    return "__pending__";
  }

  const supabase = await createClient();
  const { data: original, error: fetchError } = await supabase.from("prep_recipes").select("*").eq("id", prepId).single();
  if (fetchError || !original) throw new Error(fetchError?.message ?? "ไม่พบของเตรียมต้นฉบับ");

  const { data: originalIngredient } = await supabase.from("ingredients").select("usage_unit").eq("prep_recipe_id", prepId).maybeSingle();
  const { data: newPrep, error: insertError } = await supabase
    .from("prep_recipes")
    .insert({ name: newName.trim(), category: newCategory.trim() || null, batch_yield_qty: original.batch_yield_qty, batch_yield_unit: original.batch_yield_unit, note: original.note })
    .select("id")
    .single();
  if (insertError || !newPrep) throw new Error(insertError?.message ?? "คัดลอกของเตรียมไม่สำเร็จ");

  await supabase.from("ingredients").insert({ name: newName.trim(), category: newCategory.trim() || "prep", is_prep: true, usage_unit: originalIngredient?.usage_unit ?? "กรัม", prep_recipe_id: newPrep.id });
  const { data: items } = await supabase.from("prep_recipe_items").select("ingredient_id, quantity, unit, note, sort_order").eq("prep_recipe_id", prepId);
  if (items && items.length > 0) {
    await supabase.from("prep_recipe_items").insert(items.map((it) => ({ ...it, prep_recipe_id: newPrep.id })));
  }
  return newPrep.id;
}

export async function deletePrep(prepId: string) {
  const profile = await requireAdminOrEditor();
  const supabase = await createClient();

  if (profile.role === "editor") {
    const { data: prep } = await supabase.from("prep_recipes").select("name").eq("id", prepId).single();
    await savePendingChange(profile.id, "prep_delete", prepId, {
      prepId,
      prepName: prep?.name ?? prepId,
    });
    return;
  }

  // Admin — delete directly (requireAdmin alias guards non-admin above)
  await requireAdmin();
  const { error: ingredientError } = await supabase.from("ingredients").delete().eq("prep_recipe_id", prepId);
  if (ingredientError) {
    throw new Error(
      ingredientError.code === "23503"
        ? "ลบไม่ได้ เพราะของเตรียมนี้ถูกใช้อยู่ในเมนูหรือของเตรียมอื่น ต้องลบออกจากที่อื่นก่อน"
        : ingredientError.message
    );
  }
  const { error } = await supabase.from("prep_recipes").delete().eq("id", prepId);
  if (error) throw new Error(error.message);
}
