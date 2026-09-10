"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data";
import { parseBudget69, projectBudget69Month, type Budget69Block, type Budget69Sheet } from "@/lib/budget69";

/**
 * budget69 monthly import — the server side.
 *
 * OWNER ONLY, on the page and on both actions. This import writes
 * 790 เงินเดือนเจ้าของร้าน, which is_sensitive keeps from every non-owner
 * read; an admin must not be able to write what they cannot see. The RPC is
 * the second lock.
 *
 * Expected failures are return values: production redacts a thrown Server
 * Action message, and this screen's job is to say exactly why a month
 * refused.
 */

export type EntryView = {
  coa_code: string;
  coa_name: string;
  sheetAmount: number;
  appAmount: number;
  lump: number;
  rows: number[];
};

export type MonthOverview = {
  yearMonth: string;
  revenue: number;
  sheetExpenseTotal: number;
  entries: number;
  writtenTotal: number;
  posOwnedTotal: number;
  unmapped: number;
  reconciles: boolean;
  importedAt: string | null;
};

export type Budget69Preview = {
  yearMonth: string;
  fileName: string;
  revenue: number;
  netProfit: number;
  sheetExpenseTotal: number;
  sheetTotalMapped: number;
  writtenTotal: number;
  entries: EntryView[];
  negatives: { coa_code: string; coa_name: string; sheetAmount: number; appAmount: number }[];
  appOnly: { coa_code: string; coa_name: string; appAmount: number }[];
  posOwned: { coa_code: string; coa_name: string; sheetAmount: number }[];
  sheetExcluded: { row: number; name: string; amount: number }[];
  blocks: Budget69Block[];
  previousImport: { importedAt: string; sourceFile: string | null } | null;
  /** Every month the sheet has revenue for, with its reconciliation status. */
  overview: MonthOverview[];
};

export type PreviewResult = { ok: true; preview: Budget69Preview } | { ok: false; error: string };
export type ApplyResult =
  | { ok: true; yearMonth: string; inserted: number; deleted: number; wasReimport: boolean }
  | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** App entries per code per month for the year, EXCLUDING budget69's own lumps — the remainder rule. */
async function loadAppSums(supabase: Supabase, year: number): Promise<Map<string, Map<string, number>>> {
  const rows = await fetchAllRows<{ entry_date: string; coa_code: string; amount: number; bill_ref: string | null }>(
    ({ from, to }) =>
      supabase
        .from("expense_entries")
        .select("entry_date,coa_code,amount,bill_ref")
        .gte("entry_date", `${year}-01-01`)
        .lte("entry_date", `${year}-12-31`)
        .order("id")
        .range(from, to),
  );
  const byMonth = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.bill_ref?.startsWith("B69-")) continue;
    const ym = r.entry_date.slice(0, 7);
    const m = byMonth.get(ym) ?? new Map<string, number>();
    m.set(r.coa_code, (m.get(r.coa_code) ?? 0) + Number(r.amount));
    byMonth.set(ym, m);
  }
  return byMonth;
}

async function build(
  file: File,
  yearMonth: string,
): Promise<{ ok: false; error: string } | { ok: true; preview: Budget69Preview; sheet: Budget69Sheet }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return { ok: false, error: `เดือนไม่ถูกต้อง: ${yearMonth}` };
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));

  let parsed: ReturnType<typeof parseBudget69>;
  try {
    parsed = parseBudget69(await file.arrayBuffer());
  } catch {
    // Insurance, not an observed fix: the real file parses. A workbook
    // XLSX.read rejects would otherwise reach Nik as a redacted RSC error.
    return { ok: false, error: "อ่านไฟล์ไม่ได้ — ไฟล์เสียหรือไม่ใช่ไฟล์ Excel" };
  }
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const { sheet } = parsed;

  const supabase = await createClient();
  const [appSums, coaRes, importsRes] = await Promise.all([
    loadAppSums(supabase, year),
    supabase.from("coa").select("code,name"),
    supabase.from("budget69_imports").select("year_month,imported_at,source_file"),
  ]);
  if (coaRes.error) return { ok: false, error: coaRes.error.message };
  if (importsRes.error) return { ok: false, error: importsRes.error.message };
  const nameOf = new Map((coaRes.data ?? []).map((c) => [c.code as string, c.name as string]));
  const imports = new Map((importsRes.data ?? []).map((i) => [i.year_month as string, i]));

  const { projection: p, blocks } = projectBudget69Month(sheet, month, appSums.get(yearMonth) ?? new Map(), yearMonth);
  const name = (code: string) => nameOf.get(code) ?? "?";

  // The overview: every month the sheet has revenue for, run through the
  // same projection, so the picker shows which months reconcile before Nik
  // chooses one.
  const revenueRow = sheet.rows.find((r) => r.name === "ยอดขาย")!;
  const overview: MonthOverview[] = [];
  for (let m = 1; m <= 12; m++) {
    if (revenueRow.actual[m] === 0) continue;
    const ym = `${year}-${String(m).padStart(2, "0")}`;
    const { projection: q, blocks: b } = projectBudget69Month(sheet, m, appSums.get(ym) ?? new Map(), ym);
    overview.push({
      yearMonth: ym,
      revenue: q.revenue,
      sheetExpenseTotal: q.sheetExpenseTotal,
      entries: q.entries.filter((e) => e.lump > 0).length,
      writtenTotal: q.writtenTotal,
      posOwnedTotal: Math.round(q.posOwned.reduce((s, x) => s + x.sheetAmount, 0) * 100) / 100,
      unmapped: b.find((x) => x.kind === "unmapped")?.rows.length ?? 0,
      reconciles: !b.some((x) => x.kind === "unexplained"),
      importedAt: (imports.get(ym)?.imported_at as string) ?? null,
    });
  }

  const prev = imports.get(yearMonth);
  return {
    ok: true,
    sheet,
    preview: {
      yearMonth,
      fileName: file.name,
      revenue: p.revenue,
      netProfit: p.netProfit,
      sheetExpenseTotal: p.sheetExpenseTotal,
      sheetTotalMapped: p.sheetTotalMapped,
      writtenTotal: p.writtenTotal,
      entries: p.entries.map((e) => ({ ...e, coa_name: name(e.coa_code) })),
      negatives: p.negatives.map((n) => ({ ...n, coa_name: name(n.coa_code) })),
      appOnly: p.appOnly.map((a) => ({ ...a, coa_name: name(a.coa_code) })),
      posOwned: p.posOwned.map((x) => ({ ...x, coa_name: name(x.coa_code) })),
      sheetExcluded: p.sheetExcluded,
      blocks,
      previousImport: prev ? { importedAt: prev.imported_at as string, sourceFile: (prev.source_file as string) ?? null } : null,
      overview,
    },
  };
}

