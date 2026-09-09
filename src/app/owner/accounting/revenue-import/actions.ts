"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  checkPosExportPlausibility,
  parsePosMonthlyExport,
  posPeriodToYearMonth,
  type PosMonthlyExport,
} from "@/lib/pos-parse";
import { projectPosRevenue, REVENUE_TYPES, type ProjectionBlock, type RevenueType, type StoredCategory } from "@/lib/pos-revenue";

/** One revenue row, beside whatever is stored for that month today. */
export type RevenueComparison = {
  revenue_type: RevenueType;
  amount: number;
  /** null = no row stored yet. */
  current: number | null;
};

export type ExpenseComparison = {
  coa_code: string;
  amount: number;
  bill_ref: string;
  note: string;
  current: number | null;
};

export type ImportPreview = {
  yearMonth: string;
  entryDate: string;
  fileName: string;
  revenue: RevenueComparison[];
  /**
   * The accountants' figure, shown only so its exclusion is visible. The
   * import cannot write it — `other` is not a RevenueType and the RPC's
   * allowlist has no entry for it.
   */
  otherCurrent: number | null;
  expenses: ExpenseComparison[];
  blocks: ProjectionBlock[];
  grossTotal: number;
  restaurantGross: number;
  coffeeGross: number;
  carveOut: number;
  discounts: { discount: number; crmRaw: number; crmBooked: number; excluded: number; unclassifiedNames: string[] };
  platformFees: { method: string; amount: number; fee: number; ratePct: number }[];
  covers: { bills: number; customers: number; cancelledBills: number; cancelledAmount: number };
  /** Set when this month has been imported before — a re-run replaces it. */
  previousImport: { importedAt: string; sourceFile: string | null } | null;
};

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };

export type ApplyResult =
  | { ok: true; yearMonth: string; revenueWritten: number; expensesWritten: number; wasReimport: boolean }
  | { ok: false; error: string };

/** Every stored category, paged — PostgREST caps a plain select at 1,000 rows. */
async function loadCategories(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, StoredCategory>> {
  const { fetchAllRows } = await import("@/lib/data");
  const rows = await fetchAllRows<{
    pos_product_name: string;
    category: string;
    coffee_share_per_unit: number | string | null;
  }>(({ from, to }) =>
    supabase
      .from("pos_item_categories")
      .select("pos_product_name, category, coffee_share_per_unit")
      .order("pos_product_name")
      .range(from, to),
  );
  return new Map(
    rows.map((r) => [
      r.pos_product_name,
      {
        category: r.category,
        coffeeSharePerUnit: r.coffee_share_per_unit == null ? null : Number(r.coffee_share_per_unit),
      },
    ]),
  );
}

/**
 * Parse, project, and read what is stored today — writing nothing.
 *
 * Expected failures return values. A thrown message is redacted in production,
 * and this screen's whole job is to tell Nik precisely why a file was refused.
 */
async function buildPreview(
  file: File,
): Promise<{ ok: false; error: string } | { ok: true; preview: ImportPreview; report: PosMonthlyExport; yearMonth: string }> {
  let report: PosMonthlyExport;
  try {
    report = parsePosMonthlyExport(await file.arrayBuffer());
  } catch {
    return { ok: false, error: "อ่านไฟล์ไม่ได้ — ไฟล์เสียหรือไม่ใช่ไฟล์ Excel" };
  }

  const implausible = checkPosExportPlausibility(report);
  if (implausible) return { ok: false, error: implausible };

  const period = posPeriodToYearMonth(report.dateFrom, report.dateTo);
  if ("error" in period) return { ok: false, error: period.error };
  const { yearMonth } = period;

  const supabase = await createClient();
  const categories = await loadCategories(supabase);
  const { projection, blocks } = projectPosRevenue(report, yearMonth, categories);

  // What is stored today, so the preview can show current → new.
  const [revenueRes, expenseRes, importRes] = await Promise.all([
    supabase.from("monthly_revenue").select("revenue_type,amount").eq("year_month", yearMonth),
    supabase
      .from("expense_entries")
      .select("coa_code,amount,bill_ref")
      .in("bill_ref", projection.expenses.map((e) => e.bill_ref).concat(`POS-DISCOUNT-${yearMonth}`)),
    supabase.from("pos_revenue_imports").select("imported_at,source_file").eq("year_month", yearMonth).maybeSingle(),
  ]);
  if (revenueRes.error) return { ok: false, error: revenueRes.error.message };
  if (expenseRes.error) return { ok: false, error: expenseRes.error.message };

  const storedRevenue = new Map((revenueRes.data ?? []).map((r) => [r.revenue_type, Number(r.amount)]));
  const storedExpense = new Map((expenseRes.data ?? []).map((e) => [e.bill_ref as string, Number(e.amount)]));

  const projected = new Map(projection.revenue.map((r) => [r.revenue_type, r.amount]));

  return {
    ok: true,
    report,
    yearMonth,
    preview: {
      yearMonth,
      entryDate: projection.entryDate,
      fileName: file.name,
      // Every owned type is listed, including the ones this file has no sales
      // for: a type that currently holds a value and would be cleared is the
      // most important row on the screen, and omitting it would hide that.
      revenue: REVENUE_TYPES.map((t) => ({
        revenue_type: t,
        amount: projected.get(t) ?? 0,
        current: storedRevenue.has(t) ? storedRevenue.get(t)! : null,
      })),
      otherCurrent: storedRevenue.has("other") ? storedRevenue.get("other")! : null,
      expenses: projection.expenses.map((e) => ({
        coa_code: e.coa_code,
        amount: e.amount,
        bill_ref: e.bill_ref,
        note: e.note,
        current: storedExpense.has(e.bill_ref) ? storedExpense.get(e.bill_ref)! : null,
      })),
      blocks,
      grossTotal: projection.grossTotal,
      restaurantGross: projection.restaurantGross,
      coffeeGross: projection.coffeeGross,
      carveOut: projection.carveOut,
      discounts: {
        discount: projection.discounts.discount,
        crmRaw: projection.discounts.crmRaw,
        crmBooked: projection.discounts.crmBooked,
        excluded: projection.discounts.excluded,
        unclassifiedNames: projection.discounts.unclassified.map((u) => u.name),
      },
      platformFees: projection.platformFees,
      covers: projection.covers,
      previousImport: importRes.data
        ? { importedAt: importRes.data.imported_at as string, sourceFile: (importRes.data.source_file as string) ?? null }
        : null,
    },
  };
}

export async function previewPosRevenueImport(formData: FormData): Promise<PreviewResult> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด" };
  const built = await buildPreview(file);
  return built.ok ? { ok: true, preview: built.preview } : built;
}

