/**
 * What createPrep may do with a name, decided only from what its lookups
 * found. Pure, so every case is a test rather than a hope.
 *
 * Queue item 24. The branch this replaces reused ANY prep_recipes row with
 * the requested name and rewrote its category and batch yield. On 2026-09-16
 * there were 0 orphan preps, so every name it could match was a LIVE prep,
 * and 205 menus depended on at least one. Typing an existing prep's name into
 * the create form with the default yield of 1 กรัม silently changed the cost
 * of every dish using it, and then opened the prep as though it were new.
 *
 * "Orphan" is defined by the schema, not guessed:
 *
 *   - An ORPHAN INGREDIENT is `is_prep` with `prep_recipe_id` NULL. The FK is
 *     ON DELETE SET NULL, so a non-null prep_recipe_id always points at a
 *     prep that EXISTS, whether or not the caller may see it.
 *   - An ORPHAN PREP is a prep_recipes row that no ingredient points at.
 *     The caller only finds a prep it may see (RLS). A hidden prep with the
 *     same name is therefore never found here, reaches the insert, and is
 *     refused there by UNIQUE (name).
 *
 * Only orphans are reused. Anything live is refused, because nothing that a
 * create form does should change a recipe other dishes are costed from.
 */
export type PrepNameLookup = {
  /** The ingredients row with this name, if any. Every creator can read it. */
  ingredient: { id: string; is_prep: boolean; prep_recipe_id: string | null } | null;
  /** The prep_recipes row with this name, if the caller may see it. */
  prep: { id: string } | null;
  /** Whether any ingredients row points at `prep`. Ignored when `prep` is null. */
  prepIsLinked: boolean;
};

export type PrepCreatePlan =
  | {
      kind: "refuse";
      /**
       * raw_ingredient — the name belongs to a raw ingredient.
       * live_prep      — a prep the caller can see, and it is in use.
       * name_taken     — a live prep holds the name, and the caller cannot
       *                  see that prep (or the name and link disagree).
       */
      reason: "raw_ingredient" | "live_prep" | "name_taken";
    }
  | {
      kind: "create";
      /** Reuse this orphan prep_recipes row instead of inserting one. */
      reusePrepId: string | null;
      /** Relink this orphan ingredient instead of inserting one. */
      relinkIngredientId: string | null;
    };

export function planPrepCreate(found: PrepNameLookup): PrepCreatePlan {
  const { ingredient, prep, prepIsLinked } = found;

  if (ingredient && !ingredient.is_prep) return { kind: "refuse", reason: "raw_ingredient" };

  // A prep ingredient that points at a recipe is live, seen or not.
  if (ingredient && ingredient.prep_recipe_id !== null) {
    return {
      kind: "refuse",
      reason: prep && prep.id === ingredient.prep_recipe_id ? "live_prep" : "name_taken",
    };
  }

  // A visible prep that something points at is live, even if the ingredient
  // pointing at it carries a different name.
  if (prep && prepIsLinked) return { kind: "refuse", reason: "live_prep" };

  return {
    kind: "create",
    reusePrepId: prep ? prep.id : null,
    relinkIngredientId: ingredient ? ingredient.id : null,
  };
}
