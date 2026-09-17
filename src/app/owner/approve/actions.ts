"use server";

import { revalidatePath } from "next/cache";
import { approvalRowId } from "@/lib/approval-id";
import { requireAdmin } from "@/lib/auth";
import { prepIdOfChange, resolvePendingChange } from "@/lib/pending-data";
import { canSeePrep, prepInsertErrorMessage, PREP_FORBIDDEN } from "@/lib/prep-access";
import { planPrepCreate } from "@/lib/prep-create";
import { lookupPrepName, prepRefusalMessage } from "@/lib/prep-name";
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

/**
 * Does a prep with this id exist, including one this approver may not see?
 * prep_unit_costs() is the one read NOT filtered by can_see_prep: it returns
 * every prep's id and cost (never its lines), which an admin already gets.
 * Used instead of reading a failed insert's error text, which would depend
 * on which unique index Postgres reports first.
 */
async function prepExists(supabase: Awaited<ReturnType<typeof createClient>>, prepId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("prep_unit_costs");
  if (error) throw new Error(`ตรวจงานที่ทำค้างไว้: ${error.message}`);
  return ((data ?? []) as { prep_recipe_id: string }[]).some((r) => r.prep_recipe_id === prepId);
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
 * a case. Five change types issue more than one write and can therefore end
 * up half-applied:
 *
 *   recipe_edit   delete removed rows, then insert/update each item
 *   sop_upsert    upsert SOP, then delete+insert notes, then delete+insert steps
 *   menu_create   (a duplicate only) insert menus, then copy the recipe lines
 *   prep_create   insert prep_recipes, then its ingredients row, then (a
 *                 duplicate only) copy the recipe lines
 *   prep_delete   delete ingredients, then delete prep_recipes
 *
 * menu_create and prep_create RESUME on a retry: the row they create takes
 * an id derived from the change (approvalRowId), so a second approval finds
 * its own earlier work and finishes it. One exception, see prep_create: an
 * approval that took over an orphan prep cannot recognise its work once the
 * ingredient row is linked.
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

  // The queue hides every request about a prep the approver cannot see
  // (getPendingList), and the action refuses the same ones, by the same
  // function. (The table's own read policy hides the same rows once
  // supabase/permissions_batch_2026_09_17.sql has run; queue item 31.
  // The one difference is described in pending-prep-id.ts.)
  // Without this, a request id obtained any other way would be applied as
  // writes that RLS silently turns into no-ops, and the change would still be
  // marked APPROVED: a false audit trail. For a duplicate this is the SOURCE
  // prep, since approving it copies the source's lines.
  const guardedPrepId = prepIdOfChange(row.change_type as string, row.target_id as string, p);
  // `!== null`, not truthiness: an empty-string id is a prep id too, and
  // canSeePrep refuses it, as the queue does.
  if (guardedPrepId !== null && !(await canSeePrep(guardedPrepId))) return { error: PREP_FORBIDDEN };

  // Written into the request's note when it is marked approved.
  let approvalNote: string | undefined;

  try {
    switch (row.change_type) {

      case "recipe_edit": {
        const items = p.items as { id: string; ingredient_id: string | null; quantity: number; unit: string | null }[];
        const deletedIds = p.deletedIds as string[];
        const target = p.target as "menu" | "prep";
        // A prep's id is the one the guard above checked (prepIdOfChange).
        const parentId = target === "menu" ? (p.parentId as string) : guardedPrepId!;
        const table = target === "menu" ? "menu_recipe_items" : "prep_recipe_items";
        const parentCol = target === "menu" ? "menu_id" : "prep_recipe_id";

        // NOT ATOMIC: each statement below is its own request/transaction, so
        // a failure part-way leaves the recipe half-applied (see the header
        // note on approveChange). The checks here guarantee the change is not
        // marked approved, and name the failing step — they cannot roll the
        // earlier writes back.
        // Every write is limited to the parent that was checked: the line
        // ids come from the request, and a line of ANOTHER recipe must not be
        // deleted or rewritten under this recipe's name (item 29 review).
        // Read BEFORE any write: which of the request's existing lines are
        // still in this recipe. A request carries the recipe's whole line
        // list as it was when filed, so a line deleted since (by an earlier
        // approval, or by an admin) is skipped, as it always was, and the
        // rest is applied. The skip is written into the request's note. A
        // line of ANOTHER recipe is skipped the same way.
        const existingIds = [...new Set((items ?? []).filter((it) => it.ingredient_id && !it.id.startsWith("new-")).map((it) => it.id))];
        const present = new Set<string>();
        if (existingIds.length > 0) {
          const { data: found, error: foundError } = await supabase
            .from(table).select("id").eq(parentCol, parentId).in("id", existingIds);
          if (foundError) throw new Error(`ตรวจรายการวัตถุดิบ: ${foundError.message}`);
          for (const r of found ?? []) present.add(r.id as string);
          const skipped = existingIds.length - present.size;
          if (skipped > 0) {
            approvalNote = `ข้ามวัตถุดิบ ${skipped} แถวที่ไม่อยู่ในสูตรนี้แล้วตอนอนุมัติ (ถูกลบหรือเปลี่ยนหลังส่งคำขอ)`;
          }
        }
        if (deletedIds && deletedIds.length > 0) {
          await run("ลบวัตถุดิบที่ถูกเอาออก", supabase.from(table).delete().in("id", deletedIds).eq(parentCol, parentId));
        }
        for (const [index, item] of (items ?? []).entries()) {
          if (!item.ingredient_id) continue;
          if (item.id.startsWith("new-")) {
            await run(
              `เพิ่มวัตถุดิบแถวที่ ${index + 1}`,
              supabase.from(table).insert({ [parentCol]: parentId, ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index }),
            );
          } else if (present.has(item.id)) {
            // Counted: the line was in this recipe a moment ago, so 0 rows
            // means it changed during the approval, and the request must not
            // then be marked approved.
            const { error, count } = await supabase
              .from(table)
              .update({ ingredient_id: item.ingredient_id, quantity: item.quantity, unit: item.unit, sort_order: index }, { count: "exact" })
              .eq("id", item.id)
              .eq(parentCol, parentId);
            if (error) throw new Error(`แก้ไขวัตถุดิบแถวที่ ${index + 1}: ${error.message}`);
            if (count !== 1) {
              throw new Error(`แก้ไขวัตถุดิบแถวที่ ${index + 1}: แถวนี้เพิ่งถูกเปลี่ยนระหว่างอนุมัติ — ตรวจสูตรแล้วปฏิเสธคำขอนี้`);
            }
          }
        }
        revalidatePath(`/staff/${target}/${parentId}`);
        break;
      }

      case "prep_yield_edit": {
        const prepId = guardedPrepId!; // the id the guard above checked
        await run(
          "แก้ไขปริมาณผลผลิตของ prep",
          supabase.from("prep_recipes").update({ batch_yield_qty: p.qty, batch_yield_unit: p.unit }).eq("id", prepId),
        );
        revalidatePath(`/staff/prep/${prepId}`);
        break;
      }

      case "menu_create": {
        // Queue item 27: an editor's DUPLICATE arrives here as a menu_create
        // with payload.duplicatedFrom, and until 2026-09-17 was approved as an
        // EMPTY menu: the header was created and none of the original's recipe
        // lines. It now copies them, the way duplicateMenu does for an admin.
        //
        // Everything about the original is READ before anything is written, so
        // a missing original or a failed read refuses with nothing created.
        //
        // RESUMABLE. The new menu's id is derived from this change's id
        // (approvalRowId). If an earlier
        // attempt created the menu and then failed on the lines, a retry finds
        // the menu it already made and finishes, instead of colliding with
        // UNIQUE(name) forever. The lines are one INSERT statement, so they are
        // either all there or not there at all.
        const sourceMenuId = typeof p.duplicatedFrom === "string" ? p.duplicatedFrom : null;
        let sourceLines: { ingredient_id: string; quantity: number; unit: string | null; sort_order: number | null }[] = [];
        if (sourceMenuId) {
          const [original, lines] = await Promise.all([
            supabase.from("menus").select("id").eq("id", sourceMenuId).maybeSingle(),
            supabase.from("menu_recipe_items").select("ingredient_id, quantity, unit, sort_order").eq("menu_id", sourceMenuId),
          ]);
          if (original.error) throw new Error(`อ่านเมนูต้นฉบับ: ${original.error.message}`);
          if (!original.data) throw new Error("เมนูต้นฉบับถูกลบไปแล้ว — คัดลอกไม่ได้ ให้ปฏิเสธคำขอนี้ หรือสร้างเมนูใหม่เอง");
          if (lines.error) throw new Error(`อ่านสูตรเมนูต้นฉบับ: ${lines.error.message}`);
          sourceLines = lines.data ?? [];
        }

        const newMenuId = approvalRowId(id, "menu");
        const already = await supabase.from("menus").select("id").eq("id", newMenuId).maybeSingle();
        if (already.error) throw new Error(`ตรวจงานที่ทำค้างไว้: ${already.error.message}`);
        if (!already.data) {
          await run(
            "สร้างเมนูใหม่",
            supabase.from("menus").insert({ id: newMenuId, name: p.name, category: p.category || null, selling_price: p.sellingPrice ?? 0 }),
          );
        }
        if (sourceLines.length > 0) {
          const existing = await supabase.from("menu_recipe_items").select("id", { count: "exact", head: true }).eq("menu_id", newMenuId);
          if (existing.error || existing.count === null) throw new Error(`ตรวจสูตรที่คัดลอกไว้: ${existing.error?.message ?? "นับไม่ได้"}`);
          if (existing.count === 0) {
            await run(
              "คัดลอกสูตรจากเมนูต้นฉบับ",
              supabase.from("menu_recipe_items").insert(sourceLines.map((it) => ({ ...it, menu_id: newMenuId }))),
            );
          }
        }
        revalidatePath("/staff");
        break;
      }

      case "menu_delete": {
        await run("ลบเมนู", supabase.from("menus").delete().eq("id", p.menuId));
        revalidatePath("/staff");
        break;
      }

      case "prep_create": {
        // NOT ATOMIC: up to three writes (the prep, its ingredient row, and for
        // a duplicate the copied lines). A retry RESUMES instead of starting
        // over; see below.
        //
        // The name is checked BEFORE any write, by the same rule as createPrep
        // (planPrepCreate). A refusal throws before anything is written, so the
        // change stays pending with the reason shown.
        //
        // The id is made here and the row is NOT read back (so not
        // runReturning): INSERT ... RETURNING is checked against the SELECT
        // policy, and a prep nobody has been granted fails it for every admin.
        // Full note above createPrep in staff/prep/actions.ts.
        //
        // DUPLICATES (queue item 27). A request an editor made by duplicating a
        // prep carries payload.duplicatedFrom, and until 2026-09-17 was
        // approved as an EMPTY recipe. It now copies the original the way
        // duplicatePrep does for an admin: the original's CURRENT yield, unit
        // and note, its ingredient row's usage unit, and its recipe lines, all
        // read before any write. The approver must be able to see the original
        // (checked at the top of approveChange, since prepIdOfChange maps a
        // duplicate to its source). The name is planned in COPY mode, so an
        // orphan prep holding the name is refused rather than having the copied
        // lines land on its own.
        //
        // RESUMABLE. The new prep's id is derived from this change's id
        // (approvalRowId), so rows an earlier, failed attempt wrote are
        // recognisable:
        //   - the name lookup finds an ingredient or prep carrying that id:
        //     skip the name refusal and finish what is missing;
        //   - an admin cannot SEE a prep with no grant, so a prep an earlier
        //     attempt inserted without its ingredient is found by prepExists()
        //     instead: skip the insert and carry on;
        //   - finishing the copied lines needs to count the lines already
        //     there, which needs sight of the new prep. An approver who cannot
        //     see it is told to have the owner approve again.
        // NOT resumable: an approval that TOOK OVER an orphan prep writes to
        // the orphan's own id, so once its ingredient row is linked a retry
        // sees a live prep and is refused. There were 0 orphan preps on
        // 2026-09-17; the owner can check the prep and reject the request.
        const prepName = p.name as string;
        const sourcePrepId = typeof p.duplicatedFrom === "string" ? p.duplicatedFrom : null;
        let source: {
          yieldQty: number;
          yieldUnit: string;
          note: string | null;
          usageUnit: string | null;
          lines: { ingredient_id: string; quantity: number; unit: string | null; note: string | null; sort_order: number | null }[];
        } | null = null;
        if (sourcePrepId) {
          const [original, ingredient, lines] = await Promise.all([
            supabase.from("prep_recipes").select("batch_yield_qty, batch_yield_unit, note").eq("id", sourcePrepId).maybeSingle(),
            supabase.from("ingredients").select("usage_unit").eq("prep_recipe_id", sourcePrepId).maybeSingle(),
            supabase.from("prep_recipe_items").select("ingredient_id, quantity, unit, note, sort_order").eq("prep_recipe_id", sourcePrepId),
          ]);
          if (original.error) throw new Error(`อ่านสูตร prep ต้นฉบับ: ${original.error.message}`);
          if (!original.data) throw new Error("สูตร prep ต้นฉบับถูกลบไปแล้ว — คัดลอกไม่ได้ ให้ปฏิเสธคำขอนี้");
          if (ingredient.error) throw new Error(`อ่านวัตถุดิบของสูตรต้นฉบับ: ${ingredient.error.message}`);
          if (lines.error) throw new Error(`อ่านรายการในสูตรต้นฉบับ: ${lines.error.message}`);
          source = {
            yieldQty: Number(original.data.batch_yield_qty),
            yieldUnit: original.data.batch_yield_unit as string,
            note: (original.data.note as string | null) ?? null,
            usageUnit: (ingredient.data?.usage_unit as string | null | undefined) ?? null,
            lines: lines.data ?? [],
          };
        }

        const lookup = await lookupPrepName(supabase, prepName);
        if (!lookup.ok) throw new Error(`ตรวจชื่อสูตร prep: ${lookup.message}`);
        const found = lookup.found;
        const newPrepId = approvalRowId(id, "prep");
        const ingredientDone = found.ingredient?.prep_recipe_id === newPrepId;
        const resuming = ingredientDone || found.prep?.id === newPrepId;

        let reusePrepId: string | null = null;
        let relinkIngredientId: string | null = null;
        if (resuming) {
          // Finish an earlier attempt. An orphan ingredient with this name was
          // the plan's relink target then, and still is.
          if (!ingredientDone && found.ingredient?.is_prep && found.ingredient.prep_recipe_id === null) {
            relinkIngredientId = found.ingredient.id;
          }
        } else {
          const plan = planPrepCreate(found, source ? "copy" : "create");
          if (plan.kind === "refuse") throw new Error(`สร้างสูตร prep: ${prepRefusalMessage(plan.reason, prepName)}`);
          reusePrepId = plan.reusePrepId;
          relinkIngredientId = plan.relinkIngredientId;
        }

        const yieldQty = source ? source.yieldQty : (p.batchYieldQty ?? 1);
        const yieldUnit = source ? source.yieldUnit : (p.batchYieldUnit ?? "กรัม");
        const usageUnit = source ? (source.usageUnit ?? "กรัม") : (p.batchYieldUnit ?? "กรัม");
        const prepId = reusePrepId ?? newPrepId;

        if (reusePrepId) {
          // A true orphan (nothing points at it), so rewriting it moves no cost.
          await run(
            "ใช้สูตร prep ที่ค้างอยู่",
            supabase
              .from("prep_recipes")
              .update({ category: p.category || null, batch_yield_qty: p.batchYieldQty ?? 1, batch_yield_unit: p.batchYieldUnit ?? "กรัม" })
              .eq("id", reusePrepId),
          );
        } else if (!resuming && !(await prepExists(supabase, prepId))) {
          // (If it exists, an earlier attempt of this approval inserted it and
          // this approver cannot see it: carry on to the ingredient row.)
          await run(
            "สร้างสูตร prep",
            supabase
              .from("prep_recipes")
              .insert({ id: prepId, name: prepName, category: p.category || null, batch_yield_qty: yieldQty, batch_yield_unit: yieldUnit, note: source?.note ?? null })
              .then(({ error }) => ({ error: error && { message: prepInsertErrorMessage(error, prepName) } })),
          );
        }

        if (!ingredientDone) {
          if (relinkIngredientId) {
            await run(
              "ผูกวัตถุดิบ prep ที่ค้างอยู่",
              supabase
                .from("ingredients")
                .update({ category: p.category || "prep", usage_unit: usageUnit, prep_recipe_id: prepId })
                .eq("id", relinkIngredientId),
            );
          } else {
            await run(
              "สร้างวัตถุดิบสำหรับ prep",
              supabase.from("ingredients").insert({ name: prepName, category: p.category || "prep", is_prep: true, usage_unit: usageUnit, prep_recipe_id: prepId }),
            );
          }
        }

        if (source && source.lines.length > 0) {
          // Copy mode never reuses an orphan prep, so prepId is this change's
          // own row. On a first attempt it has no lines; on a resumed one,
          // count them first, which needs sight of the new prep.
          let copyLines = true;
          if (resuming) {
            if (!(await canSeePrep(prepId))) {
              throw new Error("การอนุมัติครั้งก่อนสร้างสูตรนี้ไว้แล้วแต่ยังไม่ครบ และคุณยังไม่มีสิทธิ์ดูสูตรใหม่นั้น — ให้เจ้าของร้านกดอนุมัติอีกครั้งเพื่อทำให้ครบ");
            }
            const existing = await supabase.from("prep_recipe_items").select("id", { count: "exact", head: true }).eq("prep_recipe_id", prepId);
            if (existing.error || existing.count === null) throw new Error(`ตรวจรายการที่คัดลอกไว้: ${existing.error?.message ?? "นับไม่ได้"}`);
            copyLines = existing.count === 0;
          }
          if (copyLines) {
            await run(
              "คัดลอกรายการจากสูตร prep ต้นฉบับ",
              supabase.from("prep_recipe_items").insert(source.lines.map((it) => ({ ...it, prep_recipe_id: prepId }))),
            );
          }
        }
        revalidatePath("/owner/ingredients");
        break;
      }

      case "prep_delete": {
        // NOT ATOMIC: two deletes. A failure on the second leaves the prep
        // recipe behind with its ingredient row already gone.
        const prepId = guardedPrepId!; // the id the guard above checked
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

  try {
    await resolvePendingChange(id, "approved", admin.id, approvalNote);
  } catch (e) {
    revalidatePath("/owner/approve");
    return { error: `บันทึกการเปลี่ยนแปลงแล้ว แต่เปลี่ยนสถานะคำขอไม่สำเร็จ: ${e instanceof Error ? e.message : ""}` };
  }
  revalidatePath("/owner/approve");
  return {};
}

export async function rejectChange(id: string, adminNote: string): Promise<ApproveResult> {
  const admin = await requireAdmin();
  const supabase = await createClient();

  const { data: row } = await supabase.from("pending_changes").select("status, change_type, target_id, payload").eq("id", id).single();
  if (!row) return { error: "ไม่พบรายการนี้" };
  if (row.status !== "pending") return { error: "รายการนี้ถูกดำเนินการแล้ว" };
  // The same guard as approveChange: a request the queue hides from this
  // approver is neither approvable nor rejectable by them.
  const guardedPrepId = prepIdOfChange(row.change_type as string, row.target_id as string, row.payload as Record<string, unknown>);
  if (guardedPrepId !== null && !(await canSeePrep(guardedPrepId))) return { error: PREP_FORBIDDEN };

  try {
    await resolvePendingChange(id, "rejected", admin.id, adminNote || undefined);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "ปฏิเสธคำขอไม่สำเร็จ" };
  }
  revalidatePath("/owner/approve");
  return {};
}
