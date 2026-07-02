"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { resolvePendingChange } from "@/lib/pending-data";
import { createClient } from "@/lib/supabase/server";

export type ApproveResult = { error?: string };

// Apply a pending change to the real tables, then mark as approved.
export async function approveChange(id: string): Promise<ApproveResult> {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { data: row, error: fetchErr } = await supabase
    .from("pending_changes")
    .select("change_type, target_id, payload, status")
    .eq("id", id)
    .single();
  if (fetchErr || !row) return { error: "ไม่พบรายการนี้" };
  if (row.status !== "pending") return { error: "รายการนี้ถูกดำเนินการแล้ว" };

  const p = row.payload as Record<string, unknown>;

  try {
    switch (row.change_type) {

      case "recipe_edit": {
        const items = p.items as { id: string; ingredient_id: string | null; quantity: number; unit: string | null }[];
        const deletedIds = p.deletedIds as string[];
        const target = p.target as "menu" | "prep";
        const parentId = p.parentId as string;
        const table = target === "menu" ? "menu_recipe_items" : "prep_recipe_items";
        const parentCol = target === "menu" ? "menu_id" : "prep_recipe_id";

        if (deletedIds && deletedIds.length > 0) {
          await supabase.from(table).delete().in("id", deletedIds);
        }
        for (const [index, item] of (items ?? []).entries()) {
          if (!item.ingredient_id) continue;
          if (item.id.startsWith("new-")) {
            await supabase.from(table).insert({ [parentCol]: parentId, ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index });
          } else {
            await supabase.from(table).update({ ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index }).eq("id", item.id);
          }
        }
        revalidatePath(`/staff/${target}/${parentId}`);
        break;
      }

      case "prep_yield_edit": {
        const prepId = p.parentId as string;
        await supabase.from("prep_recipes").update({ batch_yield_qty: p.qty, batch_yield_unit: p.unit }).eq("id", prepId);
        revalidatePath(`/staff/prep/${prepId}`);
        break;
      }

      case "menu_create": {
        await supabase.from("menus").insert({ name: p.name, category: p.category || null, selling_price: p.sellingPrice ?? 0, fuel_cost: 0 });
        revalidatePath("/staff");
        break;
      }

      case "menu_delete": {
        await supabase.from("menus").delete().eq("id", p.menuId);
        revalidatePath("/staff");
        break;
      }

      case "prep_create": {
        const { data: newPrep } = await supabase
          .from("prep_recipes")
          .insert({ name: p.name, category: p.category || null, batch_yield_qty: p.batchYieldQty ?? 1, batch_yield_unit: p.batchYieldUnit ?? "กรัม" })
          .select("id").single();
        if (newPrep) {
          await supabase.from("ingredients").insert({ name: p.name, category: p.category || "prep", is_prep: true, usage_unit: p.batchYieldUnit ?? "กรัม", prep_recipe_id: newPrep.id });
        }
        revalidatePath("/owner/ingredients");
        break;
      }

      case "prep_delete": {
        const prepId = p.prepId as string;
        await supabase.from("ingredients").delete().eq("prep_recipe_id", prepId);
        await supabase.from("prep_recipes").delete().eq("id", prepId);
        revalidatePath("/owner/ingredients");
        break;
      }

      case "ingredient_create": {
        await supabase.from("ingredients").insert({ ...(p.fields as Record<string, unknown>), is_prep: false });
        revalidatePath("/owner/ingredients");
        break;
      }

      case "ingredient_edit": {
        await supabase.from("ingredients").update(p.fields as Record<string, unknown>).eq("id", p.ingredientId);
        revalidatePath("/owner/ingredients");
        break;
      }

      case "ingredient_delete": {
        await supabase.from("ingredients").delete().eq("id", p.ingredientId);
        revalidatePath("/owner/ingredients");
        break;
      }

      case "sop_upsert": {
        const sopData = p.sopData as {
          menuId: string; authorName: string; updatedAt: string; demoVideoUrl: string;
          ingredientNotes: Record<string, string>;
          prepSteps: { text: string; photoUrl: string | null }[];
          cookSteps: { text: string; photoUrl: string | null }[];
          platingSteps: { text: string; photoUrl: string | null }[];
          checklist: { text: string; photoUrl: string | null }[];
        };
        const { data: sop } = await supabase
          .from("menu_sops")
          .upsert({ menu_id: sopData.menuId, author_name: sopData.authorName || null, updated_at: sopData.updatedAt, demo_video_url: sopData.demoVideoUrl.trim() || null }, { onConflict: "menu_id" })
          .select("id").single();
        if (sop) {
          await supabase.from("menu_sop_ingredient_notes").delete().eq("sop_id", sop.id);
          const noteRows = Object.entries(sopData.ingredientNotes ?? {}).filter(([, n]) => n.trim()).map(([iid, note]) => ({ sop_id: sop.id, ingredient_id: iid, note: note.trim() }));
          if (noteRows.length > 0) await supabase.from("menu_sop_ingredient_notes").insert(noteRows);
          await supabase.from("menu_sop_steps").delete().eq("sop_id", sop.id);
          const stepRows = [
            ...(sopData.prepSteps ?? []).map((s, i) => ({ sop_id: sop.id, section: "prep", sort_order: i, text: s.text, photo_url: s.photoUrl })),
            ...(sopData.cookSteps ?? []).map((s, i) => ({ sop_id: sop.id, section: "cook", sort_order: i, text: s.text, photo_url: s.photoUrl })),
            ...(sopData.platingSteps ?? []).map((s, i) => ({ sop_id: sop.id, section: "plating", sort_order: i, text: s.text, photo_url: s.photoUrl })),
            ...(sopData.checklist ?? []).map((s, i) => ({ sop_id: sop.id, section: "checklist", sort_order: i, text: s.text, photo_url: null })),
          ].filter((s) => s.text.trim());
          if (stepRows.length > 0) await supabase.from("menu_sop_steps").insert(stepRows);
        }
        revalidatePath("/sop");
        revalidatePath(`/sop/${sopData.menuId}`);
        revalidatePath(`/sop/${sopData.menuId}/edit`);
        break;
      }

      case "sop_delete": {
        await supabase.from("menu_sops").delete().eq("menu_id", p.menuId);
        revalidatePath("/sop");
        revalidatePath(`/sop/${p.menuId}`);
        break;
      }

      default:
        return { error: `ไม่รู้จักประเภทการเปลี่ยนแปลง: ${row.change_type}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ" };
  }

  await resolvePendingChange(id, "approved", admin.id);
  revalidatePath("/owner/approve");
  return {};
}

export async function rejectChange(id: string, adminNote: string): Promise<ApproveResult> {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { data: row } = await supabase.from("pending_changes").select("status").eq("id", id).single();
  if (!row) return { error: "ไม่พบรายการนี้" };
  if (row.status !== "pending") return { error: "รายการนี้ถูกดำเนินการแล้ว" };

  await resolvePendingChange(id, "rejected", admin.id, adminNote || undefined);
  revalidatePath("/owner/approve");
  return {};
}
