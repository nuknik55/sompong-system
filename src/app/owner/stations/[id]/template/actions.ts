"use server";

import { requireAdminOrEditor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StationTemplateRow } from "@/lib/inventory-data";

export type ActionResult = { error?: string };

type IngRef = { name: string; category: string | null; usage_unit: string | null; purchase_unit_label: string | null };
type RawSIRow = {
  id: string; station_id: string; ingredient_id: string;
  custom_group: string | null; custom_unit: string | null;
  default_qty: number | null; sort_order: number;
  kitchen_unit: string | null; freezer_unit: string | null;
  ingredients: IngRef | IngRef[] | null;
};

function mapRow(r: RawSIRow): StationTemplateRow {
  const ing = r.ingredients
    ? Array.isArray(r.ingredients) ? r.ingredients[0] ?? null : r.ingredients
    : null;
  return {
    id: r.id,
    stationId: r.station_id,
    ingredientId: r.ingredient_id,
    ingredientName: ing?.name ?? "",
    ingredientCategory: ing?.category ?? null,
    customGroup: r.custom_group,
    customUnit: r.custom_unit,
    defaultQty: r.default_qty,
    sortOrder: r.sort_order,
    usageUnit: ing?.usage_unit ?? null,
    purchaseUnitLabel: ing?.purchase_unit_label ?? null,
    kitchenUnit: r.kitchen_unit,
    freezerUnit: r.freezer_unit,
  };
}

const INGREDIENT_SELECT = `
  id, station_id, ingredient_id, custom_group, custom_unit, default_qty, sort_order, kitchen_unit, freezer_unit,
  ingredients(name, category, usage_unit, purchase_unit_label)
` as const;

export async function addToTemplate(
  stationId: string,
  ingredientIds: string[]
): Promise<{ error?: string; rows?: StationTemplateRow[] }> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from("station_ingredients")
    .select("sort_order")
    .eq("station_id", stationId)
    .order("sort_order", { ascending: false })
    .limit(1);
  let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const rows = ingredientIds.map((ingredient_id) => ({
    station_id: stationId,
    ingredient_id,
    sort_order: nextOrder++,
  }));

  const { error } = await supabase
    .from("station_ingredients")
    .upsert(rows, { onConflict: "station_id,ingredient_id", ignoreDuplicates: true });
  if (error) return { error: error.message };

  // Fetch the newly inserted rows so client can replace optimistic placeholders
  const { data, error: fetchErr } = await supabase
    .from("station_ingredients")
    .select(INGREDIENT_SELECT)
    .eq("station_id", stationId)
    .in("ingredient_id", ingredientIds)
    .order("sort_order");
  if (fetchErr) return { error: fetchErr.message };

  return { rows: ((data ?? []) as unknown as RawSIRow[]).map(mapRow) };
}

export async function removeFromTemplate(
  stationId: string,
  ids: string[]
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("station_ingredients")
    .delete()
    .in("id", ids);
  if (error) return { error: error.message };
  return {};
}

export async function updateTemplateRow(
  stationId: string,
  id: string,
  fields: {
    custom_group?: string | null;
    custom_unit?: string | null;
    default_qty?: number | null;
    kitchen_unit?: string | null;
    freezer_unit?: string | null;
  }
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("station_ingredients")
    .update(fields)
    .eq("id", id);
  if (error) return { error: error.message };
  return {};
}

export async function renameGroup(
  stationId: string,
  oldGroup: string | null,
  newGroup: string | null
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const query = supabase
    .from("station_ingredients")
    .update({ custom_group: newGroup || null })
    .eq("station_id", stationId);

  const { error } = oldGroup === null
    ? await query.is("custom_group", null)
    : await query.eq("custom_group", oldGroup);

  if (error) return { error: error.message };
  return {};
}

export async function reorderTemplateRows(
  stationId: string,
  updates: { id: string; sort_order: number }[]
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  for (const { id, sort_order } of updates) {
    await supabase.from("station_ingredients").update({ sort_order }).eq("id", id);
  }
  return {};
}

export async function bulkMoveGroup(
  stationId: string,
  ids: string[],
  newGroup: string | null
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("station_ingredients")
    .update({ custom_group: newGroup || null })
    .in("id", ids);
  if (error) return { error: error.message };
  return {};
}

export async function copyFromStation(
  toStationId: string,
  fromStationId: string
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();

  const { data: sourceRows, error: fetchErr } = await supabase
    .from("station_ingredients")
    .select("ingredient_id, custom_group, custom_unit, default_qty, sort_order, kitchen_unit, freezer_unit")
    .eq("station_id", fromStationId)
    .order("sort_order");
  if (fetchErr) return { error: fetchErr.message };
  if (!sourceRows?.length) return { error: "แผนกต้นทางไม่มีรายการ" };

  const rows = sourceRows.map((r) => ({
    station_id: toStationId,
    ingredient_id: r.ingredient_id,
    custom_group: r.custom_group,
    custom_unit: r.custom_unit,
    default_qty: r.default_qty,
    sort_order: r.sort_order,
    kitchen_unit: r.kitchen_unit,
    freezer_unit: r.freezer_unit,
  }));

  const { error } = await supabase
    .from("station_ingredients")
    .upsert(rows, { onConflict: "station_id,ingredient_id" });
  if (error) return { error: error.message };
  return {};
}
