"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data";
import { proposeYieldQty, summarizeLatestDelivery, isoToDateKey, isoToThaiDateLabel, type PosMaterialDeliveries } from "@/lib/pos-parse";
import { validateChunk, MAX_ROWS_PER_BATCH } from "@/lib/pos-delivery-validation";
import {
  priceFromDeliveries,
  detectUnitRedefinition,
  NON_FOOD_MATERIALS,
  type PricingDelivery,
  type PricingRule,
} from "@/lib/pos-pricing";

/** Batch ids come from the browser, so they are checked rather than trusted. */
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
  /** Which pooling step produced newCost — shown per row so a review is not a rubber stamp. */
  rule: PricingRule;
  /** Deliveries behind newCost, after outlier removal. 1 means a single observation. */
  poolSize: number;
  outliersDropped: number;
  vendorName: string;
  /** Dominant vendor share of the window, 0..1. */
  vendorShare: number;
  /** Top two vendors within 10% — which vendor "wins" may flip next import. */
  vendorUnsettled: boolean;
  /**
   * The unit label did not change but its MEANING appears to have: the price
   * ratio lands on a whole number, i.e. a pack count. Blocked like a unit
   * change, because it needs the same price+unit+yield resolution.
   */
  unitRedefinitionSuspected: boolean;
  suspectedPackCount: number | null;
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
 * The .xls used to be posted whole to this action, but Vercel rejects request
 * bodies over 4.5 MB before the function runs and a 5-month export is 4.69 MB —
 * which surfaced as an unparseable "unexpected response" with nothing in the
 * logs. The browser parses instead and sends rows, 2,000 at a time.
 *
 * ignoreDuplicates is CORRECT here, which it was not in the reverted attempt.
 * That version scoped the preview to import_batch_id, so when every uploaded
 * row already existed (the backfill had loaded the same files) nothing was
 * written, no row carried the batch id, and the preview found nothing. The
 * preview now reads the WINDOW, so rows already being present IS success and
 * this call has nothing to prove to a later step.
 *
 * It reports only what it observed. import_batch_id is written for forensics —
 * finding and deleting a bad upload — and nothing may depend on it.
 */
export async function ingestPosDeliveries(
  batchId: string,
  rows: unknown,
  sourceFile?: string,
): Promise<{ received: number; inserted: number }> {
  const profile = await requireAdmin();
  if (!UUID_RE.test(batchId)) throw new Error("รหัสชุดข้อมูลไม่ถูกต้อง");

  const check = validateChunk(rows);
  if (!check.ok) throw new Error(check.error);

  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("pos_receipt_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId);
  if (countError) throw new Error(countError.message);
  if (count == null) throw new Error("ตรวจสอบขนาดชุดข้อมูลไม่สำเร็จ จึงยังไม่บันทึก");
  if (count + check.rows.length > MAX_ROWS_PER_BATCH) {
    throw new Error(`ชุดข้อมูลนี้เกิน ${MAX_ROWS_PER_BATCH} แถว`);
  }

  // Report the rows ACTUALLY inserted, not the rows sent — the reverted attempt
  // returned the sent count and called it success while writing nothing.
  //
  // count: "exact" rather than .select("id"): a returned BODY is capped at
  // 1,000 rows by the server, so a 2,000-row chunk could report at most 1,000
  // inserted. The count header has no such cap. Verified against production.
  const { count: insertedCount, error } = await supabase
    .from("pos_receipt_deliveries")
    .upsert(
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
        source_file: sourceFile ?? null,
      })),
      { onConflict: "document_number,material_code", ignoreDuplicates: true, count: "exact" },
    );
  if (error) throw new Error(error.message);

  return { received: check.rows.length, inserted: insertedCount ?? 0 };
}

/**
 * Builds the preview from the delivery WINDOW, not from the uploaded file.
 *
 * Reading the table is the point: it is the same source applyPosImport
 * recomputes from, so what an admin approves and what is applied cannot drift.
 * The window is pos_import_settings.window_days, measured from today — a window
 * anchored to the newest row would keep pricing from stale data when nobody has
 * imported for months.
 */
