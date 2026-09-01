"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePosReceiptReport, proposeYieldQty } from "@/lib/pos-parse";

/**
 * How the POS delivery's unit relates to the unit the stored price is in.
 *  - "match"   — same unit, the new price is directly comparable.
 *  - "unset"   — the ingredient has no usable unit recorded ("-" or blank), so
 *                there is nothing to disagree with; the POS unit is adopted.
 *  - "changed" — genuinely different units. The price is denominated in the
 *                POS unit while yield_qty still describes the old one, so
 *                writing the price alone silently corrupts the derived cost
 *                (this is what happened to ซอสพริก). Blocked until resolved.
 */
export type PosUnitState = "match" | "unset" | "changed";

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
  unitState: PosUnitState;
  /** The latest delivery date carried more than one UnitName — its unit cost is unsafe either way. */
  mixedUnits: boolean;
  /** Current denominator, so a "changed" row can be resolved without leaving the screen. */
  currentReceiveQty: number;
  currentYieldQty: number | null;
  usageUnit: string | null;
  /** Starting point for yield_qty parsed from the POS unit label; null when it can't be derived. */
  proposedYieldQty: number | null;
  proposedYieldBasis: string | null;
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
  // requireAdmin, not requireOwner: the POS import tab renders whenever
  // isAdmin (admin OR owner) in owner/ingredients/page.tsx, so gating the
  // action on owner alone made every admin upload redirect to /owner with no
  // error — the tab was visible and the action refused. The alias functions
  // below already used requireAdmin, so this file disagreed with itself.
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("ไม่พบไฟล์ที่อัปโหลด");

  const buffer = await file.arrayBuffer();
  const parsed = parsePosReceiptReport(buffer);
  if (parsed.length === 0) {
    throw new Error("อ่านไฟล์ไม่พบรายการรับสินค้าเลย ตรวจสอบว่าเป็นไฟล์รายงาน \"ใบรับสินค้าตรง\" ที่ export มาจาก POS หรือไม่");
  }

  const supabase = await createClient();
  const [{ data: ingredients, error }, { data: aliases }] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, purchase_cost, purchase_unit_label, receive_qty, yield_qty, usage_unit")
      .eq("is_prep", false),
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

  type IngredientForImport = {
    id: string;
    name: string;
    purchase_cost: number | null;
    purchase_unit_label: string | null;
    receive_qty: number | null;
    yield_qty: number | null;
    usage_unit: string | null;
  };

  function buildRow(ingredient: IngredientForImport, unitCost: number, unitName: string, mixedUnits: boolean, latestDateLabel: string, qty: number, aliasSource?: string): PosImportRow {
    const oldCost = ingredient.purchase_cost;
    const pctChange = oldCost && oldCost > 0 ? ((unitCost - oldCost) / oldCost) * 100 : null;

    // "-" is the placeholder this system uses for "no unit recorded" and is
    // by far the most common value, so it counts as unset rather than as a
    // unit that disagrees with the POS. Treating it as a mismatch is what
    // made the old warning fire on ~37% of rows and get clicked through.
    const rawOldUnit = ingredient.purchase_unit_label?.trim() || null;
    const oldUnit = rawOldUnit === "-" ? null : rawOldUnit;
    const posUnit = unitName.trim();

    const unitState: PosUnitState = !oldUnit ? "unset" : oldUnit === posUnit ? "match" : "changed";

    const receiveQty = ingredient.receive_qty ?? 1;
    // Only worth proposing where the denominator is actually in question.
    const proposal =
      unitState === "changed" || unitState === "unset"
        ? proposeYieldQty(posUnit, ingredient.usage_unit, receiveQty)
        : null;

    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      oldCost,
      // 4dp, not 2. This is a cost per PURCHASE unit that rawUnitCost() then
      // divides by yield_qty (commonly 1000), so rounding here is magnified
      // into a systematic per-dish error that does not average out. Requires
      // purchase_cost_4dp_migration.sql — while the column is numeric(12,2)
      // Postgres re-rounds on write and this has no effect.
      newCost: Math.round(unitCost * 10000) / 10000,
      qty,
      latestDateLabel,
      pctChange,
      oldUnit,
      newUnit: posUnit,
      unitState,
      mixedUnits,
      currentReceiveQty: receiveQty,
      currentYieldQty: ingredient.yield_qty,
      usageUnit: ingredient.usage_unit,
      proposedYieldQty: proposal?.qty ?? null,
      proposedYieldBasis: proposal?.basis ?? null,
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

  // Blocked rows first (they need a decision), then mixed-unit deliveries,
  // then biggest price moves.
  const blockRank = (r: PosImportRow) => (r.unitState === "changed" ? 2 : r.mixedUnits ? 1 : 0);
  matched.sort(
    (a, b) => blockRank(b) - blockRank(a) || Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0),
  );
  return { matched, unmatched };
}

export type PosImportUpdate = {
  ingredientId: string;
  newCost: number;
  /**
   * Present only for a row that resolved a unit change or adopted a unit.
   * Writing the label REQUIRES stating the yield in the same call — see the
   * guard below.
   */
  newUnitLabel?: string;
  /** The denominator that goes with newUnitLabel. Explicit null means "no yield conversion". */
  newYieldQty?: number | null;
};

export async function applyPosImport(updates: PosImportUpdate[]): Promise<number> {
  // Must match previewPosImport. Relaxing only preview would move the bounce
  // here — after the admin has reviewed the preview and ticked rows.
  await requireAdmin();
  if (updates.length === 0) return 0;
  const supabase = await createClient();

  // The core invariant of this import: a price is meaningless without the
  // unit it is denominated in. Changing purchase_unit_label while leaving
  // yield_qty describing the old unit is exactly the ซอสพริก corruption, so
  // the two must move together. Enforced here rather than only in the UI,
  // because the UI's blocking is client-side and this action is callable
  // directly.
  for (const u of updates) {
    if (u.newUnitLabel !== undefined && u.newYieldQty === undefined) {
      throw new Error(
        `ไม่สามารถเปลี่ยนหน่วยของ "${u.newUnitLabel}" โดยไม่ระบุจำนวนตัดแต่ง (yield) — ราคาและหน่วยต้องอัปเดตพร้อมกัน`,
      );
    }
  }

  for (const u of updates) {
    const patch: Record<string, unknown> = { purchase_cost: u.newCost };
    if (u.newUnitLabel !== undefined) {
      patch.purchase_unit_label = u.newUnitLabel;
      patch.yield_qty = u.newYieldQty;
    }
    const { error } = await supabase.from("ingredients").update(patch).eq("id", u.ingredientId);
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
