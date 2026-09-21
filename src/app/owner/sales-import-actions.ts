"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePosSalesReport } from "@/lib/pos-parse";
import { movedSinceRead, routeSales, sourcesQty, validDivisor, type SalesSource } from "@/lib/pos-sales-divisor";

export type SalesImportRow = {
  menuId: string;
  name: string;
  oldQty: number;
  newQty: number;
  netRevenue: number;
  /** Every POS name that fed this row, with the divisor it was counted by. */
  sources: SalesSource[];
};

export type SalesImportPreview = {
  matched: SalesImportRow[];
  unmatched: { productName: string; qtySold: number }[];
  dateFrom: string;
  dateTo: string;
};

// ── Item 12: expected failures are RETURNED, not thrown ─────────────────────
// Same rule as pos-import-actions.ts. NOTE: parsePosSalesReport itself may
// still throw on a malformed file — that stays a throw and lands in the
// client catch as before; its messages belong to the parser layer, not this
// file.
export type SalesImportActionResult = { status: "ok" } | { status: "error"; message: string };

export async function previewPosSalesImport(formData: FormData): Promise<{ status: "ok"; preview: SalesImportPreview } | { status: "error"; message: string }> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) return { status: "error", message: "ไม่พบไฟล์ที่อัปโหลด" };

  const buffer = await file.arrayBuffer();
  const report = parsePosSalesReport(buffer);
  if (report.rows.length === 0) {
    return { status: "error", message: 'อ่านไฟล์ไม่พบรายการขายเลย ตรวจสอบว่าเป็นไฟล์ "รายงานการขายตามสินค้า" ที่ export มาจาก POS หรือไม่' };
  }

  const supabase = await createClient();
  const [{ data: menus, error: menusError }, { data: aliases, error: aliasError }] = await Promise.all([
    supabase.from("menus").select("id, name, last_period_qty_sold"),
    supabase.from("pos_sales_aliases").select("pos_product_name, menu_id, divisor"),
  ]);
  if (menusError) return { status: "error", message: menusError.message };
  if (aliasError) return { status: "error", message: aliasError.message };

  const menuById = new Map((menus ?? []).map((m) => [m.id, m]));

  // Every POS name routed to its menu with its own divisor (routeSales in
  // pos-sales-divisor.ts, where the rule is tested): a direct-name match and
  // any aliased variants (e.g. a weight-counted SKU) combine into one row,
  // and the screen can show each divisor in effect and divide only a name
  // that has none.
  const { byMenu: totals, unmatched } = routeSales(report.rows, aliases ?? [], menus ?? []);

  const matched: SalesImportRow[] = Array.from(totals.entries()).map(([menuId, v]) => {
    const menu = menuById.get(menuId)!;
    return {
      menuId,
      name: menu.name,
      oldQty: menu.last_period_qty_sold,
      newQty: sourcesQty(v.sources),
      netRevenue: v.netRevenue,
      sources: v.sources,
    };
  });

  matched.sort((a, b) => b.newQty - a.newQty);
  unmatched.sort((a, b) => b.qtySold - a.qtySold);
  return { status: "ok", preview: { matched, unmatched, dateFrom: report.dateFrom, dateTo: report.dateTo } };
}

export async function applyPosSalesImport(
  updates: { menuId: string; newQty: number }[],
  dateFrom: string,
  dateTo: string,
  posRows: { productName: string; qtySold: number }[],
): Promise<{ status: "ok"; count: number } | { status: "error"; message: string }> {
  await requireAdmin();
  if (updates.length === 0) return { status: "ok", count: 0 };
  if (!Array.isArray(posRows) || posRows.length > 5000
      || posRows.some((r) => typeof r?.productName !== "string" || !Number.isFinite(r?.qtySold))) {
    return { status: "error", message: "ข้อมูลไฟล์ไม่ถูกต้อง — กด อ่านไฟล์ อีกครั้ง" };
  }
  const supabase = await createClient();

  // THE DIVISORS MAY HAVE CHANGED SINCE THE PREVIEW WAS READ — edited on
  // /owner/pos-divisors in another tab, or by another admin. The figures were
  // computed with the divisors of that moment, so route the file's own POS
  // rows again against the divisors as they are NOW, and refuse on any
  // difference, before anything is reset. Nothing is written on a refusal.
  const [{ data: menusNow, error: menusNowError }, { data: aliasesNow, error: aliasesNowError }] = await Promise.all([
    supabase.from("menus").select("id, name"),
    supabase.from("pos_sales_aliases").select("pos_product_name, menu_id, divisor"),
  ]);
  if (menusNowError) return { status: "error", message: menusNowError.message };
  if (aliasesNowError) return { status: "error", message: aliasesNowError.message };
  const moved = movedSinceRead(updates, posRows, aliasesNow ?? [], menusNow ?? []);
  if (moved.length > 0) {
    return {
      status: "error",
      message: `ตัวหารเปลี่ยนไปหลังจากอ่านไฟล์ (${moved.length} เมนู) — กด อ่านไฟล์ อีกครั้ง แล้วยืนยันใหม่ ยังไม่ได้บันทึกอะไร`,
    };
  }

  // Reset ALL menus to 0 first — this is replace-mode, not accumulate-mode.
  const { error: resetError } = await supabase
    .from("menus")
    .update({ last_period_qty_sold: 0 })
    .neq("id", "00000000-0000-0000-0000-000000000000"); // match all rows
  if (resetError) return { status: "error", message: resetError.message };

  for (const u of updates) {
    const { error } = await supabase.from("menus").update({ last_period_qty_sold: u.newQty }).eq("id", u.menuId);
    if (error) return { status: "error", message: error.message };
  }

  // Store import date range metadata (single row, upserted on fixed key).
  const { error: metaError } = await supabase
    .from("pos_import_meta")
    .upsert({ id: "last", date_from: dateFrom || null, date_to: dateTo || null, imported_at: new Date().toISOString() }, { onConflict: "id" });
  if (metaError) return { status: "error", message: metaError.message };

  revalidatePath("/owner");
  return { status: "ok", count: updates.length };
}

