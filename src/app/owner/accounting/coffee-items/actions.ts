"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data";
import { parsePosMonthlyExport } from "@/lib/pos-parse";

type StoredCoffeeRow = {
  pos_product_name: string;
  is_coffee: boolean;
  share_per_unit: number | string | null;
};

/**
 * Every stored classification, paged.
 *
 * PostgREST caps a response at 1,000 rows server-side and a plain .select()
 * inherits that cap silently. This table holds one row per distinct product
 * ever reviewed — August alone carries about 1,047 — so an unpaged read starts
 * truncating on the first real classification.
 *
 * A truncated read here is not a display bug. A stored item that falls off the
 * end comes back with no `prior`, so the preview reports it as never reviewed
 * AND pre-ticks it from its POS category. One click of "accept all suggestions"
 * would then overwrite a human's decision with a category guess, in the table
 * that decides how much revenue is subtracted from the restaurant.
 */
async function loadStoredCoffeeRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<StoredCoffeeRow[]> {
  return fetchAllRows<StoredCoffeeRow>(({ from, to }) =>
    supabase
      .from("pos_coffee_items")
      .select("pos_product_name, is_coffee, share_per_unit")
      .order("pos_product_name")
      .range(from, to),
  );
}

/** NUMERIC(12,2) can come back as string or number; compare at the stored scale. */
function sameShare(a: number | string | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.round(Number(a) * 100) === Math.round(b * 100);
}

export type CoffeeCandidate = {
  productName: string;
  /** Every POS group/category this item appeared under, joined for display. */
  where: string;
  qty: number;
  gross: number;
  /** Whether a decision already exists. false = never reviewed. */
  reviewed: boolean;
  isCoffee: boolean;
  /** null = the whole line, when isCoffee. */
  sharePerUnit: number | null;
};

export type CoffeeClassificationPreview = {
  period: string;
  candidates: CoffeeCandidate[];
  /** Items with no row in pos_coffee_items — the ones needing a decision. */
  unreviewedCount: number;
  totalGross: number;
};

/**
 * Read an export and list every product in it, newest classification attached.
 *
 * Aggregated by product name across sale modes, because the classification is
 * a property of the item: ชานม is coffee whether it was sold in the shop, via
 * Grab, or via LineMan. parsePosMonthlyExport has already stripped the
 * (Grab)/(LM)/(ห่อ) prefixes, so the three collapse to one row here.
 */
export async function previewCoffeeClassification(
  formData: FormData,
): Promise<CoffeeClassificationPreview> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("ไม่พบไฟล์ที่อัปโหลด");

  const report = parsePosMonthlyExport(await file.arrayBuffer());
  if (report.lines.length === 0) {
    throw new Error(
      'อ่านไฟล์ไม่พบรายการขาย ตรวจสอบว่าเป็นไฟล์ "รายงานการขายตามสินค้า" ที่ export จาก POS หรือไม่',
    );
  }

  const agg = new Map<string, { qty: number; gross: number; where: Set<string> }>();
  for (const line of report.lines) {
    const key = line.productName;
    if (!key) continue;
    const e = agg.get(key) ?? { qty: 0, gross: 0, where: new Set<string>() };
    e.qty += line.qty;
    e.gross += line.gross;
    if (line.group) e.where.add(line.category ? `${line.group} :: ${line.category}` : line.group);
    agg.set(key, e);
  }

  const supabase = await createClient();
  const existing = await loadStoredCoffeeRows(supabase);

  const byName = new Map(
    existing.map((r) => [
      r.pos_product_name,
      { isCoffee: r.is_coffee, sharePerUnit: r.share_per_unit == null ? null : Number(r.share_per_unit) },
    ]),
  );

  const candidates: CoffeeCandidate[] = Array.from(agg.entries()).map(([productName, v]) => {
    const prior = byName.get(productName);
    return {
      productName,
      where: Array.from(v.where).join(", "),
      qty: v.qty,
      gross: v.gross,
      reviewed: prior !== undefined,
      // A never-reviewed item is PRE-TICKED only if the POS already files it
      // under ร้านกาแฟ. That is a starting suggestion, not a stored decision —
      // it stays `reviewed: false` so the screen can show it as needing one.
      isCoffee: prior ? prior.isCoffee : Array.from(v.where).some((w) => w.startsWith("ร้านกาแฟ")),
      sharePerUnit: prior ? prior.sharePerUnit : null,
    };
  });

  // Largest first: the twenty biggest items account for most of the coffee
  // total, so the tail can be skimmed once the running total reconciles.
  candidates.sort((a, b) => b.gross - a.gross);

  return {
    period: report.dateFrom,
    candidates,
    unreviewedCount: candidates.filter((c) => !c.reviewed).length,
    totalGross: report.grossTotal,
  };
}

