"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireAdminOrEditor, requireOwner } from "@/lib/auth";
import { savePendingChange } from "@/lib/pending-data";
import { createClient } from "@/lib/supabase/server";

export async function toggleMenuStaffVisible(menuId: string, visible: boolean) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("menus").update({ staff_visible: visible }).eq("id", menuId);
  if (error) throw new Error(error.message);
  revalidatePath(`/staff/menu/${menuId}`);
  revalidatePath("/staff");
}

// Selling price changes are admin-only — too financially sensitive for pending flow
export async function updateMenuSellingPrice(menuId: string, sellingPrice: number) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("menus").update({ selling_price: sellingPrice }).eq("id", menuId);
  if (error) throw new Error(error.message);
  revalidatePath(`/staff/menu/${menuId}`);
}

// Returns the new menu's ID (admin) or "__pending__" sentinel (editor)
export async function createMenu(name: string, category: string, sellingPrice: number): Promise<string> {
  const profile = await requireAdminOrEditor();
  if (!name.trim()) throw new Error("กรุณาใส่ชื่อเมนู");

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "menu_create", `new:${name.trim()}`, {
      name: name.trim(),
      category: category.trim() || null,
      sellingPrice,
    });
    return "__pending__";
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menus")
    .insert({ name: name.trim(), category: category.trim() || null, selling_price: sellingPrice, fuel_cost: 0 })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "สร้างเมนูไม่สำเร็จ");
  return data.id;
}

export async function duplicateMenu(menuId: string, newName: string, newCategory: string): Promise<string> {
  const profile = await requireAdminOrEditor();
  if (!newName.trim()) throw new Error("กรุณาใส่ชื่อเมนูใหม่");

  if (profile.role === "editor") {
    // For editors, duplicating is treated as a create request
    const supabase = await createClient();
    const { data: original } = await supabase.from("menus").select("selling_price").eq("id", menuId).single();
    await savePendingChange(profile.id, "menu_create", `dup:${menuId}`, {
      name: newName.trim(),
      category: newCategory.trim() || null,
      sellingPrice: original?.selling_price ?? 0,
      duplicatedFrom: menuId,
    });
    return "__pending__";
  }

  const supabase = await createClient();
  const { data: original, error: fetchError } = await supabase.from("menus").select("*").eq("id", menuId).single();
  if (fetchError || !original) throw new Error(fetchError?.message ?? "ไม่พบเมนูต้นฉบับ");

  const { data: newMenu, error: insertError } = await supabase
    .from("menus")
    .insert({ name: newName.trim(), category: newCategory.trim() || null, selling_price: original.selling_price, fuel_cost: original.fuel_cost, last_period_qty_sold: 0 })
    .select("id")
    .single();
  if (insertError || !newMenu) throw new Error(insertError?.message ?? "คัดลอกเมนูไม่สำเร็จ");

  const { data: items } = await supabase.from("menu_recipe_items").select("ingredient_id, quantity, unit, sort_order").eq("menu_id", menuId);
  if (items && items.length > 0) {
    await supabase.from("menu_recipe_items").insert(items.map((it) => ({ ...it, menu_id: newMenu.id })));
  }
  return newMenu.id;
}

export async function deleteMenu(menuId: string) {
  const profile = await requireAdminOrEditor();
  const supabase = await createClient();

  if (profile.role === "editor") {
    const { data: menu } = await supabase.from("menus").select("name").eq("id", menuId).single();
    await savePendingChange(profile.id, "menu_delete", menuId, {
      menuId,
      menuName: menu?.name ?? menuId,
    });
    return;
  }

  const { error } = await supabase.from("menus").delete().eq("id", menuId);
  if (error) throw new Error(error.message);
}
