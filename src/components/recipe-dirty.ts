/**
 * "Has this recipe been changed since it was last clean?" — for the recipe
 * editor, which the head chef and the prep head use every day (Nik,
 * 2026-09-21). A false warning costs more here than anywhere in catering.
 *
 * WHAT WAS WRONG BEFORE. The editor set a boolean on the first edit and
 * cleared it only on save, so it could never recover:
 *   - change a quantity 2 → 3 → 2 and it still read as changed;
 *   - add a row and remove it again, same;
 *   - pick the same ingredient again in the combobox, same;
 * and the price was compared as TEXT, so "180.00" typed over 180 read as a
 * change — and, worse, still did AFTER a successful save, because the saved
 * figure became the number 180 while the box kept the text "180.00".
 *
 * WHAT IT IS NOW: a comparison of what a save would change against what was
 * last clean, the same principle as the booking screen.
 *
 *   - THE UNIT IS LEFT OUT. The pages load every saved row with unit NULL,
 *     and picking an ingredient — even the SAME one again — sets it to that
 *     ingredient's usage_unit, so a comparison that included it read a
 *     re-pick as an edit. The unit is derived from the ingredient and no
 *     screen shows a row's stored unit, so the ingredient stands for it.
 *     (The first version of this file compared it, and its tests passed
 *     only because their rows carried a unit the pages never load with —
 *     found by review, 2026-09-21. The fixtures now load the way the pages
 *     do.)
 *   - A NEW row with no ingredient is left out: the save drops it, and
 *     there is nothing to delete, so adding one and leaving loses nothing.
 *   - A SAVED row whose ingredient has been cleared stays in, as a change.
 *     The database cannot hold a row without an ingredient, so saving one
 *     means deleting it — see clearedSavedIds. It used to be neither: the
 *     save skipped it, the screen dropped it, and it came back on reload
 *     with its old ingredient.
 *   - A new row's client id is not part of it: a row has no identity until
 *     it is saved.
 *   - Quantity and price are compared as the numbers that would be sent.
 */

/** Just what a save writes for one row. */
export type RecipeRow = {
  id: string;
  ingredient_id: string | null;
  quantity: number;
};

const isNew = (id: string) => id.startsWith("new-");

/** A stable string for what saving these rows would change. */
export function recipeSnapshot(items: RecipeRow[]): string {
  return JSON.stringify(
    items
      .filter((it) => it.ingredient_id || !isNew(it.id))
      .map((it) => [isNew(it.id) ? "new" : it.id, it.ingredient_id ?? null, Number(it.quantity) || 0]),
  );
}

/**
 * Saved rows whose ingredient has been cleared. A row cannot exist without
 * an ingredient, so saving the recipe in this state DELETES them — they are
 * sent with the removed rows, through the same path ลบ uses, which the
 * direct save and the approval both already honour.
 */
export function clearedSavedIds(items: RecipeRow[]): string[] {
  return items.filter((it) => !it.ingredient_id && !isNew(it.id)).map((it) => it.id);
}

/**
 * To the satang, by way of the decimal string rather than binary
 * multiplication: 1.005 × 100 is 100.49999… in floating point and would
 * round DOWN, while the numeric(12,2) column rounds 1.005 UP to 1.01. Reading
 * "1.005e2" as a number is exactly 100.5.
 */
function toSatang(n: number): number {
  const shifted = Number(`${n}e2`);
  return Math.round(Number.isFinite(shifted) ? shifted : n * 100);
}

/**
 * Would saving this price box change the stored price? Compared as the
 * number onSavePrice is actually sent (`Number(input) || 0`), to the satang,
 * so "180", "180.0" and "180.00" are the same price and a blank box is 0.
 */
export function priceChanged(input: string, saved: number): boolean {
  const sent = Number(input) || 0;
  return toSatang(sent) !== toSatang(Number(saved) || 0);
}
