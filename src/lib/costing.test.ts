/** Run with: npm test — the cost rules that stayed in TypeScript. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rawUnitCost, resolveUnitCosts, computeMenuCost, type IngredientRow } from "./costing.ts";

// This file exists because resolveUnitCosts had NO test coverage at all while
// it carried the prep-nesting fixpoint, and it was changed shape when that
// fixpoint moved into public.prep_unit_costs(). The nesting rule is now proven
// against the database by scripts/verify-prep-unit-costs.mjs (a gate a person
// runs — see supabase/README.md). What is left in TypeScript is rawUnitCost
// and the injection of prep costs, and that is what these tests pin.

function ing(over: Partial<IngredientRow> & { id: string }): IngredientRow {
  return {
    name: over.id, category: null, is_prep: false, purchase_cost: null,
    receive_qty: 1, yield_qty: null, usage_unit: "กรัม", prep_recipe_id: null,
    ...over,
  } as IngredientRow;
}

test("rawUnitCost: no purchase price means unknown, never zero", () => {
  // The distinction the whole costing path rests on — a dish with an unpriced
  // ingredient must read "incomplete", not "cheap".
  assert.equal(rawUnitCost(ing({ id: "a", purchase_cost: null })), null);
  assert.notEqual(rawUnitCost(ing({ id: "a", purchase_cost: null })), 0);
});

test("rawUnitCost: no yield conversion means usage unit == purchase unit", () => {
  assert.equal(rawUnitCost(ing({ id: "a", purchase_cost: 100, receive_qty: 4, yield_qty: null })), 25);
  // yield_qty 0 takes the same branch as null — it is "not set", not "zero yield".
  assert.equal(rawUnitCost(ing({ id: "a", purchase_cost: 100, receive_qty: 4, yield_qty: 0 })), 25);
});

test("rawUnitCost: yield conversion divides by the trim factor", () => {
  // 1 kg bought at 100, 800 g usable: 0.8 conversion, so 125 per usable kg-unit.
  assert.equal(rawUnitCost(ing({ id: "a", purchase_cost: 100, receive_qty: 1, yield_qty: 0.8 })), 125);
});

test("rawUnitCost: a nonsensical conversion is unknown, not a wrong number", () => {
  assert.equal(rawUnitCost(ing({ id: "a", purchase_cost: 100, receive_qty: 1, yield_qty: -2 })), null);
});

test("prep costs come from the injected map, not from a recipe", () => {
  // The shape change: the prep nesting fixpoint lives in SQL now. A prep
  // ingredient's cost is whatever prep_unit_costs() said, full stop.
  const costs = resolveUnitCosts(
    [
      ing({ id: "raw", purchase_cost: 50, receive_qty: 1 }),
      ing({ id: "sauce", is_prep: true, prep_recipe_id: "r1" }),
    ],
    new Map([["r1", 0.25]]),
  );
  assert.equal(costs.get("raw"), 50);
  assert.equal(costs.get("sauce"), 0.25);
});

test("a prep the function could not price stays unknown", () => {
  // prep_unit_costs() returns NULL for a prep with no items or an unpriced
  // component — five of them live today. That must arrive as unknown.
  const costs = resolveUnitCosts(
    [ing({ id: "sauce", is_prep: true, prep_recipe_id: "r1" })],
    new Map([["r1", null]]),
  );
  assert.equal(costs.get("sauce"), null);
});

test("a prep missing from the map, or with no recipe, is unknown — never zero", () => {
  // Two ways to fall off the map: the function returned no row for it, or the
  // ingredient is flagged is_prep with no prep_recipe_id (an orphan).
  const costs = resolveUnitCosts(
    [
      ing({ id: "absent", is_prep: true, prep_recipe_id: "r-missing" }),
      ing({ id: "orphan", is_prep: true, prep_recipe_id: null }),
    ],
    new Map(),
  );
  assert.equal(costs.get("absent"), null);
  assert.equal(costs.get("orphan"), null);
});

test("an unknown component makes the DISH incomplete rather than cheaper", () => {
  // The end-to-end consequence, and the reason null must never become 0.
  const unitCosts = resolveUnitCosts(
    [
      ing({ id: "raw", purchase_cost: 10, receive_qty: 1 }),
      ing({ id: "sauce", is_prep: true, prep_recipe_id: "r1" }),
    ],
    new Map([["r1", null]]),
  );
  const menu = { id: "m", name: "ผัดไทย", category: null, selling_price: 100, last_period_qty_sold: 0, staff_visible: true };
  const cost = computeMenuCost(
    menu,
    [
      { id: "i1", menu_id: "m", ingredient_id: "raw", quantity: 2 },
      { id: "i2", menu_id: "m", ingredient_id: "sauce", quantity: 30 },
    ],
    unitCosts,
    0,
  );
  assert.equal(cost.hasUnknownCost, true);
  assert.equal(cost.ingredientCost, 20, "the known part still totals; the unknown part is flagged, not guessed");
});
