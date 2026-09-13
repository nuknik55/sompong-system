"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireAdminOrEditor } from "@/lib/auth";
import { savePendingChange } from "@/lib/pending-data";
import { createClient } from "@/lib/supabase/server";

// ── Item 12: expected failures are RETURNED, not thrown ─────────────────────
// Production redacts a thrown Server Action message, so the Thai text below
// never reached the user — they saw the RSC boilerplate instead. The text was
// right; hiding it was the defect. Auth throws (requireAdmin/...) stay: they
// are not messages for the user. Truly unexpected exceptions (network, bugs)
// also still throw — redaction is CORRECT for those.
export type MenuActionResult = { status: "ok" } | { status: "error"; message: string };
/** "pending" replaces the old "__pending__" magic-string id — same flow,
 *  now a typed state instead of an id that must never be navigated to. */
export type MenuCreateResult = { status: "ok"; id: string } | { status: "pending" } | { status: "error"; message: string };

/**
 * KEEPS ITS THROW, deliberately — the one exception in this file. Its only
 * caller is a server-component <form action={...bind()}> (staff/menu/[id]),
 * which has no channel to display a returned value: converting this one
 * would turn a visible (if redacted) failure into a SILENT one. If that form
 * ever becomes a client island with useActionState, convert this too.
 */
export async function toggleMenuStaffVisible(menuId: string, visible: boolean) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("menus").update({ staff_visible: visible }).eq("id", menuId);
  if (error) throw new Error(error.message);
  revalidatePath(`/staff/menu/${menuId}`);
  revalidatePath("/staff");
}

// Selling price changes are admin-only — too financially sensitive for pending flow
export async function updateMenuSellingPrice(menuId: string, sellingPrice: number): Promise<MenuActionResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("menus").update({ selling_price: sellingPrice }).eq("id", menuId);
  if (error) return { status: "error", message: error.message };
  revalidatePath(`/staff/menu/${menuId}`);
  return { status: "ok" };
}

export async function createMenu(name: string, category: string, sellingPrice: number): Promise<MenuCreateResult> {
  const profile = await requireAdminOrEditor();
  if (!name.trim()) return { status: "error", message: "กรุณาใส่ชื่อเมนู" };

  if (profile.role === "editor") {
    await savePendingChange(profile.id, "menu_create", `new:${name.trim()}`, {
      name: name.trim(),
      category: category.trim() || null,
      sellingPrice,
    });
    return { status: "pending" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("menus")
    .insert({ name: name.trim(), category: category.trim() || null, selling_price: sellingPrice })
    .select("id")
    .single();
  if (error || !data) return { status: "error", message: error?.message ?? "สร้างเมนูไม่สำเร็จ" };
  revalidatePath("/staff", "layout");
  return { status: "ok", id: data.id };
}

export async function duplicateMenu(menuId: string, newName: string, newCategory: string): Promise<MenuCreateResult> {
  const profile = await requireAdminOrEditor();
  if (!newName.trim()) return { status: "error", message: "กรุณาใส่ชื่อเมนูใหม่" };

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
    return { status: "pending" };
  }

  const supabase = await createClient();
  const { data: original, error: fetchError } = await supabase.from("menus").select("*").eq("id", menuId).single();
  if (fetchError || !original) return { status: "error", message: fetchError?.message ?? "ไม่พบเมนูต้นฉบับ" };

  const { data: newMenu, error: insertError } = await supabase
    .from("menus")
    .insert({ name: newName.trim(), category: newCategory.trim() || null, selling_price: original.selling_price, last_period_qty_sold: 0 })
    .select("id")
    .single();
  if (insertError || !newMenu) return { status: "error", message: insertError?.message ?? "คัดลอกเมนูไม่สำเร็จ" };

  const { data: items, error: itemsError } = await supabase.from("menu_recipe_items").select("ingredient_id, quantity, unit, sort_order").eq("menu_id", menuId);
  if (itemsError) return { status: "error", message: itemsError.message };
  if (items && items.length > 0) {
    // Checked: a silent failure here produced a copied menu with ZERO recipe
    // items, whose food cost then computes as 0 — a costing error that looks
    // like a successful duplicate.
    const { error } = await supabase.from("menu_recipe_items").insert(items.map((it) => ({ ...it, menu_id: newMenu.id })));
    if (error) return { status: "error", message: error.message };
  }
  return { status: "ok", id: newMenu.id };
}

export async function deleteMenu(menuId: string): Promise<MenuActionResult> {
  const profile = await requireAdminOrEditor();
  const supabase = await createClient();

  if (profile.role === "editor") {
    const { data: menu } = await supabase.from("menus").select("name").eq("id", menuId).single();
    await savePendingChange(profile.id, "menu_delete", menuId, {
      menuId,
      menuName: menu?.name ?? menuId,
    });
    return { status: "ok" };
  }

  const { error } = await supabase.from("menus").delete().eq("id", menuId);
  if (error) return { status: "error", message: error.message };
  return { status: "ok" };
}
