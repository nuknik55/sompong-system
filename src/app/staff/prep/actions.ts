"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireAdminOrEditor } from "@/lib/auth";
import { savePendingChange } from "@/lib/pending-data";
import { createClient } from "@/lib/supabase/server";
import { canSeePrep, PREP_FORBIDDEN, prepInsertErrorMessage } from "@/lib/prep-access";

// ── Item 12: expected failures are RETURNED, not thrown ─────────────────────
// Same rule as staff/menu/actions.ts: production redacts thrown Server Action
// messages, so the Thai text never reached the user. Auth throws stay; truly
// unexpected exceptions still throw (redaction is correct for those).
export type PrepActionResult = { status: "ok" } | { status: "error"; message: string };
/**
 * "pending" replaces the old "__pending__" magic-string id.
 *
 * "hidden": the prep was created, but its creator may not open it. Closed by
 * default applies to the person who made it too; admins, เฮง included, see it
 * only once the owner grants it. The form says so instead of navigating to a
 * page that would answer not-found.
 */
export type PrepCreateResult =
  | { status: "ok"; id: string }
  | { status: "hidden"; name: string }
  | { status: "pending" }
  | { status: "error"; message: string };
/** Extended with the error arm — the saved/pending split predates item 12. */
export type PrepSaveResult = { status: "saved" } | { status: "pending" } | { status: "error"; message: string };

// ── Why a new prep's id is made HERE, and the row is never read back ───────
//
// Reading the id back (.insert(...).select("id")) is INSERT ... RETURNING, and
// Postgres checks a RETURNED row against the table's SELECT policy. A prep
// nobody has been granted fails that check for everyone but the owner, so the
// insert itself is refused, not just the read. The read-back only ever worked
// because can_see_prep() said yes to every admin, which was the leak closed by
// supabase/prep_owner_only_predicate_migration.sql. duplicatePrep below and
// approveChange's prep_create case follow the same rule.
export async function createPrep(name: string, category: string, batchYieldQty: number, batchYieldUnit: string): Promise<PrepCreateResult> {
  const profile = await requireAdminOrEditor();
  if (!name.trim()) return { status: "error", message: "กรุณาใส่ชื่อของเตรียม" };

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "prep_create", `new:${name.trim()}`, {
      name: name.trim(),
      category: category.trim() || null,
      batchYieldQty: batchYieldQty || 1,
      batchYieldUnit: batchYieldUnit.trim() || "กรัม",
    });
    return { status: "pending" };
  }

  const supabase = await createClient();

  // Check for existing ingredient or prep_recipe with same name (orphans from partial deletes)
  const [{ data: existingIngredient }, { data: existingPrepRecipe }] = await Promise.all([
    supabase.from("ingredients").select("id, is_prep").eq("name", name.trim()).maybeSingle(),
    supabase.from("prep_recipes").select("id").eq("name", name.trim()).maybeSingle(),
  ]);

  if (existingIngredient && !existingIngredient.is_prep) {
    return { status: "error", message: `ชื่อ "${name.trim()}" มีในวัตถุดิบดิบแล้ว กรุณาใช้ชื่ออื่น` };
  }

  let prepId: string;
  if (existingPrepRecipe) {
    // Reuse orphan prep_recipe (its ingredient was deleted) — update fields to match new request
    const { error: updatePrepError } = await supabase
      .from("prep_recipes")
      .update({ category: category.trim() || null, batch_yield_qty: batchYieldQty || 1, batch_yield_unit: batchYieldUnit.trim() || "กรัม" })
      .eq("id", existingPrepRecipe.id);
    if (updatePrepError) return { status: "error", message: updatePrepError.message };
    prepId = existingPrepRecipe.id;
  } else {
    // See the note above createPrep: the id is made here, not read back.
    const newId = randomUUID();
    const { error: insertError } = await supabase
      .from("prep_recipes")
      .insert({ id: newId, name: name.trim(), category: category.trim() || null, batch_yield_qty: batchYieldQty || 1, batch_yield_unit: batchYieldUnit.trim() || "กรัม" });
    if (insertError) return { status: "error", message: prepInsertErrorMessage(insertError, name.trim()) };
    prepId = newId;
  }

  if (existingIngredient?.is_prep) {
    // Orphan prep ingredient — relink to the (new or reused) prep_recipe
    const { error: updateError } = await supabase
      .from("ingredients")
      .update({ category: category.trim() || "prep", usage_unit: batchYieldUnit.trim() || "กรัม", prep_recipe_id: prepId })
      .eq("id", existingIngredient.id);
    if (updateError) return { status: "error", message: updateError.message };
  } else {
    const { error: ingredientError } = await supabase.from("ingredients").insert({
      name: name.trim(),
      category: category.trim() || "prep",
      is_prep: true,
      usage_unit: batchYieldUnit.trim() || "กรัม",
      prep_recipe_id: prepId,
    });
    if (ingredientError) return { status: "error", message: ingredientError.message };
  }

  revalidatePath("/staff", "layout");
  revalidatePath("/owner", "layout");

  if (!(await canSeePrep(prepId))) return { status: "hidden", name: name.trim() };
  return { status: "ok", id: prepId };
}