export async function buildPosImportPreview(): Promise<PosImportPreview> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: settings, error: settingsError } = await supabase
    .from("pos_import_settings")
    .select("window_days")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  const windowDays = settings?.window_days ?? 90;
  const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);

  const [deliveries, ingredientsRes, aliasesRes] = await Promise.all([
    // PAGED. A plain select() here returned 1,000 of 4,489 window deliveries —
    // .limit() does not lift the server's row cap — so the review screen showed
    // 58 of 251 materials, ordered by material_code, and 193 materials could
    // never be repriced no matter how often anyone imported. The truncation is
    // a 200 with a short body, so nothing looked wrong.
    fetchAllRows<{
      material_code: string;
      material_name: string;
      document_date: string;
      vendor_name: string;
      unit_name: string;
      qty: number;
      total_cost_inc_vat: number;
    }>(({ from, to }) =>
      supabase
        .from("pos_receipt_deliveries")
        .select("material_code, material_name, document_date, vendor_name, unit_name, qty, total_cost_inc_vat")
        .gte("document_date", windowStart)
        .order("material_code")
        .order("document_date")
        .range(from, to),
    ),
    supabase
      .from("ingredients")
      .select("id, name, purchase_cost, purchase_unit_label, receive_qty, yield_qty, usage_unit")
      .eq("is_prep", false),
    supabase.from("pos_price_aliases").select("pos_ingredient_name, ingredient_id"),
  ]);
  if (ingredientsRes.error) throw new Error(ingredientsRes.error.message);
  if (aliasesRes.error) throw new Error(aliasesRes.error.message);

  if (deliveries.length === 0) {
    throw new Error(`ไม่พบข้อมูลการรับของใน ${windowDays} วันที่ผ่านมา กรุณาอัปโหลดไฟล์จาก POS ก่อน`);
  }

  const ingredients = ingredientsRes.data ?? [];
  const byName = new Map(ingredients.map((i) => [i.name.trim(), i]));
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const aliasMap = new Map<string, string[]>();
  for (const a of aliasesRes.data ?? []) {
    const k = a.pos_ingredient_name.trim();
    aliasMap.set(k, (aliasMap.get(k) ?? []).concat(a.ingredient_id));
  }

  // Group the window by material, and keep a parser-shaped copy so the existing
  // latestDateLabel / mixedUnits display logic still works unchanged.
  const grouped = new Map<string, { name: string; pricing: PricingDelivery[]; parsed: PosMaterialDeliveries }>();
  for (const d of deliveries) {
    const key = d.material_code;
    let e = grouped.get(key);
    if (!e) {
      e = {
        name: d.material_name,
        pricing: [],
        parsed: { materialCode: d.material_code, materialName: d.material_name, deliveries: [] },
      };
      grouped.set(key, e);
    }
    const qty = Number(d.qty);
    const inc = Number(d.total_cost_inc_vat);
    e.pricing.push({
      documentDate: d.document_date,
      vendorName: d.vendor_name,
      unitName: d.unit_name,
      qty,
      totalCostIncVat: inc,
    });
    e.parsed.deliveries.push({
      documentNumber: "",
      dateKey: isoToDateKey(d.document_date),
      dateLabel: isoToThaiDateLabel(d.document_date),
      vendorName: d.vendor_name,
      unitName: d.unit_name,
      qty,
      totalCostIncVat: inc,
      totalCostExcVat: inc,
      unitCost: qty > 0 ? inc / qty : 0,
    });
  }

  const matched: PosImportRow[] = [];
  const unmatched: { materialCode: string; materialName: string }[] = [];
  const seen = new Set<string>();

  for (const [materialCode, group] of grouped) {
    const posName = group.name.trim();
    // Non-food buckets never become an ingredient price. Their "unit costs" are
    // period totals booked against a catch-all code (฿24,246 per กรัม, and so on).
    if (NON_FOOD_MATERIALS.has(posName)) continue;

    const targets: typeof ingredients = [];
    const direct = byName.get(posName);
    if (direct) targets.push(direct);
    for (const id of aliasMap.get(posName) ?? []) {
      const g = byId.get(id);
      if (g && !targets.includes(g)) targets.push(g);
    }
    if (targets.length === 0) {
      unmatched.push({ materialCode, materialName: group.name });
      continue;
    }

    const priced = priceFromDeliveries(group.pricing);
    if (!priced) continue;
    // Kept for latestDateLabel and the mixed-unit warning, which describe the
    // most recent delivery rather than the pool.
    const summary = summarizeLatestDelivery([group.parsed])[0]!;

    for (const ingredient of targets) {
      if (seen.has(ingredient.id)) continue;
      seen.add(ingredient.id);
      matched.push(
        buildRow(ingredient, priced, summary, posName === ingredient.name.trim() ? undefined : posName),
      );
    }
  }

  // Anything needing a decision first: a suspected unit redefinition, then a
  // changed unit, then a mixed-unit latest delivery, then the biggest moves.
  const blockRank = (r: PosImportRow) =>
    r.unitRedefinitionSuspected ? 3 : r.unitState === "changed" ? 2 : r.mixedUnits ? 1 : 0;
  matched.sort(
    (a, b) => blockRank(b) - blockRank(a) || Math.abs(b.pctChange ?? 0) - Math.abs(a.pctChange ?? 0),
  );
  return { matched, unmatched };
}