export async function previewBudget69Import(formData: FormData): Promise<PreviewResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด" };
  const built = await build(file, String(formData.get("yearMonth") ?? ""));
  return built.ok ? { ok: true, preview: built.preview } : built;
}

/**
 * Write the month atomically from a SERVER-SIDE re-parse. The client echoes
 * the month and the sheet's expense total it was shown; a different file, or
 * an edited one, is refused rather than written under the old preview.
 */
export async function applyBudget69Import(formData: FormData): Promise<ApplyResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด" };
  const yearMonth = String(formData.get("yearMonth") ?? "");
  const expectedTotal = Number(formData.get("expectedSheetExpenseTotal") ?? NaN);

  const built = await build(file, yearMonth);
  if (!built.ok) return built;
  const { preview } = built;

  if (Math.abs(preview.sheetExpenseTotal - expectedTotal) > 1) {
    return {
      ok: false,
      error:
        `ไฟล์ที่ยืนยันกับไฟล์ที่ส่งมาไม่ตรงกัน (อ่านได้ ${preview.sheetExpenseTotal} แต่หน้าจอยืนยัน ${expectedTotal}) ` +
        "— กรุณาอ่านไฟล์ใหม่แล้วยืนยันอีกครั้ง",
    };
  }
  // THE STOP, server-side too: a month that does not reconcile by
  // explanation is refused whatever the client sent.
  if (preview.blocks.length > 0) return { ok: false, error: "เดือนนี้ยังไม่ผ่านการตรวจสอบ — กรุณาอ่านไฟล์ใหม่และแก้รายการที่ค้าง" };

  const supabase = await createClient();
  // A month is budget69 OR the outsourced accountant's file, never both.
  // import_outsource_month refuses expense entries for a month budget69
  // owns; this is the reverse direction, which that RPC cannot see and this
  // one predates. Evidence, not provenance: the OUT- lumps themselves.
  const outLumps = await supabase
    .from("expense_entries")
    .select("id", { count: "exact", head: true })
    .like("bill_ref", `OUT-%-${yearMonth}`);
  if (outLumps.error) return { ok: false, error: outLumps.error.message };
  if ((outLumps.count ?? 0) > 0) {
    return {
      ok: false,
      error: `เดือน ${yearMonth} บันทึกรายจ่ายรายเดือนจากไฟล์บัญชีแล้ว (${outLumps.count} รายการ OUT-) — budget69 เขียนทับไม่ได้ เดือนหนึ่งมีแหล่งเดียว`,
    };
  }
  const entries = preview.entries
    .filter((e) => e.lump > 0)
    .map((e) => ({
      coa_code: e.coa_code,
      amount: e.lump,
      note: `budget69 ${yearMonth} · ${e.coa_name}${e.appAmount > 0 ? ` (ยอดชีต ${e.sheetAmount} − บันทึกรายวัน ${e.appAmount})` : ""}`,
    }));
  const { data, error } = await supabase.rpc("import_budget69_month", {
    p_year_month: yearMonth,
    p_entries: entries,
    p_source_file: preview.fileName,
    p_sheet_total: preview.sheetTotalMapped,
    p_written_total: preview.writtenTotal,
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as Record<string, unknown>;

  revalidatePath("/owner/accounting/import");
  revalidatePath("/owner/accounting/summary");
  revalidatePath("/owner/accounting/daily");
  revalidatePath("/owner/accounting");
  return { ok: true, yearMonth, inserted: Number(r.inserted ?? 0), deleted: Number(r.deleted ?? 0), wasReimport: Boolean(r.was_reimport) };
}
