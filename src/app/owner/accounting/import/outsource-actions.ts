"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/data";
import {
  parseOutsource,
  projectOutsourceMonth,
  type LabelledRow,
  type OutsourceBlock,
  type OutsourceFile,
} from "@/lib/outsource";

/**
 * The outsourced accountant's file (69-08.xlsx …) — the server side.
 *
 * OWNER ONLY, on the page and on both actions: this writes 790. The RPC is
 * the second lock, and it also refuses expense entries for a month budget69
 * owns. The reverse — budget69 writing a month that already has OUT lumps —
 * is refused in actions.ts, because the RPC on that side predates this one.
 *
 * One upload carries every month the accountant has closed. The preview
 * parses all of them and returns all of them; the client picks a month
 * locally, and apply re-parses the same file server-side and echo-checks
 * the month's block total and `other` against what the screen showed.
 *
 * Expected failures are return values: production redacts a thrown Server
 * Action message.
 */

// The ledger begins here. Earlier months in the file (Dec 2568) are shown
// and skipped, as decided. Not exported: a "use server" file may export only
// async functions, and this constant would fail the build (AGENTS.md).
const LEDGER_START = "2026-01";

export type OutsourceEntryView = {
  coa_code: string;
  coa_name: string;
  amount: number;
  rows: LabelledRow[];
  /** The same label in the cash-paid block — a different figure, already in the app as daily entries. */
  cashTwin: LabelledRow | null;
  /** The app's own entries on this code this month, for information. Never subtracted. */
  appDaily: number;
};

export type OutsourceMonthPreview = {
  yearMonth: string;
  firstRow: number;
  lastRow: number;
  /** budget69 owns this month's expenses: only `other` is written. */
  budget69Owned: boolean;
  /** Before LEDGER_START: shown, never written. */
  beforeLedger: boolean;
  entries: OutsourceEntryView[];
  notImported: { label: string; row: number; value: number; reason: string; appDaily?: number; mismatch?: boolean }[];
  other: { value: number; sheet: string; tiedBy: string } | { missing: string };
  /** monthly_revenue.other as stored today, so the change is visible before it is made. */
  storedOther: number | null;
  blockTotal: number;
  writtenTotal: number;
  total: number;
  cashTotal: number;
  blocks: OutsourceBlock[];
  previousImport: { importedAt: string; sourceFile: string | null; expensesWritten: boolean } | null;
};

export type OutsourcePreview = {
  fileName: string;
  expenseSheet: string;
  months: OutsourceMonthPreview[];
  /** File-level blocks (none today — every stop is per month). Present so the shared reducer's invariant applies. */
  blocks: OutsourceBlock[];
};

export type OutsourcePreviewResult = { ok: true; preview: OutsourcePreview } | { ok: false; error: string };
export type OutsourceApplyResult =
  | { ok: true; yearMonth: string; inserted: number; deleted: number; other: number; wasReimport: boolean; budget69Owned: boolean }
  | { ok: false; error: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The app's figure per code per month. OUT- lumps are excluded (they are
 * what a re-import replaces); B69- lumps are INCLUDED, because on a
 * budget69-owned month they are the app's figure — the social-security
 * check reads "=" for Jan–Jul only if they count.
 */
async function loadAppByCode(supabase: Supabase, from: string, to: string): Promise<Map<string, Map<string, number>>> {
  const rows = await fetchAllRows<{ entry_date: string; coa_code: string; amount: number; bill_ref: string | null }>(
    ({ from: a, to: b }) =>
      supabase
        .from("expense_entries")
        .select("entry_date,coa_code,amount,bill_ref")
        .gte("entry_date", `${from}-01`)
        .lte("entry_date", `${to}-31`)
        .order("id")
        .range(a, b),
  );
  const byMonth = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.bill_ref?.startsWith("OUT-")) continue;
    const ym = r.entry_date.slice(0, 7);
    const m = byMonth.get(ym) ?? new Map<string, number>();
    m.set(r.coa_code, (m.get(r.coa_code) ?? 0) + Number(r.amount));
    byMonth.set(ym, m);
  }
  return byMonth;
}

