import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { prepNameTakenMessage } from "@/lib/prep-access";
import type { PrepCreatePlan, PrepNameLookup } from "@/lib/prep-create";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The reads planPrepCreate decides from, done once for all three places that
 * create a prep: createPrep, duplicatePrep, and approving an editor's
 * prep_create. Kept in one place because the old copies had drifted: only
 * createPrep looked before writing, and it did not check its reads.
 *
 * Every error is returned, never read as "nothing found". A failed lookup
 * taken for an empty one inserts a prep and then fails on the ingredient's
 * UNIQUE name, leaving an orphan behind.
 */
export async function lookupPrepName(
  supabase: Supabase,
  name: string,
): Promise<{ ok: true; found: PrepNameLookup } | { ok: false; message: string }> {
  const [ingredientRead, prepRead] = await Promise.all([
    supabase.from("ingredients").select("id, is_prep, prep_recipe_id").eq("name", name).maybeSingle(),
    supabase.from("prep_recipes").select("id").eq("name", name).maybeSingle(),
  ]);
  if (ingredientRead.error) return { ok: false, message: ingredientRead.error.message };
  if (prepRead.error) return { ok: false, message: prepRead.error.message };
  const ingredient = ingredientRead.data as PrepNameLookup["ingredient"];
  const prep = prepRead.data as PrepNameLookup["prep"];

  // Is the prep that was found in use? Any ingredients row pointing at it
  // makes it live, whatever that row is called. A null count is read as "in
  // use": failing closed refuses a create; failing open rewrites a recipe.
  let prepIsLinked = false;
  if (prep) {
    const { count, error } = await supabase
      .from("ingredients")
      .select("id", { count: "exact", head: true })
      .eq("prep_recipe_id", prep.id);
    if (error) return { ok: false, message: error.message };
    prepIsLinked = count !== 0;
  }

  return { ok: true, found: { ingredient, prep, prepIsLinked } };
}

/** The Thai message for each refusal, shared by all three callers. */
export function prepRefusalMessage(reason: Extract<PrepCreatePlan, { kind: "refuse" }>["reason"], name: string): string {
  switch (reason) {
    case "raw_ingredient":
      return `ชื่อ "${name}" มีในวัตถุดิบดิบแล้ว กรุณาใช้ชื่ออื่น`;
    case "live_prep":
      return `มีของเตรียมชื่อ "${name}" อยู่แล้ว — ใช้ชื่ออื่น หรือเปิดสูตรเดิมเพื่อแก้ไข`;
    case "name_taken":
      return prepNameTakenMessage(name);
    case "orphan_prep":
      return `มีของเตรียมชื่อ "${name}" ค้างอยู่โดยไม่ได้ใช้งาน — ใช้ชื่ออื่นสำหรับสำเนา หรือสร้างด้วยปุ่ม "สร้างของ prep ใหม่" เพื่อใช้แถวเดิม`;
  }
}
