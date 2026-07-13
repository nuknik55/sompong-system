"use server";

import { requireAdminOrEditor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import type { TemplateItem } from "@/lib/inventory-data";

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
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("templates")
    .insert({ name: name.trim() })
    .select("id")
    .single();
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory/template");
  return { id: data.id };
}

export async function renameTemplate(id: string, name: string): Promise<{ error?: string }> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const { error } = await supabase.from("templates").update({ name: name.trim() }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory/template");
  return {};
}

export async function deleteTemplate(id: string): Promise<{ error?: string }> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/staff/inventory/template");
  return {};
}

export async function addItemsToTemplate(
  templateId: string,
  ingredientIds: string[]
): Promise<{ error?: string; items?: TemplateItem[] }> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();

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
  const supabase = createAdminClient();
  const { error } = await supabase.from("template_items").delete().in("id", ids);
  if (error) return { error: error.message };
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
  const supabase = createAdminClient();
  const { error } = await supabase.from("template_items").update(fields).eq("id", id);
  if (error) return { error: error.message };
  return {};
}

export async function reorderTemplateItems(
  updates: { id: string; sort_order: number }[]
): Promise<{ error?: string }> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  for (const { id, sort_order } of updates) {
    await supabase.from("template_items").update({ sort_order }).eq("id", id);
  }
  return {};
}