export async function updatePrepYield(
  prepId: string,
  batchYieldQty: number,
  batchYieldUnit: string,
  pendingInfo?: { prepName: string }
): Promise<PrepSaveResult> {
  const profile = await requireAdminOrEditor();
  if (!(await canSeePrep(prepId))) return { status: "error", message: PREP_FORBIDDEN };

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
  if (error) return { status: "error", message: error.message };
  revalidatePath(`/staff/prep/${prepId}`);
  return { status: "saved" };
}

export async function duplicatePrep(prepId: string, newName: string, newCategory: string): Promise<PrepCreateResult> {
  const profile = await requireAdminOrEditor();
  if (!newName.trim()) return { status: "error", message: "กรุณาใส่ชื่อของเตรียมใหม่" };
  // Copying is reading. Without this, a hidden recipe could be duplicated into
  // a new one the copier owns outright — the composition out through the back.
  if (!(await canSeePrep(prepId))) return { status: "error", message: PREP_FORBIDDEN };

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
    return { status: "pending" };
  }

  const supabase = await createClient();
  const { data: original, error: fetchError } = await supabase.from("prep_recipes").select("*").eq("id", prepId).single();
  if (fetchError || !original) return { status: "error", message: fetchError?.message ?? "ไม่พบของเตรียมต้นฉบับ" };

  const { data: originalIngredient } = await supabase.from("ingredients").select("usage_unit").eq("prep_recipe_id", prepId).maybeSingle();
  // See the note above createPrep: the id is made here, not read back.
  const newPrep = { id: randomUUID() };
  const { error: insertError } = await supabase
    .from("prep_recipes")
    .insert({ id: newPrep.id, name: newName.trim(), category: newCategory.trim() || null, batch_yield_qty: original.batch_yield_qty, batch_yield_unit: original.batch_yield_unit, note: original.note });
  if (insertError) return { status: "error", message: prepInsertErrorMessage(insertError, newName.trim()) };

  // Checked: without this row the new prep recipe has no matching ingredient
  // and can never be used in any menu — the same failure prep_create has in
  // approve/actions.ts.
  {
    const { error } = await supabase.from("ingredients").insert({ name: newName.trim(), category: newCategory.trim() || "prep", is_prep: true, usage_unit: originalIngredient?.usage_unit ?? "กรัม", prep_recipe_id: newPrep.id });
    if (error) return { status: "error", message: error.message };
  }
  const { data: items, error: itemsError } = await supabase.from("prep_recipe_items").select("ingredient_id, quantity, unit, note, sort_order").eq("prep_recipe_id", prepId);
  if (itemsError) return { status: "error", message: itemsError.message };
  if (items && items.length > 0) {
    // Checked: a silent failure here produced a copied prep with ZERO
    // ingredients, whose batch cost then computes as 0.
    const { error } = await supabase.from("prep_recipe_items").insert(items.map((it) => ({ ...it, prep_recipe_id: newPrep.id })));
    if (error) return { status: "error", message: error.message };
  }
  // Seeing the original does not mean seeing the copy: the copy is a new
  // recipe with no grant row, so for anyone but the owner it starts hidden.
  if (!(await canSeePrep(newPrep.id))) return { status: "hidden", name: newName.trim() };
  return { status: "ok", id: newPrep.id };
}

export async function deletePrep(prepId: string): Promise<PrepActionResult> {
  const profile = await requireAdminOrEditor();
  if (!(await canSeePrep(prepId))) return { status: "error", message: PREP_FORBIDDEN };
  const supabase = await createClient();

  if (profile.role === "editor") {
    const { data: prep } = await supabase.from("prep_recipes").select("name").eq("id", prepId).single();
    await savePendingChange(profile.id, "prep_delete", prepId, {
      prepId,
      prepName: prep?.name ?? prepId,
    });
    return { status: "ok" };
  }

  // Admin — delete directly (requireAdmin alias guards non-admin above)
  await requireAdmin();
  const { error: ingredientError } = await supabase.from("ingredients").delete().eq("prep_recipe_id", prepId);
  if (ingredientError) {
    return {
      status: "error",
      message:
        ingredientError.code === "23503"
          ? "ลบไม่ได้ เพราะของเตรียมนี้ถูกใช้อยู่ในเมนูหรือของเตรียมอื่น ต้องลบออกจากที่อื่นก่อน"
          : ingredientError.message,
    };
  }
  const { error } = await supabase.from("prep_recipes").delete().eq("id", prepId);
  if (error) return { status: "error", message: error.message };
  return { status: "ok" };
}
