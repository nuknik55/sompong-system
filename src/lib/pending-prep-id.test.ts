/**
 * Run with: npm test — which prep a pending change is about (queue item 31).
 *
 * CASES is also written, row for row, into the self-check of
 * supabase/permissions_batch_2026_09_17.sql, which runs the SQL twin
 * public.pending_change_prep_id() on it. Change both together.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepIdOfChange } from "./pending-prep-id.ts";

const K = "fc8c4a24-5c9d-4569-9e40-113f4a2ae07c";
const T = "11111111-1111-4111-8111-111111111111";

// [label, change_type, target_id, payload, expected prep id]
const CASES: [string, string, string, unknown, string | null][] = [
  ["recipe_edit on a prep", "recipe_edit", K, { target: "prep", parentId: K }, K],
  ["recipe_edit on a menu", "recipe_edit", K, { target: "menu", parentId: K }, null],
  ["recipe_edit, target not exactly menu, counts as a prep", "recipe_edit", T, { target: "Prep", parentId: K }, K],
  ["recipe_edit with no target counts as a prep", "recipe_edit", T, { parentId: K }, K],
  ["recipe_edit, parentId not a string, falls back to target_id", "recipe_edit", T, { target: "prep", parentId: 5 }, T],
  ["recipe_edit, parentId not a uuid, is still the id", "recipe_edit", T, { target: "prep", parentId: "nope" }, "nope"],
  ["recipe_edit, empty parentId is still an id", "recipe_edit", T, { target: "prep", parentId: "" }, ""],
  ["recipe_edit, JSON null payload, counts as a prep on target_id", "recipe_edit", T, null, T],
  ["recipe_edit, array payload, counts as a prep on target_id", "recipe_edit", T, [1, 2], T],
  ["prep_yield_edit is about the prep it WRITES, parentId", "prep_yield_edit", T, { parentId: K }, K],
  ["prep_yield_edit with no parentId falls back to target_id", "prep_yield_edit", T, {}, T],
  ["prep_delete on prepId", "prep_delete", T, { prepId: K }, K],
  ["prep_delete with no prepId falls back to target_id", "prep_delete", T, {}, T],
  ["a duplicate prep is about its source", "prep_create", "dup:x", { duplicatedFrom: K }, K],
  ["a new prep is about nothing", "prep_create", "new:x", { name: "x" }, null],
  ["a duplicatedFrom that is not a string is not a source", "prep_create", "dup:x", { duplicatedFrom: 7 }, null],
  ["a menu duplicate is not about a prep", "menu_create", "dup:x", { duplicatedFrom: K }, null],
  ["other types are about nothing", "ingredient_edit", T, { target: "prep", parentId: K, prepId: K }, null],
];

test("each case maps to the prep the approval would write to", () => {
  for (const [label, type, target, payload, want] of CASES) {
    assert.equal(prepIdOfChange(type, target, payload), want, label);
  }
});

test("THE DEFECTS: an odd target and a mismatched yield request are no longer unchecked", () => {
  // Before item 31: null (skipped the check) while approval wrote to K.
  assert.equal(prepIdOfChange("recipe_edit", T, { target: "Prep", parentId: K }), K);
  // Before item 31: T was checked while approval wrote to K.
  assert.equal(prepIdOfChange("prep_yield_edit", T, { parentId: K }), K);
});
