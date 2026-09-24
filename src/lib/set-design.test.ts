/** Run with: npm test — the set-menu design workspace's figures and moves (Nik, 2026-09-24). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDish, copyDish, designFigures, moveDish, parseDesignPrice, removeDish, swapDish,
  type DesignDish, type DishFacts,
} from "./set-design.ts";

const facts = new Map<string, DishFacts>([
  ["fish", { name: "ปลากะพงนึ่ง", selling_price: 450, unit_cost: 180, has_unknown_cost: false }],
  ["soup", { name: "ต้มยำ", selling_price: 300, unit_cost: 90.5, has_unknown_cost: false }],
  ["dessert", { name: "บัวลอย", selling_price: 80, unit_cost: 20, has_unknown_cost: true }],
]);
const d = (menu_id: string, quantity = 1, section = "dish"): DesignDish => ({ menu_id, quantity, section, note: null });

test("the figures: cost and à-la-carte per table, food-cost % and margin against the price", () => {
  const f = designFigures([d("fish", 2), d("soup", 1)], 1500, facts);
  assert.equal(f.costPerTable, 450.5);     // 2 × 180 + 90.5
  assert.equal(f.dishesTotal, 1200);       // 2 × 450 + 300
  assert.equal(f.foodCostPct, 30.03);      // 450.5 / 1500
  assert.equal(f.margin, 1049.5);
  assert.equal(f.hasUnknownCost, false);
});

test("the figures follow the price at once, and there is no percentage without one", () => {
  const items = [d("fish", 2)];
  assert.equal(designFigures(items, 1000, facts).foodCostPct, 36);
  assert.equal(designFigures(items, 720, facts).foodCostPct, 50);
  assert.equal(designFigures(items, 0, facts).foodCostPct, null);
});

test("an unknown cost is flagged, as the set editor flags it; so is a dish the page does not know", () => {
  assert.equal(designFigures([d("dessert")], 100, facts).hasUnknownCost, true);
  assert.equal(designFigures([d("gone")], 100, facts).hasUnknownCost, true);
});

test("a set holds each dish once: adding it again adds portions", () => {
  const items = addDish(addDish([], d("fish", 1)), d("fish", 0.5));
  assert.deepEqual(items, [d("fish", 1.5)]);
});

test("swap keeps the portions, section and note; swapping to a dish already there merges", () => {
  const items: DesignDish[] = [{ menu_id: "fish", quantity: 2, section: "dish", note: "นึ่งมะนาว" }, d("soup", 1)];
  assert.deepEqual(swapDish(items, 0, "dessert"), [d("soup", 1), { menu_id: "dessert", quantity: 2, section: "dish", note: "นึ่งมะนาว" }]);
  assert.deepEqual(swapDish(items, 0, "soup"), [{ ...d("soup", 3) }]);
  assert.equal(swapDish(items, 0, "fish"), items);
});

test("copy leaves the source; move takes the dish out of it; both merge into the target", () => {
  const a = [d("fish", 2), d("soup", 1)];
  const b = [d("soup", 1)];
  assert.deepEqual(copyDish(a, 1, b), [d("soup", 2)]);
  const [a2, b2] = moveDish(a, 0, b);
  assert.deepEqual(a2, [d("soup", 1)]);
  assert.deepEqual(b2, [d("soup", 1), d("fish", 2)]);
  assert.deepEqual(removeDish(a, 5), a);
});

test("the price: a plain number up to 10,000,000 with at most two decimals", () => {
  assert.equal(parseDesignPrice("3,500"), 3500);
  assert.equal(parseDesignPrice(" 3999.50 "), 3999.5);
  for (const bad of ["", "-1", "abc", "1.234", "20000000"]) assert.equal(parseDesignPrice(bad), null, bad);
});
