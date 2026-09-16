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
 * TWO LAYERS, AND THEY MUST NOT SHARE LOGIC. The database enforces through RLS
 * keyed on the SQL function can_see_prep(); this module decides what the
 * screen shows by reading the same DATA (profiles.role, prep_recipe_access)
 * and applying the rule itself, here, in TypeScript. RLS is still the only
 * thing that can stop a direct PostgREST call from someone's own session.
 *
 * Two layers calling the same predicate are one layer. Until 2026-09-16 this
 * module asked the database's own can_see_prep() for single recipes, and
 * trusted prep_recipe_access's SELECT policy to narrow the list. Both rested
 * on is_owner(), which has meant owner OR admin since
 * migrations/006_owner_role.sql, so one misreading opened both layers at once
 * and every admin saw every prep. See
 * supabase/prep_owner_only_predicate_migration.sql.
 */
export type PrepVisibility = {
  /** True when the current user may see this prep recipe's composition. */
  canSee: (prepRecipeId: string | null | undefined) => boolean;
};

const CLOSED: PrepVisibility = { canSee: () => false };
const OPEN: PrepVisibility = { canSee: () => true };

/**
 * The rule, once, in TypeScript. Its SQL twin is can_see_prep(), and the two
 * are kept apart on purpose (see above).
 *
 * Every grant read is filtered by profile_id HERE rather than left to the
 * table's SELECT policy. Leaving it to the policy is what made this layer a
 * copy of the database's: while the policy's owner arm admitted admins, the
 * unfiltered read returned all 96 grant rows to every admin, and the list
 * showed them all 48 preps.
 *
 * Fails closed: no session, or a failed read, means nothing is visible.
 */
async function visibility(onlyPrepRecipeId?: string): Promise<PrepVisibility> {
  const profile = await getCurrentProfile();
  if (!profile) return CLOSED;
  // Rule 4: the owner's access is the ROLE, never a grant row.
  if (profile.role === "owner") return OPEN;

  const supabase = await createClient();
  let query = supabase.from("prep_recipe_access").select("prep_recipe_id").eq("profile_id", profile.id);
  if (onlyPrepRecipeId !== undefined) query = query.eq("prep_recipe_id", onlyPrepRecipeId);
  const { data, error } = await query;
  if (error) return CLOSED;

  const granted = new Set((data ?? []).map((r) => r.prep_recipe_id as string));
  return { canSee: (id) => !!id && granted.has(id) };
}

/**
 * One query, then a predicate — for surfaces that filter a list. Asking once
 * per recipe would be 48 round trips for the same answer.
 */
export async function getPrepVisibility(): Promise<PrepVisibility> {
  return visibility();
}

/**
 * Single-recipe check, for a detail page or a mutation guard. The same rule as
 * getPrepVisibility, reading one grant row instead of all of them.
 *
 * Deliberately NOT supabase.rpc("can_see_prep"): that is the function RLS
 * calls, and asking it here would make the detail page one layer, not two.
 */
export async function canSeePrep(prepRecipeId: string): Promise<boolean> {
  return (await visibility(prepRecipeId)).canSee(prepRecipeId);
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

/**
 * A failed prep_recipes INSERT, in Thai. Every caller generates the new id
 * itself, so a 23505 is the UNIQUE (name) constraint. For anyone but the owner
 * that is usually a prep they have not been granted: they cannot see it, so
 * the orphan-reuse lookup in createPrep did not find it either. The message
 * offers both ways out without saying which one applies.
 */
export function prepInsertErrorMessage(error: { code?: string; message: string }, name: string): string {
  return error.code === "23505"
    ? `มีของเตรียมชื่อ "${name}" อยู่แล้ว — ใช้ชื่ออื่น หรือขอให้เจ้าของร้านเปิดสิทธิ์สูตรนั้นให้`
    : error.message;
}

export type PrepAccessRecipe = { id: string; name: string; category: string | null };
export type PrepAccessPerson = { id: string; fullName: string; role: string };
export type PrepAccessGrant = {
  prepRecipeId: string;
  profileId: string;
  grantedAt: string;
  grantedByName: string | null;
};

/**
 * Everything the owner's grant screen renders. The screen's requireOwner() is
 * what keeps this owner-only.
 *
 * NOT owner-only by construction, although an earlier version of this comment
 * said so. The `profiles` SELECT policy in version control is
 * `id = auth.uid() OR is_owner()`, and is_owner() admits admins
 * (migrations/006_owner_role.sql), so an admin reaching this would get every
 * person. (The live database may carry more profiles policies than the repo
 * shows; see profile_employee_link_migration.sql.)
 *
 * What IS narrowed for an admin, since prep_owner_only_predicate_migration.sql,
 * is the other two reads: only the recipes and grant rows they hold. The
 * profiles policy is not changed here: /owner/team and other admin screens may
 * depend on it.
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
