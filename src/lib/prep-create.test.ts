/** Run with: npm test — what createPrep may do with a name (queue item 24). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planPrepCreate } from "./prep-create.ts";

const P = "prep-1";
const OTHER = "prep-2";
const liveIngredient = (prepId: string) => ({ id: "ing-1", is_prep: true, prep_recipe_id: prepId });
const orphanIngredient = { id: "ing-1", is_prep: true, prep_recipe_id: null };
const rawIngredient = { id: "ing-1", is_prep: false, prep_recipe_id: null };

test("THE DEFECT: an existing, in-use prep with the same name is refused, never reused", () => {
  // The shape every name match had on 2026-09-16: the prep and its
  // ingredient row, linked. The old branch rewrote this prep's yield.
  const plan = planPrepCreate({ ingredient: liveIngredient(P), prep: { id: P }, prepIsLinked: true });
  assert.deepEqual(plan, { kind: "refuse", reason: "live_prep" });
});

test("a new name creates both rows", () => {
  const plan = planPrepCreate({ ingredient: null, prep: null, prepIsLinked: false });
  assert.deepEqual(plan, { kind: "create", reusePrepId: null, relinkIngredientId: null });
});

test("an orphan prep (nothing points at it) is reused, and its ingredient row is created", () => {
  const plan = planPrepCreate({ ingredient: null, prep: { id: P }, prepIsLinked: false });
  assert.deepEqual(plan, { kind: "create", reusePrepId: P, relinkIngredientId: null });
});

test("an orphan ingredient (prep_recipe_id NULL) is relinked to a new prep", () => {
  const plan = planPrepCreate({ ingredient: orphanIngredient, prep: null, prepIsLinked: false });
  assert.deepEqual(plan, { kind: "create", reusePrepId: null, relinkIngredientId: "ing-1" });
});

test("an orphan prep and an orphan ingredient are joined back together", () => {
  const plan = planPrepCreate({ ingredient: orphanIngredient, prep: { id: P }, prepIsLinked: false });
  assert.deepEqual(plan, { kind: "create", reusePrepId: P, relinkIngredientId: "ing-1" });
});

test("a live prep the caller CANNOT see is refused as name_taken, not relinked", () => {
  // An ungranted admin: RLS hides the prep, but the ingredient row is
  // readable and its non-null prep_recipe_id proves the prep exists.
  const plan = planPrepCreate({ ingredient: liveIngredient(P), prep: null, prepIsLinked: false });
  assert.deepEqual(plan, { kind: "refuse", reason: "name_taken" });
});

test("a visible prep in use under a differently named ingredient is still refused", () => {
  const plan = planPrepCreate({ ingredient: null, prep: { id: P }, prepIsLinked: true });
  assert.deepEqual(plan, { kind: "refuse", reason: "live_prep" });
});

test("an ingredient pointing at a DIFFERENT prep than the one found is refused as name_taken", () => {
  const plan = planPrepCreate({ ingredient: liveIngredient(OTHER), prep: { id: P }, prepIsLinked: false });
  assert.deepEqual(plan, { kind: "refuse", reason: "name_taken" });
});

test("a raw ingredient's name is refused, whatever else was found", () => {
  for (const prep of [null, { id: P }]) {
    for (const prepIsLinked of [false, true]) {
      assert.deepEqual(
        planPrepCreate({ ingredient: rawIngredient, prep, prepIsLinked }),
        { kind: "refuse", reason: "raw_ingredient" },
      );
    }
  }
});

test("prepIsLinked means nothing when no prep was found", () => {
  const plan = planPrepCreate({ ingredient: null, prep: null, prepIsLinked: true });
  assert.deepEqual(plan, { kind: "create", reusePrepId: null, relinkIngredientId: null });
});