/**
 * Record decisions for EVERY item shown, not only the coffee ones.
 *
 * Writing the not-coffee rows is what makes a missing row mean "new since the
 * last review" rather than "never got round to it". Without that, next month's
 * new menu item would inherit a default silently and the coffee exclusion
 * would drift by an amount nobody is looking at.
 */
export async function saveCoffeeClassification(
  items: { productName: string; isCoffee: boolean; sharePerUnit: number | null; touched: boolean }[],
): Promise<{ written: number; skipped: number }> {
  const profile = await requireAdmin();
  if (items.length === 0) return { written: 0, skipped: 0 };
  const supabase = await createClient();

  // The client already filters to decided rows, but this guard is repeated
  // server-side on purpose. reviewed_at/reviewed_by are the only audit evidence
  // this table has, and this table feeds a figure subtracted from restaurant
  // revenue — that is not a property to leave to whatever the browser sent.
  const stored = new Map(
    (await loadStoredCoffeeRows(supabase)).map((r) => [
      r.pos_product_name,
      { isCoffee: r.is_coffee, sharePerUnit: r.share_per_unit },
    ]),
  );

  const toWrite = items.filter((i) => {
    const prior = stored.get(i.productName);
    if (!prior) return true;                    // (a) never stored
    if (i.touched) return true;                 // (c) a human looked at it
    const share = i.isCoffee ? i.sharePerUnit : null;
    return prior.isCoffee !== i.isCoffee || !sameShare(prior.sharePerUnit, share); // (b)
  });

  const skipped = items.length - toWrite.length;
  if (toWrite.length === 0) {
    // Nothing changed. Deliberately no UPSERT at all, so every untouched row
    // keeps the reviewed_at it earned.
    return { written: 0, skipped };
  }

  const rows = toWrite.map((i) => ({
    pos_product_name: i.productName,
    is_coffee: i.isCoffee,
    // The CHECK constraint rejects a share on a non-coffee row, so normalise
    // here rather than letting a stale box value reach the database.
    share_per_unit: i.isCoffee ? i.sharePerUnit : null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: profile.id,
  }));

  // Chunked: a month can carry well over a thousand distinct products, and a
  // single upsert that large risks the request body limit rather than the row
  // cap. 500 keeps each request small and the whole thing is idempotent on
  // pos_product_name, so a retry cannot double-write.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from("pos_coffee_items")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "pos_product_name" });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/owner/accounting/coffee-items");
  return { written: rows.length, skipped };
}

export type CoffeeItemRow = {
  productName: string;
  isCoffee: boolean;
  sharePerUnit: number | null;
  reviewedAt: string;
};

/**
 * Current stored classification, coffee items only.
 *
 * Paged for the same reason as loadStoredCoffeeRows. The `is_coffee` filter
 * makes truncation unlikely in practice — this returns classified coffee items
 * (expected ~100-150), not the whole table — but "unlikely" is not a property
 * worth relying on for a count shown on screen, and leaving one unpaged read in
 * a file whose commit claims to have fixed truncation would force the next
 * reader to re-audit it.
 */
export async function listCoffeeItems(): Promise<CoffeeItemRow[]> {
  await requireAdmin();
  const supabase = await createClient();
  const data = await fetchAllRows<{
    pos_product_name: string;
    is_coffee: boolean;
    share_per_unit: number | string | null;
    reviewed_at: string;
  }>(({ from, to }) =>
    supabase
      .from("pos_coffee_items")
      .select("pos_product_name, is_coffee, share_per_unit, reviewed_at")
      .eq("is_coffee", true)
      .order("pos_product_name")
      .range(from, to),
  );
  return data.map((r) => ({
    productName: r.pos_product_name,
    isCoffee: r.is_coffee,
    // NUMERIC arrives as string or number depending on the driver; normalise
    // once here rather than letting both shapes reach the UI.
    sharePerUnit: r.share_per_unit == null ? null : Number(r.share_per_unit),
    reviewedAt: r.reviewed_at,
  }));
}
