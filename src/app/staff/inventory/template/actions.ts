"use server";

import { requireAdminOrEditor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { TemplateItem } from "@/lib/inventory-data";

// THE SIGNED-IN USER'S OWN CLIENT, not the service key (audit, 2026-09-25).
// These seven actions were the last table writes through the service key,
// the shape แจ้งซ่อม had: the app guard was the only barrier, the database's
// own write rules for templates were never read, and no write recorded who
// made it. The table policies (owner/admin/editor, from
// security_fixes_and_menu_save_lock_migration.sql) now decide as well, every
// write is counted (0 rows is a refusal, never success), and a new template
// records its creator. THIS NEEDS THAT MIGRATION FIRST: before it, the
// live write policies are unknown and may refuse an editor.
const REFUSED = "ไม่มีสิทธิ์แก้ไขเทมเพลตนี้ หรือไม่พบรายการ — โหลดหน้าใหม่แล้วลองอีกครั้ง";

const ITEM_SELECT = `
  id, template_id, ingredient_id, order_unit, default_qty,
  kitchen_unit, freezer_unit, custom_group, sort_order,
  ingredients(name, category, usage_unit, purchase_unit_label)
` as const;

type IngRef = { name: string; category: string | null; usage_unit: string | null; purchase_unit_label: string | null };
type RawItem = {
  id: string; template_id: string; ingredient_id: string;
  order_unit: string | null; default_qty: number | null;
  kitchen_unit: string | null; freezer_unit: string | null;
  custom_group: string | null; sort_order: number;
  ingredients: IngRef | IngRef[] | null;
};

function mapItem(r: RawItem): TemplateItem {
  const ing = r.ingredients
    ? Array.isArray(r.ingredients) ? r.ingredients[0] ?? null : r.ingredients
    : null;
  return {
    id: r.id,
    templateId: r.template_id,
    ingredientId: r.ingredient_id,
    ingredientName: ing?.name ?? "",
    ingredientCategory: ing?.category ?? null,
    customGroup: r.custom_group,
    orderUnit: r.order_unit,
    defaultQty: r.default_qty,
    kitchenUnit: r.kitchen_unit,
    freezerUnit: r.freezer_unit,
    sortOrder: r.sort_order,
    usageUnit: ing?.usage_unit ?? null,
    purchaseUnitLabel: ing?.purchase_unit_label ?? null,
  };
}

export async function createTemplate(name: string): Promise<{ error?: string; id?: string }> {
  const profile = await requireAdminOrEditor();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("templates")
    .insert({ name: name.trim(), created_by: profile.id })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory/template");
  return { id: data.id };
}

export async function renameTemplate(id: string, name: string): Promise<{ error?: string }> {
  await requireAdminOrEditor();
  const supabase = await createClient();
  const { error, count } = await supabase.from("templates").update({ name: name.trim() }, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: REFUSED };
  revalidatePath("/staff/inventory/template");
  return {};
}

export async function deleteTemplate(id: string): Promise<{ error?: string }> {
  await requireAdminOrEditor();
  const supabase = await createClient();
  const { error, count } = await supabase.from("templates").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: REFUSED };
  revalidatePath("/staff/inventory/template");
  return {};
}

export async function addItemsToTemplate(
  templateId: string,
  ingredientIds: string[]
): Promise<{ error?: string; items?: TemplateItem[] }> {
  await requireAdminOrEditor();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("template_items")
    .select("sort_order")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: false })
    .limit(1);
  let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const rows = ingredientIds.map((ingredient_id) => ({
    template_id: templateId,
    ingredient_id,
    sort_order: nextOrder++,
  }));

  const { error } = await supabase
    .from("template_items")
    .upsert(rows, { onConflict: "template_id,ingredient_id", ignoreDuplicates: true });
  if (error) return { error: error.message };

  const { data, error: fetchErr } = await supabase
    .from("template_items")
    .select(ITEM_SELECT)
    .eq("template_id", templateId)
    .in("ingredient_id", ingredientIds)
    .order("sort_order");
  if (fetchErr) return { error: fetchErr.message };

  return { items: ((data ?? []) as unknown as RawItem[]).map(mapItem) };
}

export async function removeItemsFromTemplate(ids: string[]): Promise<{ error?: string }> {
  await requireAdminOrEditor();
  const supabase = await createClient();
  const { error, count } = await supabase.from("template_items").delete({ count: "exact" }).in("id", ids);
  if (error) return { error: error.message };
  if (ids.length > 0 && !count) return { error: REFUSED };
  return {};
}

export async function updateTemplateItem(
  id: string,
  fields: {
    order_unit?: string | null;
    default_qty?: number | null;
    kitchen_unit?: string | null;
    freezer_unit?: string | null;
  }
): Promise<{ error?: string }> {
  await requireAdminOrEditor();
  const supabase = await createClient();
  // Only the four columns the screen edits: `fields` comes from the caller,
  // and a direct call could otherwise move a line to another template or
  // ingredient (audit, 2026-09-25).
  const allowed: Record<string, string | number | null> = {};
  for (const k of ["order_unit", "default_qty", "kitchen_unit", "freezer_unit"] as const) {
    if (k in fields) allowed[k] = fields[k] ?? null;
  }
  if (Object.keys(allowed).length === 0) return {};
  const { error, count } = await supabase.from("template_items").update(allowed, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (!count) return { error: REFUSED };
  return {};
}

export async function reorderTemplateItems(
  updates: { id: string; sort_order: number }[]
): Promise<{ error?: string }> {
  await requireAdminOrEditor();
  const supabase = await createClient();
  // N writes, not atomic. Recoverable though: each sort_order is an absolute
  // assignment from a complete ordering, so re-running the same reorder repairs
  // a half-application. Reporting the failure is what makes that retry happen.
  for (const { id, sort_order } of updates) {
    const { error, count } = await supabase.from("template_items").update({ sort_order }, { count: "exact" }).eq("id", id);
    if (error) return { error: error.message };
    if (!count) return { error: REFUSED };
  }
  return {};
}
