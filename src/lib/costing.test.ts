/** Run with: npm test — the cost rules that stayed in TypeScript. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rawUnitCost,
  resolveUnitCosts,
  computeMenuCost,
  classifyMenuEngineering,
  classifyWithinCategory,
  unrankedReasonText,
  MIN_RANKABLE_GROUP,
  type IngredientRow,
  type MenuCost,
} from "./costing.ts";

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

// ── Menu Engineering within category (queue item 5) ────────────────────────

/** A dish with a given category, units sold and profit per unit. */
function dish(id: string, category: string | null, qty: number, profit: number): MenuCost {
  return {
    menu: { id, name: id, category, selling_price: profit + 10, last_period_qty_sold: qty, staff_visible: true },
    ingredientCost: 10,
    qFactorAmount: 0,
    totalCost: 10,
    foodCostPct: null,
    profitPerUnit: profit,
    hasUnknownCost: false,
  };
}
const byId = <T extends { menu: { id: string } }>(rows: T[]) => new Map(rows.map((r) => [r.menu.id, r]));

test("within category: the best dish of a cheap category is a Star there, whatever the global pool says", () => {
  // The one-plate case in miniature: a low-margin category beside a
  // high-margin one. Globally, plate-top sits under the pooled profit bar.
  const plates = [dish("plate-top", "plates", 60, 90), ...["a", "b", "c", "d"].map((x) => dish("plate-" + x, "plates", 10, 40))];
  const crabs = ["a", "b", "c", "d", "e"].map((x) => dish("crab-" + x, "crab", 10, 300));
  const all = [...plates, ...crabs];

  assert.equal(byId(classifyMenuEngineering(all)).get("plate-top")!.menuClass, "Horse", "the global pool reads it as low-margin");
  const within = byId(classifyWithinCategory(all));
  assert.equal(within.get("plate-top")!.menuClass, "Star");
  assert.equal(within.get("plate-top")!.unrankedReason, null);
});

test("within category: a category below the minimum is Unranked with the small-group reason, not pooled", () => {
  const all = [
    dish("dessert-mango", "desserts", 478, 104), // a top seller: still no verdict
    dish("dessert-other", "desserts", 5, 50),
    ...["a", "b", "c", "d", "e"].map((x) => dish("fish-" + x, "fish", 10, 100)),
  ];
  const r = byId(classifyWithinCategory(all)).get("dessert-mango")!;
  assert.equal(r.menuClass, "Unranked");
  assert.equal(r.profitClass, null);
  assert.deepEqual(r.unrankedReason, { kind: "small_group", group: "desserts", dishesWithSales: 2, minimum: MIN_RANKABLE_GROUP });
  assert.match(unrankedReasonText(r.unrankedReason!), /หมวด "desserts" มีเมนูที่มียอดขาย 2 รายการ/);
});

test("within category: the minimum counts dishes WITH SALES, not dishes", () => {
  // Six dishes, four sold: below the floor.
  const group = [...["a", "b", "c", "d"].map((x) => dish(x, "g", 10, 50)), dish("e", "g", 0, 50), dish("f", "g", 0, 50)];
  const rows = classifyWithinCategory(group);
  assert.ok(rows.every((r) => r.menuClass === "Unranked"));
  assert.equal(rows.filter((r) => r.unrankedReason?.kind === "small_group").length, 4);
  assert.equal(rows.filter((r) => r.unrankedReason?.kind === "no_sales").length, 2);
});

test("within category: exactly the minimum is rankable", () => {
  const rows = classifyWithinCategory(["a", "b", "c", "d", "e"].map((x, i) => dish(x, "g", 10 + i * 20, 50 + i * 10)));
  assert.ok(rows.every((r) => r.menuClass !== "Unranked"));
});

test("within category: a dish with no sales is 'no sales' even in a big category", () => {
  const all = [...["a", "b", "c", "d", "e"].map((x) => dish(x, "g", 10, 50)), dish("new", "g", 0, 80)];
  const r = byId(classifyWithinCategory(all)).get("new")!;
  assert.equal(r.menuClass, "Unranked");
  assert.deepEqual(r.unrankedReason, { kind: "no_sales" });
  assert.equal(unrankedReasonText(r.unrankedReason!), "ยังไม่มียอดขาย");
});

test("within category: dishes with no category form one group, and the reason says so", () => {
  const rows = classifyWithinCategory([dish("test", null, 1, -10)]);
  assert.equal(rows[0]!.group, null);
  assert.match(unrankedReasonText(rows[0]!.unrankedReason!), /^เมนูที่ไม่มีหมวด มีเมนูที่มียอดขาย 1 รายการ/);
});

test("within category: output keeps the input order", () => {
  const all = [dish("x1", "b", 1, 1), dish("y1", "a", 1, 1), dish("x2", "b", 1, 1)];
  assert.deepEqual(classifyWithinCategory(all).map((r) => r.menu.id), ["x1", "y1", "x2"]);
});
