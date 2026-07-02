"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
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
};

export type PosImportPreview = {
  matched: PosImportRow[];
  unmatched: { materialCode: string; materialName: string }[];
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
  const { data: ingredients, error } = await supabase
    .from("ingredients")
    .select("id, name, purchase_cost, purchase_unit_label")
    .eq("is_prep", false);
  if (error) throw new Error(error.message);

  const byName = new Map((ingredients ?? []).map((i) => [i.name.trim(), i]));

  const matched: PosImportRow[] = [];
  const unmatched: { materialCode: string; materialName: string }[] = [];

  for (const row of parsed) {
    const ingredient = byName.get(row.materialName.trim());
    if (!ingredient) {
      unmatched.push({ materialCode: row.materialCode, materialName: row.materialName });
      continue;
    }
    const oldCost = ingredient.purchase_cost;
    const pctChange = oldCost && oldCost > 0 ? ((row.unitCost - oldCost) / oldCost) * 100 : null;
    const oldUnit = ingredient.purchase_unit_label?.trim() || null;
    // Only flag when both sides actually have a unit to compare — many
    // ingredients were never given a purchase_unit_label, so an empty
    // oldUnit isn't a real mismatch, just missing data.
    const unitMismatch = row.mixedUnits || (!!oldUnit && oldUnit !== row.unitName);
    matched.push({
      ingredientId: ingredient.id,
      name: ingredient.name,
      oldCost,
      newCost: Math.round(row.unitCost * 100) / 100,
      qty: row.qty,
      latestDateLabel: row.latestDateLabel,
      pctChange,
      oldUnit,
      newUnit: row.unitName,
      unitMismatch,
    });
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