export async function getPosImportMeta(): Promise<{ dateFrom: string; dateTo: string; importedAt: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("pos_import_meta").select("date_from, date_to, imported_at").eq("id", "last").maybeSingle();
  if (!data) return null;
  return { dateFrom: data.date_from ?? "", dateTo: data.date_to ?? "", importedAt: data.imported_at ?? "" };
}

// ── Divisors (pos_sales_aliases) ─────────────────────────────────────────────
// CREATED from the import (หาร on a name with none, ผูกเข้าเมนู on a name that
// matched nothing), EDITED and DELETED only on /owner/pos-divisors. Creating
// never overwrites: it used to be an upsert, so a หาร pressed on a name that
// already had its divisor replaced it without a word (Nik, 2026-09-21).

const DIVISOR_TAKEN = "23505";
const BAD_DIVISOR = "ตัวหารต้องอยู่ระหว่าง 0.0001 ถึง 1,000";

export async function createPosSalesAlias(posProductName: string, menuId: string, divisor: number): Promise<SalesImportActionResult> {
  await requireAdmin();
  const name = posProductName.trim();
  if (!name || !menuId) return { status: "error", message: "กรุณากรอกชื่อสินค้า POS และเลือกเมนู" };
  const d = validDivisor(divisor);
  if (d == null) return { status: "error", message: BAD_DIVISOR };
  const supabase = await createClient();
  const { error } = await supabase.from("pos_sales_aliases").insert({ pos_product_name: name, menu_id: menuId, divisor: d });
  if (error) {
    if (error.code === DIVISOR_TAKEN) return { status: "error", message: `"${name}" มีตัวหารอยู่แล้ว — แก้ได้ที่หน้า ตัวหารยอดขาย POS` };
    return { status: "error", message: error.message };
  }
  revalidatePath("/owner");
  revalidatePath("/owner/pos-divisors");
  return { status: "ok" };
}

/** The row as the page loaded it: an edit or delete applies only if it is still that. */
export type DivisorLoaded = { menuId: string; divisor: number };
const CHANGED_ELSEWHERE = "ตัวหารนี้ถูกแก้หรือลบจากที่อื่นหลังจากเปิดหน้านี้ — โหลดหน้าใหม่แล้วลองอีกครั้ง";

export async function updatePosSalesAlias(id: string, menuId: string, divisor: number, loaded: DivisorLoaded): Promise<SalesImportActionResult> {
  await requireAdmin();
  if (!id) return { status: "error", message: "ไม่พบตัวหารนี้" };
  if (!menuId) return { status: "error", message: "กรุณาเลือกเมนู" };
  const d = validDivisor(divisor);
  if (d == null) return { status: "error", message: BAD_DIVISOR };
  const supabase = await createClient();
  // Matched on the values the page loaded as well as the id, so an edit made
  // in another tab since is not silently overwritten. .select() so a row that
  // is gone, changed, or that RLS would not let this account write comes back
  // as zero rows instead of a silent success.
  const { data, error } = await supabase
    .from("pos_sales_aliases")
    .update({ menu_id: menuId, divisor: d })
    .eq("id", id)
    .eq("menu_id", loaded.menuId)
    .eq("divisor", loaded.divisor)
    .select("id");
  if (error) return { status: "error", message: error.message };
  if (!data || data.length === 0) return { status: "error", message: CHANGED_ELSEWHERE };
  revalidatePath("/owner");
  revalidatePath("/owner/pos-divisors");
  return { status: "ok" };
}

export async function deletePosSalesAlias(id: string, loaded: DivisorLoaded): Promise<SalesImportActionResult> {
  await requireAdmin();
  if (!id) return { status: "error", message: "ไม่พบตัวหารนี้" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pos_sales_aliases")
    .delete()
    .eq("id", id)
    .eq("menu_id", loaded.menuId)
    .eq("divisor", loaded.divisor)
    .select("id");
  if (error) return { status: "error", message: error.message };
  if (!data || data.length === 0) return { status: "error", message: CHANGED_ELSEWHERE };
  revalidatePath("/owner");
  revalidatePath("/owner/pos-divisors");
  return { status: "ok" };
}

