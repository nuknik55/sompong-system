/**
 * Run with: npm test — what counts as an unsaved change in the recipe
 * editor, used daily by the head chef and the prep head.
 *
 * THE FIXTURES LOAD THE WAY THE PAGES DO: every saved row comes in with
 * unit NULL (staff/menu/[id]/page.tsx and staff/prep/[id]/page.tsx). The
 * first version of these tests gave rows a unit the pages never produce,
 * and so passed while the real editor still warned on a re-picked
 * ingredient — the review of 2026-09-21 found it. A fixture that does not
 * match production data can only confirm, never catch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recipeSnapshot, priceChanged, clearedSavedIds, type RecipeRow } from "./recipe-dirty.ts";

/** A row exactly as the recipe pages load it: unit NULL. */
type LoadedRow = RecipeRow & { unit: string | null };
const row = (id: string, ingredient_id: string | null, quantity: number, unit: string | null = null): LoadedRow =>
  ({ id, ingredient_id, quantity, unit });
const saved = [row("r1", "i-pork", 150), row("r2", "i-garlic", 10)];
const snap = recipeSnapshot;

test("A RECIPE NOBODY TOUCHED IS CLEAN, including an empty one", () => {
  assert.equal(snap(saved), snap([...saved]));
  assert.equal(snap([]), snap([]));
});

test("TYPED AND REVERTED IS CLEAN — the false warning the flag gave", () => {
  const edited = saved.map((r) => (r.id === "r1" ? { ...r, quantity: 200 } : r));
  assert.notEqual(snap(edited), snap(saved), "200 is a change");
  const reverted = edited.map((r) => (r.id === "r1" ? { ...r, quantity: 150 } : r));
  assert.equal(snap(reverted), snap(saved), "back to 150 is not");
});

test("ADDING A ROW AND REMOVING IT AGAIN IS CLEAN", () => {
  const added = [...saved, row("new-abc-1", "i-salt", 5)];
  assert.notEqual(snap(added), snap(saved));
  assert.equal(snap(added.filter((r) => r.id !== "new-abc-1")), snap(saved));
});

test("RE-PICKING THE SAME INGREDIENT IS CLEAN — even though it fills in the unit", () => {
  // The pages load unit NULL; any pick sets it to the ingredient's
  // usage_unit. The first version of the model compared the unit and so
  // read this as an edit. This is the exact shape the editor produces.
  const repicked = saved.map((r) => (r.id === "r2" ? { ...r, ingredient_id: "i-garlic", unit: "กรัม" } : r));
  assert.equal(snap(repicked), snap(saved));
  // Garlic → pepper → garlic, the same.
  const away = saved.map((r) => (r.id === "r2" ? { ...r, ingredient_id: "i-pepper", unit: "กรัม" } : r));
  assert.notEqual(snap(away), snap(saved));
  const back = away.map((r) => (r.id === "r2" ? { ...r, ingredient_id: "i-garlic", unit: "กรัม" } : r));
  assert.equal(snap(back), snap(saved));
});

test("A NEW EMPTY ROW IS NOT A CHANGE — the save drops it and there is nothing to delete", () => {
  assert.equal(snap([...saved, row("new-x", null, 0)]), snap(saved), "added, never filled in");
  assert.notEqual(snap([...saved, row("new-x", "i-salt", 0)]), snap(saved), "an ingredient makes it a row the save keeps");
});

test("A SAVED ROW WITH ITS INGREDIENT CLEARED IS A CHANGE, and saving it deletes the row", () => {
  // It used to be neither: the save skipped it, the screen dropped it, and
  // it came back on reload with its old ingredient.
  const cleared = saved.map((r) => (r.id === "r2" ? { ...r, ingredient_id: null } : r));
  assert.notEqual(snap(cleared), snap(saved), "the screen must say it is unsaved");
  assert.deepEqual(clearedSavedIds(cleared), ["r2"], "and the save sends it as a deletion");
  // A new row with no ingredient is not a deletion: it was never stored.
  assert.deepEqual(clearedSavedIds([...saved, row("new-z", null, 0)]), []);
  // Putting the ingredient back undoes it entirely.
  const restored = cleared.map((r) => (r.id === "r2" ? { ...r, ingredient_id: "i-garlic", unit: "กรัม" } : r));
  assert.equal(snap(restored), snap(saved));
  assert.deepEqual(clearedSavedIds(restored), []);
});

test("EVERY REAL EDIT IS CAUGHT — a missed one is lost work", () => {
  const cases: [string, LoadedRow[]][] = [
    ["quantity", saved.map((r) => (r.id === "r1" ? { ...r, quantity: 151 } : r))],
    ["ingredient", saved.map((r) => (r.id === "r1" ? { ...r, ingredient_id: "i-beef" } : r))],
    ["a removed saved row", saved.filter((r) => r.id !== "r2")],
    ["a saved row cleared of its ingredient", saved.map((r) => (r.id === "r2" ? { ...r, ingredient_id: null } : r))],
    ["a new filled-in row", [...saved, row("new-y", "i-sugar", 3)]],
    ["reordered rows", [saved[1]!, saved[0]!]],
  ];
  for (const [what, items] of cases) assert.notEqual(snap(items), snap(saved), what);
});

test("A NEW ROW'S CLIENT ID IS NOT PART OF IT — a row has no identity until saved", () => {
  assert.equal(snap([...saved, row("new-aaa-1", "i-salt", 5)]), snap([...saved, row("new-bbb-2", "i-salt", 5)]));
  // A saved row's id IS: it names which row the save updates.
  assert.notEqual(snap([row("r9", "i-pork", 150), saved[1]!]), snap(saved));
});

test("THE PRICE: compared as the number that would be sent, to the satang", () => {
  assert.equal(priceChanged("180", 180), false);
  assert.equal(priceChanged("180.0", 180), false, "the text differs, the price does not");
  assert.equal(priceChanged("180.00", 180), false);
  assert.equal(priceChanged("180.5", 180.5), false);
  assert.equal(priceChanged("181", 180), true);
  assert.equal(priceChanged("180.01", 180), true, "one satang is a change");
  assert.equal(priceChanged("", 180), true, "clearing the box would save 0");
  assert.equal(priceChanged("", 0), false, "and a blank box over a 0 price saves nothing new");
  assert.equal(priceChanged("abc", 0), false, "nonsense is sent as 0");
});

test("THE PRICE ROUNDS THE WAY THE COLUMN DOES: 1.005 is stored as 1.01, so it is a change from 1", () => {
  // 1.005 * 100 is 100.49999… in floating point and would round to 100,
  // calling it unchanged while numeric(12,2) stores 1.01.
  assert.equal(priceChanged("1.005", 1), true);
  assert.equal(priceChanged("1.005", 1.01), false);
  assert.equal(priceChanged("2.675", 2.68), false);
});

test("AFTER A SUCCESSFUL PRICE SAVE THE BOX IS CLEAN — the old text comparison said otherwise", () => {
  // The editor saves Number("180.00") = 180 and keeps the box showing
  // "180.00". Compared as text, that read as unsaved straight after the
  // save that stored it.
  const typed = "180.00";
  const nowSaved = Number(typed) || 0;
  assert.equal(priceChanged(typed, nowSaved), false);
});
