/**
 * Run with: npm test — the booking's food cost, as the cost page shows it and
 * the cost lock freezes it (./food-cost.ts, one computation for both).
 *
 * Nik, 2026-09-25: a typed dish (not in the menu list) has no cost unless
 * owner or admin linked it to a real menu; a set line with no dishes is
 * flagged, never ฿0; a per-head line is left out and flagged, because no
 * kitchen count per guest exists yet. Each rule is first shown to matter: the
 * figure an unflagged version would give is asserted to differ.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventFoodCost, foodCostGapLines, snapshotGapLines, type PortionCost } from "./food-cost.ts";
import type { EventMenuDish } from "../../menu-lines.ts";

const portion = (total: number): PortionCost => ({ ingredientCost: total * 0.9, qFactorAmount: total * 0.1, totalCost: total, hasUnknownCost: false });
const COSTS: Record<string, PortionCost> = { "m-fish": portion(100), "m-rice": portion(10) };
const costOf = (id: string) => COSTS[id] ?? null;

const menuDish = (id: string, qty: number): EventMenuDish => ({
  id: "r-" + id, menu_id: id, menu_name: id, selling_price: 0, quantity: qty, section: "dish", sort_order: 10, note: null,
});
const typedDish = (name: string, qty: number, link: string | null = null): EventMenuDish => ({
  id: "r-" + name, menu_id: null, dish_name: name, linked_menu_id: link, menu_name: name, selling_price: 0, quantity: qty, section: "dish", sort_order: 10, note: null,
});
const setLine = (id: string, quantity: number, per_head = false) => ({ id, menu_id: null, name: "ชุด " + id, quantity, per_head });

test("a set: each course × portions per set × sets; a single dish line × its quantity", () => {
  const lines = [setLine("S", 10), { id: "D", menu_id: "m-rice", name: "ข้าว", quantity: 3 }];
  const c = eventFoodCost(lines, new Map([["S", { dishes: [menuDish("m-fish", 2)] }]]), costOf);
  assert.equal(c.totalFoodCost, 100 * 2 * 10 + 10 * 3);
  assert.equal(c.hasUnknownCost, false);
  assert.deepEqual(foodCostGapLines(c.gaps), []);
});

test("a TYPED dish with no link is a gap, counted — never ฿0 and silent", () => {
  const c = eventFoodCost([setLine("S", 5)], new Map([["S", { dishes: [menuDish("m-fish", 1), typedDish("ห่อหมก", 2)] }]]), costOf);
  assert.equal(c.totalFoodCost, 500, "only the menu dish is counted");
  assert.equal(c.hasUnknownCost, true);
  assert.equal(c.gaps.typedWithoutCost, 1);
  assert.match(foodCostGapLines(c.gaps).join(" "), /พิมพ์เอง 1 รายการ/);
  assert.ok(c.lineItems.some((i) => i.name === "ห่อหมก" && i.has_unknown_cost && i.total_cost === 0), "the snapshot marks it");
});

test("a typed dish LINKED to a real menu costs as that menu; its typed name is the item's name", () => {
  const c = eventFoodCost([setLine("S", 5)], new Map([["S", { dishes: [typedDish("ปลาทอดราดพริก", 1, "m-fish")] }]]), costOf);
  assert.equal(c.totalFoodCost, 500);
  assert.equal(c.hasUnknownCost, false);
  assert.equal(c.gaps.typedWithoutCost, 0);
  assert.equal(c.lineItems[0]!.name, "ปลาทอดราดพริก");
});

test("a set line with NO dishes is flagged, never added as ฿0 (the 380 buffet set had none)", () => {
  const c = eventFoodCost([setLine("E", 1)], new Map([["E", { dishes: [] }]]), costOf);
  assert.equal(c.hasUnknownCost, true, "an unflagged version would call this booking complete at ฿0");
  assert.deepEqual(c.gaps.emptySetLines, ["ชุด E"]);
  assert.match(foodCostGapLines(c.gaps).join(" "), /ยังไม่มีรายการอาหาร 1 รายการ/);
});

test("a PER-HEAD line is left out of the figure and flagged: no kitchen count per guest exists", () => {
  const dishes = new Map([["H", { dishes: [menuDish("m-fish", 1)] }]]);
  const c = eventFoodCost([setLine("H", 30, true)], dishes, costOf);
  assert.equal(c.totalFoodCost, 0, "not 100 × 1 × 30 guests = 3,000, which would read portions per set as portions per guest");
  assert.notEqual(eventFoodCost([setLine("H", 30, false)], dishes, costOf).totalFoodCost, 0, "the same line per table IS counted");
  assert.equal(c.hasUnknownCost, true);
  assert.deepEqual(c.gaps.perHeadLines, ["ชุด H"]);
  assert.match(foodCostGapLines(c.gaps)[0]!, /ราคาต่อท่าน 1 รายการ/);
});

test("a menu that no longer exists is a gap, never skipped", () => {
  const c = eventFoodCost([{ id: "D", menu_id: "m-gone", name: "หายไป", quantity: 1 }], new Map(), costOf);
  assert.equal(c.hasUnknownCost, true);
  assert.equal(c.gaps.missingMenus, 1);
});

test("a LOCKED booking names what its frozen figure counted as ฿0", () => {
  const c = eventFoodCost([setLine("H", 30, true), setLine("S", 1)], new Map([["S", { dishes: [menuDish("m-fish", 1), typedDish("ห่อหมก", 1)] }]]), costOf);
  const lines = snapshotGapLines(c.lineItems);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /2 รายการ/);
  assert.match(lines[0]!, /ชุด H/);
  assert.match(lines[0]!, /ห่อหมก/);
  assert.doesNotMatch(lines[0]!, /m-fish/, "a dish with a cost is not a gap");
  assert.deepEqual(snapshotGapLines(eventFoodCost([setLine("S", 1)], new Map([["S", { dishes: [menuDish("m-fish", 1)] }]]), costOf).lineItems), []);
});
