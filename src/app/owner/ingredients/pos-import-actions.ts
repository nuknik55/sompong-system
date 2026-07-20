"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePosReceiptReport } from "@/lib/pos-import";

export type PosImportRow = {
  ingredientId: string;
  name: string;
  oldCost: number | null;
  newCost: number;
  qty: number;
  latestDateLabel: string;
  pctChange: number | null;
  oldUnit: string | null;
  newUnit: string;
  unitMismatch: boolean;
  aliasSource?: string; // POS name that triggered this via alias
};

export type PosImportPreview = {
  matched: PosImportRow[];
  unmatched: { materialCode: string; materialName: string }[];
};

export type PriceAliasRow = {
  id: string;
  posIngredientName: string;
  ingredientId: string;
  ingredientName: string;
};

export async function previewPosImport(formData: FormData): Promise<PosImportPreview> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("ไม่พบไฟล์ที่อัปโหลด");

  const buffer = await file.arrayBuffer();
  const parsed = parsePosReceiptReport(buffer);
  if (parsed.length === 0) {
    throw new Error("อ่านไฟล์ไม่พบรายการรับสินค้าเลย ตรวจสอบว่าเป็นไฟล์รายงาน \"ใบรับสินค้าตรง\" ที่ export มาจาก POS หรือไม่");
  }

  const supabase = await createClient();
  const [{ data: ingredients, error }, { data: aliases }] = await Promise.all([
    supabase.from("ingredients").select("id, name, purchase_cost, purchase_unit_label").eq("is_prep", false),
    supabase.from("pos_price_aliases").select("pos_ingredient_name, ingredient_id"),
  ]);
  if (error) throw new Error(error.message);

  const byName = new Map((ingredients ?? []).map((i) => [i.name.trim(), i]));
  const byId = new Map((ingredients ?? []).map((i) => [i.id, i]));

  // alias: POS name → list of ingredient IDs to also update
  const aliasMap = new Map<string, string[]>();
  for (const a of aliases ?? []) {
    const list = aliasMap.get(a.pos_ingredient_name.trim()) ?? [];
    list.push(a.ingredient_id);
    aliasMap.set(a.pos_ingredient_name.trim(), list);
  }

  const matched: PosImportRow[] = [];
  const unmatched: { materialCode: string; materialName: string }[] = [];
  const addedIngredientIds = new Set<string>();

  function buildRow(ingredient: { id: string; name: string; purchase_cost: number | null; purchase_unit_label: string | null }, unitCost: number, unitName: string, mixedUnits: boolean, latestDateLabel: string, qty: number, aliasSource?: string): PosImportRow {
    const oldCost = ingredient.purchase_cost;
    const pctChange = oldCost && oldCost > 0 ? ((unitCost - oldCost) / oldCost) * 100 : null;
    const oldUnit = ingredient.purchase_unit_label?.trim() || null;
    const unitMismatch = mixedUnits || (!!oldUnit && oldUnit !== unitName);
    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      oldCost,
      newCost: Math.round(unitCost * 100) / 100,
      qty,
      latestDateLabel,
      pctChange,
      oldUnit,
      newUnit: unitName,
      unitMismatch,
      aliasSource,
    };
  }

  for (const row of parsed) {
    const posName = row.materialName.trim();
    const ingredient = byName.get(posName);

    if (ingredient && !addedIngredientIds.has(ingredient.id)) {
      matched.push(buildRow(ingredient, row.unitCost, row.unitName, row.mixedUnits, row.latestDateLabel, row.qty));
      addedIngredientIds.add(ingredient.id);
    } else if (!ingredient) {
      unmatched.push({ materialCode: row.materialCode, materialName: row.materialName });
    }

    // Add aliased ingredients for this POS name
    for (const aliasedId of aliasMap.get(posName) ?? []) {
      if (addedIngredientIds.has(aliasedId)) continue;
      const aliasedIngredient = byId.get(aliasedId);
      if (!aliasedIngredient) continue;
      matched.push(buildRow(aliasedIngredient, row.unitCost, row.unitName, row.mixedUnits, row.latestDateLabel, row.qty, posName));
      addedIngredientIds.add(aliasedId);
    }
  }

  matched.sort((a, b) => Number(b.unitMismatch) - Number(a.unitMismatch) || Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0));
  return { matched, unmatched };
}

export async function applyPosImport(updates: { ingredientId: string; newCost: number }[]): Promise<number> {
  await requireOwner();
  if (updates.length === 0) return 0;
  const supabase = await createClient();

  for (const u of updates) {
    const { error } = await supabase.from("ingredients").update({ purchase_cost: u.newCost }).eq("id", u.ingredientId);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/owner/ingredients");
  return updates.length;
}

export async function getPosPriceAliases(): Promise<PriceAliasRow[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pos_price_aliases")
    .select("id, pos_ingredient_name, ingredient_id, ingredients(name)")
    .order("pos_ingredient_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    posIngredientName: r.pos_ingredient_name,
    ingredientId: r.ingredient_id,
    ingredientName: (r.ingredients as unknown as { name: string } | null)?.name ?? r.ingredient_id,
  }));
}

export async function addPosPriceAlias(posIngredientName: string, ingredientId: string): Promise<void> {
  await requireAdmin();
  if (!posIngredientName.trim() || !ingredientId) throw new Error("กรุณาระบุชื่อ POS และเลือกวัตถุดิบ");
  const supabase = await createClient();
  const { error } = await supabase
    .from("pos_price_aliases")
    .upsert({ pos_ingredient_name: posIngredientName.trim(), ingredient_id: ingredientId }, { onConflict: "pos_ingredient_name,ingredient_id" });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/ingredients");
}

export async function deletePosPriceAlias(id: string): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("pos_price_aliases").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner/ingredients");
}
