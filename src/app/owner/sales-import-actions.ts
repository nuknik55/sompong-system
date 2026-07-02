"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePosSalesReport } from "@/lib/pos-import";

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
};

export async function previewPosSalesImport(formData: FormData): Promise<SalesImportPreview> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("ไม่พบไฟล์ที่อัปโหลด");

  const buffer = await file.arrayBuffer();
  const parsed = parsePosSalesReport(buffer);
  if (parsed.length === 0) {
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

  for (const row of parsed) {
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
  return { matched, unmatched };
}

export async function applyPosSalesImport(updates: { menuId: string; newQty: number }[]): Promise<number> {
  await requireOwner();
  if (updates.length === 0) return 0;
  const supabase = await createClient();

  for (const u of updates) {
    const { error } = await supabase.from("menus").update({ last_period_qty_sold: u.newQty }).eq("id", u.menuId);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/owner");
  return updates.length;
}

export type PosSalesAlias = {
  id: string;
  posProductName: string;
  menuId: string;
  menuName: string;
  divisor: number;
};

export async function listPosSalesAliases(): Promise<PosSalesAlias[]> {
  await requireOwner();
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
  await requireOwner();
  if (!posProductName.trim() || !menuId) throw new Error("กรุณากรอกชื่อสินค้า POS และเลือกเมนู");
  const supabase = await createClient();
  const { error } = await supabase
    .from("pos_sales_aliases")
    .upsert({ pos_product_name: posProductName.trim(), menu_id: menuId, divisor: divisor || 1 }, { onConflict: "pos_product_name" });
  if (error) throw new Error(error.message);
  revalidatePath("/owner");
}

export async function deletePosSalesAlias(id: string) {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.from("pos_sales_aliases").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/owner");
}
