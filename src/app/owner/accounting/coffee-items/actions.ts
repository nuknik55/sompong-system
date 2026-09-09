"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data";
import { checkPosExportPlausibility, parsePosMonthlyExport, type PosMonthlyExport } from "@/lib/pos-parse";
import { aggregateForClassification, platformRates } from "@/lib/pos-classify";
import { isCategory, type Category } from "./categories";

type StoredRow = {
  pos_product_name: string;
  category: string;
  coffee_share_per_unit: number | string | null;
  reviewed_at: string;
};

/**
 * Every stored classification, paged.
 *
 * PostgREST caps a response at 1,000 rows server-side and a plain .select()
 * inherits that cap silently. This table holds one row per distinct product
 * ever reviewed — 523 from the seed alone, growing every month — so an unpaged
 * read starts truncating within the first year.
 *
 * A truncated read here is not a display bug. A stored item that falls off the
 * end comes back with no `prior`, so the preview reports it as never reviewed
 * and the screen asks for a decision it already has. Worse, saving that row
 * would overwrite a human's category with whatever was picked second time
 * round, in the table that decides how revenue is split.
 */
async function loadStoredRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<StoredRow[]> {
  return fetchAllRows<StoredRow>(({ from, to }) =>
    supabase
      .from("pos_item_categories")
      .select("pos_product_name, category, coffee_share_per_unit, reviewed_at")
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

/**
 * The CHECK on pos_item_categories forbids a carve-out on a coffee row and a
 * carve-out that is not positive. Normalise to what the constraint accepts
 * rather than letting a stale box value reach the database.
 */
function normaliseShare(category: Category, share: number | null): number | null {
  if (category === "coffee") return null;
  return share != null && Number.isFinite(share) && share > 0 ? share : null;
}

/** A stored row, shaped for the client. The DB CHECK guarantees `category` is one of the six. */
function toStored(r: StoredRow): { category: Category | null; coffeeSharePerUnit: number | null } {
  return {
    category: isCategory(r.category) ? r.category : null,
    coffeeSharePerUnit: r.coffee_share_per_unit == null ? null : Number(r.coffee_share_per_unit),
  };
}

export type ItemCandidate = {
  productName: string;
  /** Every POS group/category this item appeared under, joined for display. The hint, not a suggestion. */
  where: string;
  qty: number;
  gross: number;
  /** Whole-line contribution to the coffee total, net of discount and GP — see pos-classify.ts. */
  netWhole: number;
  /** Multiply by a per-unit carve-out to get its net contribution. */
  carveWeight: number;
  /** Whether a row exists in pos_item_categories. false = never reviewed. */
  reviewed: boolean;
  /**
   * The stored category, or null when there is no row. null is "not yet
   * decided" — a distinct state from all six, and the ONLY value a row without
   * a stored category ever arrives with. Nothing here derives a category from
   * the POS group: that mapping was one-time seed machinery and deliberately
   * does not live in the monthly path.
   */
  category: Category | null;
  /** Baht per unit that leaves this item's category for the coffee shop. */
  coffeeSharePerUnit: number | null;
};

export type ItemClassificationPreview = {
  period: string;
  candidates: ItemCandidate[];
  /** Items with no row in pos_item_categories — the ones needing a decision. */
  unreviewedCount: number;
  totalGross: number;
};

/**
 * Expected failures come back as values, not throws. Next.js redacts a thrown
 * message in production — Nik would see "An error occurred in the Server
 * Components render" instead of which file to upload — so a message that
 * ships as a throw is a message nobody can read.
 */
export type PreviewResult =
  | { ok: true; preview: ItemClassificationPreview }
  | { ok: false; error: string };

/**
 * Read an export and list every product in it, stored classification attached.
 */
export async function previewItemClassification(formData: FormData): Promise<PreviewResult> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด" };

  let report: PosMonthlyExport;
  try {
    report = parsePosMonthlyExport(await file.arrayBuffer());
  } catch {
    // INSURANCE, NOT AN OBSERVED FIX. No file on the machine this was written
    // on — 36 tried, including browser saves of the POS page and the
    // hand-built workbook — makes the parser throw; it returns zeros and the
    // plausibility check below refuses those. This catch covers a workbook
    // XLSX.read itself rejects (encrypted, unknown container), which would
    // otherwise reach Nik as a redacted RSC error. Do not remove it believing
    // it was load-bearing, and do not keep it believing it caught something.
    return { ok: false, error: "อ่านไฟล์ไม่ได้ — ไฟล์เสียหรือไม่ใช่ไฟล์ Excel" };
  }

  // A wrong file parses without error into a well-formed object of zeros;
  // the guard is what turns that into a sentence Nik can act on.
  const implausible = checkPosExportPlausibility(report);
  if (implausible) return { ok: false, error: implausible };

  // A delivery line with no rate would make the "net of GP" total on screen
  // false. Refuse rather than default to 0.
  const { rates, missing } = platformRates(report);
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `ไฟล์มียอดขายช่องทาง ${missing.join(", ")} แต่ไม่พบแถวชำระเงินของช่องทางนั้นในแผ่นที่ 2 ` +
        "จึงคำนวณ GP ไม่ได้ — ตรวจสอบว่า export ครบทั้ง 5 แผ่น",
    };
  }
  const items = aggregateForClassification(report, rates);

  const supabase = await createClient();
  const byName = new Map((await loadStoredRows(supabase)).map((r) => [r.pos_product_name, toStored(r)]));

  const candidates: ItemCandidate[] = items.map((item) => {
    const prior = byName.get(item.productName);
    return {
      ...item,
      reviewed: prior !== undefined,
      category: prior ? prior.category : null,
      coffeeSharePerUnit: prior ? prior.coffeeSharePerUnit : null,
    };
  });

  return {
    ok: true,
    preview: {
      period: report.dateFrom,
      candidates,
      unreviewedCount: candidates.filter((c) => !c.reviewed).length,
      totalGross: report.grossTotal,
    },
  };
}

