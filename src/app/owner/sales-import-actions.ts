"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePosSalesReport } from "@/lib/pos-parse";

export type SalesImportRow = {
  menuId: string;
  name: string;
  oldQty: number;
  newQty: number;
  netRevenue: number;
};

export type SalesImportPreview = {
  matched: SalesImportRow[];
  unmatched: { productName: string; qtySold: number }[];
  dateFrom: string;
  dateTo: string;
};

export async function previewPosSalesImport(formData: FormData): Promise<SalesImportPreview> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("ไม่พบไฟล์ที่อัปโหลด");

  const buffer = await file.arrayBuffer();
  const report = parsePosSalesReport(buffer);
  if (report.rows.length === 0) {
    throw new Error('อ่านไฟล์ไม่พบรายการขายเลย ตรวจสอบว่าเป็นไฟล์ "รายงานการขายตามสินค้า" ที่ export มาจาก POS หรือไม่');
  }

  const supabase = await createClient();
  const [{ data: menus, error: menusError }, { data: aliases, error: aliasError }] = await Promise.all([
    supabase.from("menus").select("id, name, last_period_qty_sold"),
    supabase.from("pos_sales_aliases").select("pos_product_name, menu_id, divisor"),
  ]);
  if (menusError) throw new Error(menusError.message);
  if (aliasError) throw new Error(aliasError.message);

  const menuById = new Map((menus ?? []).map((m) => [m.id, m]));
  const menuByName = new Map((menus ?? []).map((m) => [m.name.trim(), m]));
  const aliasByProductName = new Map((aliases ?? []).map((a) => [a.pos_product_name.trim(), a]));

  // Accumulate by target menu so a direct-name match and any aliased
  // variants (e.g. a weight-counted SKU) combine into one total.
  const totals = new Map<string, { qty: number; netRevenue: number }>();
  const unmatched: { productName: string; qtySold: number }[] = [];

  for (const row of report.rows) {
    const name = row.productName.trim();
    const alias = aliasByProductName.get(name);
    const directMenu = menuByName.get(name);

    if (alias && menuById.has(alias.menu_id)) {
      const divisor = alias.divisor || 1;
      const entry = totals.get(alias.menu_id) ?? { qty: 0, netRevenue: 0 };
      entry.qty += row.qtySold / divisor;
      entry.netRevenue += row.netRevenue;
      totals.set(alias.menu_id, entry);
    } else if (directMenu) {
      const entry = totals.get(directMenu.id) ?? { qty: 0, netRevenue: 0 };
      entry.qty += row.qtySold;
      entry.netRevenue += row.netRevenue;
      totals.set(directMenu.id, entry);
    } else {
      unmatched.push({ productName: row.productName, qtySold: row.qtySold });
    }
  }

  const matched: SalesImportRow[] = Array.from(totals.entries()).map(([menuId, v]) => {
    const menu = menuById.get(menuId)!;
    return {
      menuId,
      name: menu.name,
      oldQty: menu.last_period_qty_sold,
      newQty: Math.round(v.qty * 100) / 100,
      netRevenue: v.netRevenue,
    };
  });

  matched.sort((a, b) => b.newQty - a.newQty);
  unmatched.sort((a, b) => b.qtySold - a.qtySold);
  return { matched, unmatched, dateFrom: report.dateFrom, dateTo: report.dateTo };
}

export async function applyPosSalesImport(
  updates: { menuId: string; newQty: number }[],
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  await requireAdmin();
  if (updates.length === 0) return 0;
  const supabase = await createClient();

  // Reset ALL menus to 0 first — this is replace-mode, not accumulate-mode.
  const { error: resetError } = await supabase
    .from("menus")
    .update({ last_period_qty_sold: 0 })
    .neq("id", "00000000-0000-0000-0000-000000000000"); // match all rows
  if (resetError) throw new Error(resetError.message);

  for (const u of updates) {
    const { error } = await supabase.from("menus").update({ last_period_qty_sold: u.newQty }).eq("id", u.menuId);
    if (error) throw new Error(error.message);
  }

  // Store import date range metadata (single row, upserted on fixed key).
  const { error: metaError } = await supabase
    .from("pos_import_meta")
    .upsert({ id: "last", date_from: dateFrom || null, date_to: dateTo || null, imported_at: new Date().toISOString() }, { onConflict: "id" });
  if (metaError) throw new Error(metaError.message);

  revalidatePath("/owner");
  return updates.length;
}

export async function getPosImportMeta(): Promise<{ dateFrom: string; dateTo: string; importedAt: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("pos_import_meta").select("date_from, date_to, imported_at").eq("id", "last").maybeSingle();
  if (!data) return null;
  return { dateFrom: data.date_from ?? "", dateTo: data.date_to ?? "", importedAt: data.imported_at ?? "" };
}

export type PosSalesAlias = {
  id: string;
  posProductName: string;
  menuId: string;
  menuName: string;
  divisor: number;
};

export async function listPosSalesAliases(): Promise<PosSalesAlias[]> {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pos_sales_aliases")
    .select("id, pos_product_name, divisor, menu_id, menus(name)")
    .order("pos_product_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id,
    posProductName: r.pos_product_name,
    menuId: r.menu_id,
    menuName: (r.menus as unknown as { name: string } | null)?.name ?? "?",
    divisor: r.divisor,
  }));
}

export async function upsertPosSalesAlias(posProductName: string, menuId: string, divisor: number) {
  await requireAdmin();
  if (!posProductName.trim() || !menuId) throw new Error("กรุณากรอกชื่อสินค้า POS และเลือกเมนู");
  const supabase = await createClient();
  const { error } = await supabase
    .from("pos_sales_aliases")
    .upsert({ pos_product_name: posProductName.trim(), menu_id: menuId, divisor: divisor || 1 }, { onConflict: "pos_product_name" });
  if (error) throw new Error(error.message);
  revalidatePath("/owner");
}

export async function deletePosSalesAlias(id: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("pos_sales_aliases").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner");
}