async function build(file: File): Promise<{ ok: false; error: string } | { ok: true; preview: OutsourcePreview; file: OutsourceFile }> {
  let parsed: ReturnType<typeof parseOutsource>;
  try {
    parsed = parseOutsource(await file.arrayBuffer());
  } catch {
    // Insurance: a workbook XLSX.read rejects would otherwise reach Nik as a
    // redacted RSC error.
    return { ok: false, error: "อ่านไฟล์ไม่ได้ — ไฟล์เสียหรือไม่ใช่ไฟล์ Excel" };
  }
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const parsedFile = parsed.file;
  if (parsedFile.months.length === 0) return { ok: false, error: "ไม่พบเดือนใดในไฟล์" };

  const yms = parsedFile.months.map((m) => m.yearMonth).sort();
  const supabase = await createClient();
  const [appByMonth, coaRes, b69Res, outRes, otherRes] = await Promise.all([
    loadAppByCode(supabase, yms[0]!, yms[yms.length - 1]!),
    supabase.from("coa").select("code,name"),
    supabase.from("budget69_imports").select("year_month"),
    supabase.from("outsource_imports").select("year_month,imported_at,source_file,expenses_written"),
    supabase.from("monthly_revenue").select("year_month,amount").eq("revenue_type", "other").in("year_month", yms),
  ]);
  for (const r of [coaRes, b69Res, outRes, otherRes]) if (r.error) return { ok: false, error: r.error.message };
  const nameOf = new Map((coaRes.data ?? []).map((c) => [c.code as string, c.name as string]));
  const owned = new Set((b69Res.data ?? []).map((r) => r.year_month as string));
  const previous = new Map((outRes.data ?? []).map((r) => [r.year_month as string, r]));
  const stored = new Map((otherRes.data ?? []).map((r) => [r.year_month as string, Number(r.amount)]));

  const months: OutsourceMonthPreview[] = parsedFile.months.map((m) => {
    const budget69Owned = owned.has(m.yearMonth);
    const { projection: p, blocks } = projectOutsourceMonth(m, appByMonth.get(m.yearMonth) ?? new Map(), budget69Owned);
    const prev = previous.get(m.yearMonth);
    return {
      yearMonth: m.yearMonth,
      firstRow: m.firstRow,
      lastRow: m.lastRow,
      budget69Owned,
      beforeLedger: m.yearMonth < LEDGER_START,
      entries: p.entries.map((e) => ({ ...e, coa_name: nameOf.get(e.coa_code) ?? "?" })),
      notImported: p.notImported,
      other: m.other,
      storedOther: stored.get(m.yearMonth) ?? null,
      blockTotal: p.blockTotal,
      writtenTotal: p.writtenTotal,
      total: p.total,
      cashTotal: p.cashTotal,
      blocks,
      previousImport: prev
        ? { importedAt: prev.imported_at as string, sourceFile: (prev.source_file as string) ?? null, expensesWritten: Boolean(prev.expenses_written) }
        : null,
    };
  });

  return { ok: true, file: parsedFile, preview: { fileName: file.name, expenseSheet: parsedFile.expenseSheet, months, blocks: [] } };
}

export async function previewOutsourceImport(formData: FormData): Promise<OutsourcePreviewResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด" };
  const built = await build(file);
  return built.ok ? { ok: true, preview: built.preview } : built;
}

/**
 * Write one month atomically from a SERVER-SIDE re-parse. The client echoes
 * the month, the block total and `other` it was shown; a different file, or
 * an edited one, is refused rather than written under the old preview.
 */
export async function applyOutsourceImport(formData: FormData): Promise<OutsourceApplyResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์ที่อัปโหลด" };
  const yearMonth = String(formData.get("yearMonth") ?? "");
  const expectedBlockTotal = Number(formData.get("expectedBlockTotal") ?? NaN);
  const expectedOther = Number(formData.get("expectedOther") ?? NaN);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) return { ok: false, error: `เดือนไม่ถูกต้อง: ${yearMonth}` };

  const built = await build(file);
  if (!built.ok) return built;
  const m = built.preview.months.find((x) => x.yearMonth === yearMonth);
  if (!m) return { ok: false, error: `ไฟล์นี้ไม่มีเดือน ${yearMonth}` };
  if (m.beforeLedger) return { ok: false, error: `เดือน ${yearMonth} อยู่ก่อนที่ระบบเริ่มบันทึก (${LEDGER_START}) — ข้ามตามที่ตกลง` };
  // THE STOP, server-side too.
  if (m.blocks.length > 0) return { ok: false, error: "เดือนนี้ยังไม่ผ่านการตรวจสอบ — กรุณาอ่านไฟล์ใหม่และดูข้อความที่ค้าง" };
  if ("missing" in m.other) return { ok: false, error: m.other.missing };
  if (Math.abs(m.blockTotal - expectedBlockTotal) > 1 || Math.abs(m.other.value - expectedOther) > 0.005) {
    return {
      ok: false,
      error:
        `ไฟล์ที่ยืนยันกับไฟล์ที่ส่งมาไม่ตรงกัน (อ่านได้ ${m.blockTotal} / รายได้อื่นๆ ${m.other.value} ` +
        `แต่หน้าจอยืนยัน ${expectedBlockTotal} / ${expectedOther}) — กรุณาอ่านไฟล์ใหม่แล้วยืนยันอีกครั้ง`,
    };
  }

  const entries = m.entries.map((e) => ({
    coa_code: e.coa_code,
    amount: e.amount,
    note:
      `ไฟล์บัญชี ${yearMonth} · ${e.rows.map((r) => `${r.label} แถว ${r.row}`).join(" + ")}` +
      (e.cashTwin ? ` (จ่ายสดรายวัน ${e.cashTwin.value} มีในระบบแล้ว ไม่รวมในยอดนี้)` : ""),
  }));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_outsource_month", {
    p_year_month: yearMonth,
    p_entries: entries,
    p_other: m.other.value,
    p_source_file: built.preview.fileName,
    p_block_total: m.blockTotal,
  });
  if (error) return { ok: false, error: error.message };
  const r = (data ?? {}) as Record<string, unknown>;

  revalidatePath("/owner/accounting/import");
  revalidatePath("/owner/accounting/summary");
  revalidatePath("/owner/accounting/daily");
  revalidatePath("/owner/accounting");
  return {
    ok: true,
    yearMonth,
    inserted: Number(r.inserted ?? 0),
    deleted: Number(r.deleted ?? 0),
    other: Number(r.other ?? m.other.value),
    wasReimport: Boolean(r.was_reimport),
    budget69Owned: Boolean(r.budget69_owned),
  };
}
