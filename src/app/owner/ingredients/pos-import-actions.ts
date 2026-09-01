"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  proposeYieldQty,
  summarizeLatestDelivery,
  isoToDateKey,
  isoToThaiDateLabel,
  type PosMaterialDeliveries,
} from "@/lib/pos-parse";
import { validateChunk, MAX_ROWS_PER_BATCH } from "@/lib/pos-delivery-validation";

/** Batch ids are client-generated, so they are checked rather than trusted. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Ingests one chunk of browser-parsed deliveries.
 *
 * WHY CHUNKS. The .xls used to be posted whole to a Server Action, but Vercel
 * rejects request bodies over 4.5 MB before the function runs — a 5-month
 * export is now 4.69 MB, and the rejection surfaces as an unparseable
 * "unexpected response" with nothing in the logs. Parsing moved to the
 * browser; these rows are ~38.5% of the file's size, and they arrive 2,000 at
 * a time so the ceiling is gone rather than pushed out a year.
 *
 * NOT ATOMIC ACROSS CHUNKS, on purpose. Chunk 7 failing leaves chunks 1-6 in
 * the table. That is safe here and nowhere else in this codebase: the table is
 * an append-only log of POS facts keyed on UNIQUE (document_number,
 * material_code), so a half-uploaded batch is a SUBSET of true deliveries, not
 * corruption, and resending fills the gap as a no-op for what already landed.
 * import_batch_id makes a partial batch findable and removable.
 *
 * Every row is validated before it is written — see pos-delivery-validation.ts
 * for why that is required rather than defensive.
 */
export async function ingestPosDeliveries(
  batchId: string,
  rows: unknown,
): Promise<{ accepted: number }> {
  const profile = await requireAdmin();
  if (!UUID_RE.test(batchId)) throw new Error("รหัสชุดข้อมูลไม่ถูกต้อง");

  const check = validateChunk(rows);
  if (!check.ok) throw new Error(check.error);

  const supabase = await createClient();

  // Guard the batch total as well as the chunk size, so a client loop cannot
  // write unbounded rows one valid chunk at a time.
  const { count, error: countError } = await supabase
    .from("pos_receipt_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId);
  if (countError) throw new Error(countError.message);
  if (count == null) throw new Error("ตรวจสอบขนาดชุดข้อมูลไม่สำเร็จ จึงยังไม่บันทึก");
  if (count + check.rows.length > MAX_ROWS_PER_BATCH) {
    throw new Error(`ชุดข้อมูลนี้เกิน ${MAX_ROWS_PER_BATCH} แถว`);
  }

  const { error } = await supabase.from("pos_receipt_deliveries").upsert(
    check.rows.map((r) => ({
      material_code: r.materialCode,
      material_name: r.materialName,
      document_number: r.documentNumber,
      document_date: r.documentDate,
      vendor_name: r.vendorName,
      unit_name: r.unitName,
      qty: r.qty,
      total_cost_inc_vat: r.totalCostIncVat,
      total_cost_exc_vat: r.totalCostExcVat,
      imported_by: profile.id,
      import_batch_id: batchId,
    })),
    // Same key the backfill uses. ignoreDuplicates so re-sending a chunk is a
    // no-op rather than rewriting imported_at/imported_by on real history.
    { onConflict: "document_number,material_code", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);

  return { accepted: check.rows.length };
}

/**
 * Builds the preview from the rows of one batch, read back OUT OF THE TABLE.
 *
 * Reading from the table rather than from anything the browser still holds is
 * the point: it is the same source applyPosImport recomputes from, so what the
 * admin approves and what gets applied cannot drift.
 *
 * Scoped to this batch, NOT to the 90-day window, so which price wins is
 * exactly what it was when the server parsed the file itself. Widening this to
 * the window is the held (b)/(c) work and would change costing, not transport.
 */
export async function buildPosImportPreview(batchId: string): Promise<PosImportPreview> {
  await requireAdmin();
  if (!UUID_RE.test(batchId)) throw new Error("รหัสชุดข้อมูลไม่ถูกต้อง");
  const supabase = await createClient();

  const { data: rows, error: readError } = await supabase
    .from("pos_receipt_deliveries")
    .select("material_code, material_name, document_number, document_date, vendor_name, unit_name, qty, total_cost_inc_vat, total_cost_exc_vat")
    .eq("import_batch_id", batchId)
    // Deterministic, because the table cannot preserve the file's row order
    // (id is a random uuid). summarizeLatestDelivery takes the MAX dateKey and
    // sums that date's rows, so its result is order-independent; the only
    // order-sensitive field is which unit label shows on a mixed-unit row, and
    // those are flagged and blocked from being ticked either way.
    .order("material_code")
    .order("document_date")
    .order("document_number")
    .limit(MAX_ROWS_PER_BATCH);
  if (readError) throw new Error(readError.message);
  if (!rows || rows.length === 0) {
    throw new Error("ไม่พบข้อมูลของชุดนี้ กรุณาอัปโหลดไฟล์ใหม่");
  }

  // Rebuild the parser's in-memory shape. dateKey and dateLabel are not
  // persisted (see pos-parse.ts), so both are regenerated from document_date.
  const byMaterial = new Map<string, PosMaterialDeliveries>();
  for (const r of rows) {
    let m = byMaterial.get(r.material_code);
    if (!m) {
      m = { materialCode: r.material_code, materialName: r.material_name, deliveries: [] };
      byMaterial.set(r.material_code, m);
    }
    m.deliveries.push({
      documentNumber: r.document_number,
      dateKey: isoToDateKey(r.document_date),
      dateLabel: isoToThaiDateLabel(r.document_date),
      vendorName: r.vendor_name,
      unitName: r.unit_name,
      qty: Number(r.qty),
      totalCostIncVat: Number(r.total_cost_inc_vat),
      totalCostExcVat: Number(r.total_cost_exc_vat),
      // Derived, not stored. qty > 0 is guaranteed by the validator and by the
      // parser before it, so this matches what parsePosReceiptDeliveries built.
      unitCost: Number(r.total_cost_inc_vat) / Number(r.qty),
    });
  }

  const parsed = summarizeLatestDelivery([...byMaterial.values()]);

  const supabaseRead = supabase;
  const [{ data: ingredients, error }, { data: aliases }] = await Promise.all([
    supabaseRead
      .from("ingredients")
      .select("id, name, purchase_cost, purchase_unit_label, receive_qty, yield_qty, usage_unit")
      .eq("is_prep", false),
    supabaseRead.from("pos_price_aliases").select("pos_ingredient_name, ingredient_id"),
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
