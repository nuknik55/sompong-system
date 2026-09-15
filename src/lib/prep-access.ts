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

export type PrepAccessRecipe = { id: string; name: string; category: string | null };
export type PrepAccessPerson = { id: string; fullName: string; role: string };
export type PrepAccessGrant = {
  prepRecipeId: string;
  profileId: string;
  grantedAt: string;
  grantedByName: string | null;
};

/**
 * Everything the owner's grant screen renders. Owner-only by construction:
 * `profiles` is select-own under RLS except for the owner, so this returns one
 * row of people to anyone else — the screen's requireOwner() is the guard, and
 * this is what happens anyway if that guard is ever wrong.
 *
 * Candidates are admin, editor and staff. The OWNER IS NOT IN THE LIST, and
 * that is not an oversight: the owner's access comes from the role inside
 * can_see_prep(), never from a row here, so there is nothing to tick or untick
 * and a checkbox would imply a grant that could be revoked. Sales and hr are
 * excluded too — they cannot read the prep tables at all
 * (costing_tables_rls_migration.sql), so granting them would be a row that
 * changes nothing.
 */
export async function getPrepAccessBoard(): Promise<{
  recipes: PrepAccessRecipe[];
  people: PrepAccessPerson[];
  grants: PrepAccessGrant[];
}> {
  const supabase = await createClient();
  const [{ data: recipes }, { data: people }, { data: grants }] = await Promise.all([
    supabase.from("prep_recipes").select("id, name, category").order("name"),
    supabase.from("profiles").select("id, full_name, role").in("role", ["admin", "editor", "staff"]).order("full_name"),
    supabase.from("prep_recipe_access").select("prep_recipe_id, profile_id, granted_at, granted_by"),
  ]);

  const grantRows = (grants ?? []) as {
    prep_recipe_id: string; profile_id: string; granted_at: string; granted_by: string | null;
  }[];

  // granted_by is a profile id; resolve it to a name for the provenance line.
  // Read separately rather than joined: the granter is normally the owner, who
  // is deliberately absent from `people` above.
  const granterIds = [...new Set(grantRows.map((g) => g.granted_by).filter((v): v is string => !!v))];
  const { data: granters } = granterIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", granterIds)
    : { data: [] as { id: string; full_name: string }[] };
  const granterName = new Map((granters ?? []).map((g) => [g.id as string, g.full_name as string]));

  return {
    recipes: (recipes ?? []).map((r) => ({ id: r.id as string, name: r.name as string, category: (r.category as string | null) ?? null })),
    people: (people ?? []).map((p) => ({ id: p.id as string, fullName: p.full_name as string, role: p.role as string })),
    grants: grantRows.map((g) => ({
      prepRecipeId: g.prep_recipe_id,
      profileId: g.profile_id,
      grantedAt: g.granted_at,
      grantedByName: g.granted_by ? granterName.get(g.granted_by) ?? null : null,
    })),
  };
}
