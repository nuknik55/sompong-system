"use server";

import { revalidatePath } from "next/cache";
import { requireAdminOrEditor } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { error?: string };

export async function addToTemplate(
  stationId: string,
  ingredientIds: string[]
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();

  // Find max existing sort_order for this station
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
  revalidatePath(`/owner/stations/${stationId}/template`);
  return {};
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
  revalidatePath(`/owner/stations/${stationId}/template`);
  return {};
}

export async function updateTemplateRow(
  stationId: string,
  id: string,
  fields: { custom_group?: string | null; custom_unit?: string | null; default_qty?: number | null }
): Promise<ActionResult> {
  await requireAdminOrEditor();
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("station_ingredients")
    .update(fields)
    .eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/owner/stations/${stationId}/template`);
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
  revalidatePath(`/owner/stations/${stationId}/template`);
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
  revalidatePath(`/owner/stations/${stationId}/template`);
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
  revalidatePath(`/owner/stations/${stationId}/template`);
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
    .select("ingredient_id, custom_group, custom_unit, default_qty, sort_order")
    .eq("station_id", fromStationId)
    .order("sort_order");
  if (fetchErr) return { error: fetchErr.message };
  if (!sourceRows?.length) return { error: "สถานีต้นทางไม่มีรายการ" };

  const rows = sourceRows.map((r) => ({
    station_id: toStationId,
    ingredient_id: r.ingredient_id,
    custom_group: r.custom_group,
    custom_unit: r.custom_unit,
    default_qty: r.default_qty,
    sort_order: r.sort_order,
  }));

  const { error } = await supabase
    .from("station_ingredients")
    .upsert(rows, { onConflict: "station_id,ingredient_id" });
  if (error) return { error: error.message };
  revalidatePath(`/owner/stations/${toStationId}/template`);
  return {};
}
