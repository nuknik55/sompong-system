"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { resolvePendingChange } from "@/lib/pending-data";
import { createClient } from "@/lib/supabase/server";

export type ApproveResult = { error?: string };

/**
 * Runs one write and throws if it failed.
 *
 * Every write in approveChange MUST go through this. PostgREST returns a
 * failed write as `{ error }` rather than throwing, so an unchecked
 * `await supabase.from(...)...` silently "succeeds" — and the
 * resolvePendingChange() at the bottom of approveChange then marks the change
 * APPROVED even though nothing was applied. That produces a false audit trail
 * with no way to detect it after the fact, which is worse than losing the
 * write outright.
 *
 * `step` is surfaced to the admin so a failure says which part failed, not
 * just that something did.
 */
async function run(step: string, query: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await query;
  if (error) throw new Error(`${step}: ${error.message}`);
}

/** Same, for a write that must also return a row (insert ... select single). */
async function runReturning<T>(
  step: string,
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${step}: ${error.message}`);
  // A write that reports no error but returns no row is equally unsafe to
  // continue from — the old code silently skipped the dependent writes here
  // and still marked the change approved.
  if (!data) throw new Error(`${step}: ไม่ได้รับข้อมูลกลับจากฐานข้อมูล`);
  return data;
}

/**
 * Applies a pending change to the real tables, then marks it approved.
 *
 * ORDERING GUARANTEE: every write goes through run()/runReturning(), which
 * throw on failure. The catch below turns that into `{ error }` and returns
 * BEFORE resolvePendingChange(), so a change can never be recorded as
 * approved unless every one of its writes reported success.
 *
 * WHAT THIS DOES NOT GIVE YOU — ATOMICITY. Each supabase call is a separate
 * PostgREST request in its own transaction; there is no transaction spanning
 * a case. Four change types issue more than one write and can therefore end
 * up half-applied:
 *
 *   recipe_edit   delete removed rows, then insert/update each item
 *   sop_upsert    upsert SOP, then delete+insert notes, then delete+insert steps
 *   prep_create   insert prep_recipes, then insert its ingredients row
 *   prep_delete   delete ingredients, then delete prep_recipes
 *
 * recipe_edit and sop_upsert are the dangerous two, because their deletes run
 * before their inserts: a mid-sequence failure destroys the old rows without
 * writing the new ones. The change correctly stays `pending` and the admin is
 * told which step failed — but the data is already gone, and re-approving
 * re-runs the whole sequence from a now-different starting state.
 *
 * Making these atomic requires moving each multi-write case into a Postgres
 * function invoked via rpc(), so the whole sequence runs in one server-side
 * transaction. That is a schema change and is deliberately not done here.
 */
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

        // NOT ATOMIC: each statement below is its own request/transaction, so
        // a failure part-way leaves the recipe half-applied (see the header
        // note on approveChange). The checks here guarantee the change is not
        // marked approved, and name the failing step — they cannot roll the
        // earlier writes back.
        if (deletedIds && deletedIds.length > 0) {
          await run("ลบวัตถุดิบที่ถูกเอาออก", supabase.from(table).delete().in("id", deletedIds));
        }
        for (const [index, item] of (items ?? []).entries()) {
          if (!item.ingredient_id) continue;
          if (item.id.startsWith("new-")) {
            await run(
              `เพิ่มวัตถุดิบแถวที่ ${index + 1}`,
              supabase.from(table).insert({ [parentCol]: parentId, ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index }),
            );
          } else {
            await run(
              `แก้ไขวัตถุดิบแถวที่ ${index + 1}`,
              supabase.from(table).update({ ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index }).eq("id", item.id),
            );
          }
        }
        revalidatePath(`/staff/${target}/${parentId}`);
        break;
      }

      case "prep_yield_edit": {
        const prepId = p.parentId as string;
        await run(
          "แก้ไขปริมาณผลผลิตของ prep",
          supabase.from("prep_recipes").update({ batch_yield_qty: p.qty, batch_yield_unit: p.unit }).eq("id", prepId),
        );
        revalidatePath(`/staff/prep/${prepId}`);
        break;
      }

      case "menu_create": {
        await run(
          "สร้างเมนูใหม่",
          supabase.from("menus").insert({ name: p.name, category: p.category || null, selling_price: p.sellingPrice ?? 0 }),
        );
        revalidatePath("/staff");
        break;
      }

      case "menu_delete": {
        await run("ลบเมนู", supabase.from("menus").delete().eq("id", p.menuId));
        revalidatePath("/staff");
        break;
      }

      case "prep_create": {
        // NOT ATOMIC: two writes. A failure on the second leaves a prep recipe
        // with no matching ingredient row (so it can never be used in a menu).
        const newPrep = await runReturning<{ id: string }>(
          "สร้างสูตร prep",
          supabase
            .from("prep_recipes")
            .insert({ name: p.name, category: p.category || null, batch_yield_qty: p.batchYieldQty ?? 1, batch_yield_unit: p.batchYieldUnit ?? "กรัม" })
            .select("id").single(),
        );
        await run(
          "สร้างวัตถุดิบสำหรับ prep",
          supabase.from("ingredients").insert({ name: p.name, category: p.category || "prep", is_prep: true, usage_unit: p.batchYieldUnit ?? "กรัม", prep_recipe_id: newPrep.id }),
        );
        revalidatePath("/owner/ingredients");
        break;
      }

      case "prep_delete": {
        // NOT ATOMIC: two deletes. A failure on the second leaves the prep
        // recipe behind with its ingredient row already gone.
        const prepId = p.prepId as string;
        await run("ลบวัตถุดิบของ prep", supabase.from("ingredients").delete().eq("prep_recipe_id", prepId));
        await run("ลบสูตร prep", supabase.from("prep_recipes").delete().eq("id", prepId));
        revalidatePath("/owner/ingredients");
        break;
      }

      case "ingredient_create": {
        await run(
          "สร้างวัตถุดิบ",
          supabase.from("ingredients").insert({ ...(p.fields as Record<string, unknown>), is_prep: false }),
        );
        revalidatePath("/owner/ingredients");
        break;
      }

      case "ingredient_edit": {
        await run(
          "แก้ไขวัตถุดิบ",
          supabase.from("ingredients").update(p.fields as Record<string, unknown>).eq("id", p.ingredientId),
        );
        revalidatePath("/owner/ingredients");
        break;
      }

      case "ingredient_delete": {
        await run("ลบวัตถุดิบ", supabase.from("ingredients").delete().eq("id", p.ingredientId));
        revalidatePath("/owner/ingredients");
        break;
      }

      case "ingredient_category_delete": {
        await run(
          "ลบหมวดวัตถุดิบ",
          supabase.from("ingredients").update({ category: null }).eq("category", p.category as string),
        );
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
        // NOT ATOMIC, and the most destructive case here: notes and steps are
        // replaced by delete-then-insert. If an insert fails after its delete
        // succeeded, the SOP's content is gone rather than merely unchanged.
        // The checks stop it being marked approved and name the failing step,
        // but cannot restore what the delete removed — see the header note.
        const sop = await runReturning<{ id: string }>(
          "บันทึก SOP",
          supabase
            .from("menu_sops")
            .upsert({ menu_id: sopData.menuId, author_name: sopData.authorName || null, updated_at: sopData.updatedAt, demo_video_url: sopData.demoVideoUrl.trim() || null }, { onConflict: "menu_id" })
            .select("id").single(),
        );

        await run("ลบหมายเหตุวัตถุดิบเดิม", supabase.from("menu_sop_ingredient_notes").delete().eq("sop_id", sop.id));
        const noteRows = Object.entries(sopData.ingredientNotes ?? {}).filter(([, n]) => n.trim()).map(([iid, note]) => ({ sop_id: sop.id, ingredient_id: iid, note: note.trim() }));
        if (noteRows.length > 0) {
          await run("บันทึกหมายเหตุวัตถุดิบ", supabase.from("menu_sop_ingredient_notes").insert(noteRows));
        }

        await run("ลบขั้นตอน SOP เดิม", supabase.from("menu_sop_steps").delete().eq("sop_id", sop.id));
        const stepRows = [
          ...(sopData.prepSteps ?? []).map((s, i) => ({ sop_id: sop.id, section: "prep", sort_order: i, text: s.text, photo_url: s.photoUrl })),
          ...(sopData.cookSteps ?? []).map((s, i) => ({ sop_id: sop.id, section: "cook", sort_order: i, text: s.text, photo_url: s.photoUrl })),
          ...(sopData.platingSteps ?? []).map((s, i) => ({ sop_id: sop.id, section: "plating", sort_order: i, text: s.text, photo_url: s.photoUrl })),
          ...(sopData.checklist ?? []).map((s, i) => ({ sop_id: sop.id, section: "checklist", sort_order: i, text: s.text, photo_url: null })),
        ].filter((s) => s.text.trim());
        if (stepRows.length > 0) {
          await run("บันทึกขั้นตอน SOP", supabase.from("menu_sop_steps").insert(stepRows));
        }
        revalidatePath("/sop");
        revalidatePath(`/sop/${sopData.menuId}`);
        revalidatePath(`/sop/${sopData.menuId}/edit`);
        break;
      }

      case "sop_delete": {
        await run("ลบ SOP", supabase.from("menu_sops").delete().eq("menu_id", p.menuId));
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