/**
 * Record decisions for EVERY decided item, in every category.
 *
 * Writing the food/drink/… rows is what makes a missing row mean "new since
 * the last review" rather than "never got round to it". Without that, next
 * month's new menu item would be indistinguishable from one nobody looked at.
 */
export async function saveItemClassification(
  items: { productName: string; category: string; coffeeSharePerUnit: number | null; touched: boolean }[],
): Promise<{ written: number; skipped: number }> {
  const profile = await requireAdmin();
  if (items.length === 0) return { written: 0, skipped: 0 };

  // Unexpected-input path, and a throw is the right shape for it: the client
  // only ever sends the six values, so anything else is a tampered or stale
  // payload, and the CHECK would reject it regardless. Production redacts a
  // thrown message — nobody sees the value — which is acceptable for input no
  // user can produce from the screen. Failures a user CAN produce on this
  // page return values instead (see PreviewResult).
  const decided = items.map((i) => {
    if (!isCategory(i.category)) throw new Error(`หมวด "${i.category}" ไม่ถูกต้อง (${i.productName})`);
    return { ...i, category: i.category, coffeeSharePerUnit: normaliseShare(i.category, i.coffeeSharePerUnit) };
  });

  const supabase = await createClient();

  // The client already filters to decided rows, but this guard is repeated
  // server-side on purpose. reviewed_at/reviewed_by are the only audit
  // evidence this table has, and this table decides how revenue is split —
  // that is not a property to leave to whatever the browser sent.
  const stored = new Map((await loadStoredRows(supabase)).map((r) => [r.pos_product_name, r]));

  const toWrite = decided.filter((i) => {
    const prior = stored.get(i.productName);
    if (!prior) return true;    // (a) never stored
    if (i.touched) return true; // (c) a human looked at it
    return prior.category !== i.category || !sameShare(prior.coffee_share_per_unit, i.coffeeSharePerUnit); // (b)
  });

  const skipped = decided.length - toWrite.length;
  if (toWrite.length === 0) {
    // Nothing changed. Deliberately no UPSERT at all, so every untouched row
    // keeps the reviewed_at it earned.
    return { written: 0, skipped };
  }

  const rows = toWrite.map((i) => ({
    pos_product_name: i.productName,
    category: i.category,
    coffee_share_per_unit: i.coffeeSharePerUnit,
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
      .from("pos_item_categories")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "pos_product_name" });
    if (error) throw new Error(error.message);
  }

  revalidatePath("/owner/accounting/coffee-items");
  return { written: rows.length, skipped };
}

export type StoredItem = {
  productName: string;
  category: Category | null;
  coffeeSharePerUnit: number | null;
  reviewedAt: string;
};

/**
 * Every stored classification, for the page's summary. Paged, via the same
 * reader the preview uses, so the count on screen cannot be a truncated one.
 */
export async function listStoredItems(): Promise<StoredItem[]> {
  await requireAdmin();
  const supabase = await createClient();
  return (await loadStoredRows(supabase)).map((r) => ({
    productName: r.pos_product_name,
    ...toStored(r),
    reviewedAt: r.reviewed_at,
  }));
}