type IngredientForImport = {
  id: string;
  name: string;
  purchase_cost: number | null;
  purchase_unit_label: string | null;
  receive_qty: number | null;
  yield_qty: number | null;
  usage_unit: string | null;
};

function buildRow(
  ingredient: IngredientForImport,
  priced: NonNullable<ReturnType<typeof priceFromDeliveries>>,
  summary: { latestDateLabel: string; mixedUnits: boolean; qty: number },
  aliasSource?: string,
): PosImportRow {
  const oldCost = ingredient.purchase_cost == null ? null : Number(ingredient.purchase_cost);

  // "-" is this system's placeholder for "no unit recorded" and is the most
  // common value, so it counts as unset rather than as a unit that disagrees.
  const rawOldUnit = ingredient.purchase_unit_label?.trim() || null;
  const oldUnit = rawOldUnit === "-" ? null : rawOldUnit;
  const posUnit = priced.unitName.trim();
  const unitState: PosUnitState = !oldUnit ? "unset" : oldUnit === posUnit ? "match" : "changed";

  // Only meaningful when both prices are in the same unit. A changed unit makes
  // the two numbers different measures, so a percentage would be nonsense.
  const comparable = unitState !== "changed";
  const pctChange = comparable && oldCost && oldCost > 0 ? ((priced.price - oldCost) / oldCost) * 100 : null;

  // Same-unit only: a redefinition is precisely the case where the label agrees
  // and the meaning does not.
  const redef = unitState === "match" ? detectUnitRedefinition(oldCost, priced.price) : { suspected: false as const };

  const receiveQty = ingredient.receive_qty ?? 1;
  const proposal =
    unitState === "changed" || unitState === "unset"
      ? proposeYieldQty(posUnit, ingredient.usage_unit, receiveQty)
      : null;

  return {
    ingredientId: ingredient.id,
    name: ingredient.name,
    oldCost,
    // 4dp: this is a cost per PURCHASE unit that rawUnitCost() divides by
    // yield_qty (commonly 1000), so rounding here is magnified per dish.
    newCost: Math.round(priced.price * 10000) / 10000,
    qty: summary.qty,
    latestDateLabel: summary.latestDateLabel,
    pctChange,
    oldUnit,
    newUnit: posUnit,
    unitState,
    mixedUnits: summary.mixedUnits,
    currentReceiveQty: receiveQty,
    currentYieldQty: ingredient.yield_qty,
    usageUnit: ingredient.usage_unit,
    proposedYieldQty: proposal?.qty ?? null,
    proposedYieldBasis: proposal?.basis ?? null,
    aliasSource,
    rule: priced.rule,
    poolSize: priced.poolSize,
    outliersDropped: priced.outliersDropped,
    vendorName: priced.vendorName,
    vendorShare: priced.vendorShare,
    vendorUnsettled: priced.vendorUnsettled,
    unitRedefinitionSuspected: redef.suspected,
    suspectedPackCount: redef.suspected ? redef.packCount : null,
  };
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
