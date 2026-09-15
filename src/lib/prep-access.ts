import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";

/**
 * Who may see a prep recipe's COMPOSITION — its ingredient list, its history,
 * and its row in any list. Nik's rules, 2026-09-14:
 *
 *   - Closed by default. A prep with no prep_recipe_access row is invisible to
 *     everyone but the owner, including admins. There is no implicit admin
 *     bypass: เฮง, อู๋ and the admin account are named per recipe like anyone
 *     else.
 *   - Only the OWNER grants, and the owner's own access is structural (the
 *     role, not a grant row), so revoking can never lock the owner out.
 *
 * NOT about the prep's NAME or its COST. The name stays on dish recipes and in
 * the ingredient picker — a cook must know the dish contains the sauce — and
 * it comes from `ingredients`, never from `prep_recipes`. The cost stays
 * correct for everyone through public.prep_unit_costs(); see getCostingContext
 * in @/lib/data.
 *
 * The database is the enforcement (RLS keyed on the same can_see_prep()); this
 * module is the presentation. Both exist deliberately: the app layer keeps a
 * hidden prep off the screen, and RLS keeps it out of a direct PostgREST call
 * from an editor's own session, which no amount of app-layer filtering can.
 */
export type PrepVisibility = {
  /** True when the current user may see this prep recipe's composition. */
  canSee: (prepRecipeId: string | null | undefined) => boolean;
};

/**
 * One query, then a predicate — for surfaces that filter a list. Asking
 * can_see_prep() 48 times would be 48 round trips for the same answer.
 *
 * The read is itself defended: prep_recipe_access's own SELECT policy returns
 * a user only their own rows, so even a mistake in the role check here cannot
 * widen what comes back.
 */
export async function getPrepVisibility(): Promise<PrepVisibility> {
  const profile = await getCurrentProfile();
  if (profile?.role === "owner") return { canSee: () => true };

  const supabase = await createClient();
  const { data } = await supabase.from("prep_recipe_access").select("prep_recipe_id");
  const granted = new Set((data ?? []).map((r) => r.prep_recipe_id as string));
  return { canSee: (id) => !!id && granted.has(id) };
}

/**
 * Single-recipe check, for a detail page or a mutation guard. Goes through the
 * same SQL predicate the RLS policies use, so app and database can never
 * disagree about who may see what.
 */
export async function canSeePrep(prepRecipeId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("can_see_prep", { p_prep_recipe_id: prepRecipeId });
  if (error) return false;
  return data === true;
}

/**
 * The prep recipe a prep_recipe_items row belongs to, for guarding a write by
 * item id. Returns null when the row does not exist — the caller must treat
 * that as "refuse", not as "allow".
 */
export async function prepRecipeIdForItem(itemId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prep_recipe_items")
    .select("prep_recipe_id")
    .eq("id", itemId)
    .maybeSingle();
  return (data?.prep_recipe_id as string | undefined) ?? null;
}

/** The one Thai message every refusal uses, so they cannot drift apart. */
export const PREP_FORBIDDEN = "ไม่มีสิทธิ์เข้าถึงสูตรของเตรียมนี้";