/**
 * Write the month, atomically, from a SERVER-SIDE re-parse of the file.
 *
 * The client sends the file again rather than the numbers it was shown. Two
 * reasons, and the second is the one that matters:
 *
 *   1. numbers from a browser are not evidence of anything;
 *   2. a preview of file A followed by an apply of file B would otherwise
 *      write B while Nik believes he confirmed A.
 *
 * So the client echoes back the period and gross total it was shown, and this
 * refuses if the re-parse disagrees.
 */
export async function applyPosRevenueImport(formData: FormData): Promise<ApplyResult> {
  const profile = await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด" };

  const expectedYearMonth = String(formData.get("expectedYearMonth") ?? "");
  const expectedGross = Number(formData.get("expectedGrossTotal") ?? NaN);

  const built = await buildPreview(file);
  if (!built.ok) return built;
  const { preview, yearMonth } = built;

  if (yearMonth !== expectedYearMonth || Math.abs(preview.grossTotal - expectedGross) > 1) {
    return {
      ok: false,
      error:
        `ไฟล์ที่ยืนยันกับไฟล์ที่ส่งมาไม่ตรงกัน (ตรวจสอบแล้วได้ ${yearMonth} ยอด ${preview.grossTotal}, ` +
        `แต่หน้าจอยืนยัน ${expectedYearMonth} ยอด ${expectedGross}) — กรุณาอ่านไฟล์ใหม่แล้วยืนยันอีกครั้ง`,
    };
  }

  if (preview.blocks.length > 0) {
    return { ok: false, error: "ยังมีรายการที่ต้องแก้ก่อนบันทึก — กรุณาอ่านไฟล์ใหม่" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_pos_month", {
    p_year_month: yearMonth,
    p_revenue: preview.revenue.filter((r) => r.amount > 0).map((r) => ({ revenue_type: r.revenue_type, amount: r.amount })),
    p_expenses: preview.expenses.map((e) => ({
      coa_code: e.coa_code,
      amount: e.amount,
      bill_ref: e.bill_ref,
      note: e.note,
    })),
    p_entry_date: preview.entryDate,
    p_source_file: preview.fileName,
    p_gross_total: preview.grossTotal,
    p_restaurant_gross: preview.restaurantGross,
  });
  if (error) return { ok: false, error: error.message };

  const result = (data ?? {}) as Record<string, unknown>;
  void profile;

  revalidatePath("/owner/accounting/revenue-import");
  revalidatePath("/owner/accounting/summary");
  revalidatePath("/owner/accounting");
  return {
    ok: true,
    yearMonth,
    revenueWritten: Number(result.revenue_inserted ?? 0),
    expensesWritten: Number(result.expenses_inserted ?? 0),
    wasReimport: Boolean(result.was_reimport),
  };
}
