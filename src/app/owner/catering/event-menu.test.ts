/**
 * Run with: npm test — the figures on a booking's own menu, and what reaches
 * the browser.
 *
 * The two worked examples are Nik's: 4,800 of dishes sold as a 4,500 set is
 * 6.25% off (sales may see it); 2,000 of cost against 4,500 is 44.44% (owner
 * and admin only). The last test is the payload: the view a sales session is
 * sent carries no cost, even when a cost was handed to the builder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEventMenuLines, buildEventMenuView, discountFigure, discountText, dishesTotalPerTable, foodCostFigure,
  isSetLine, resolveDishes, swapPriceWarning, swapWarningText, SWAP_WARN_RATIO,
  type EventMenuDish, type EventMenuLine,
} from "./event-menu.ts";

const dish = (menu_name: string, selling_price: number, quantity = 1, section = "dish", id = menu_name): EventMenuDish => ({
  id, menu_id: `m-${id}`, menu_name, selling_price, quantity, section, sort_order: 0, note: null,
});
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.005, `${what}: ${a} vs ${b}`);

test("NIK'S EXAMPLE: dishes worth 4,800 sold as a 4,500 set is 6.25% off", () => {
  const dishes = [dish("ปลากะพงทอดน้ำปลา", 1200), dish("กุ้งอบวุ้นเส้น", 900), dish("เป็ดปักกิ่ง", 1500), dish("ผัดผัก", 400), dish("ข้าวผัด", 800)];
  assert.equal(dishesTotalPerTable(dishes), 4800);
  const fig = discountFigure(4800, 4500)!;
  assert.equal(fig.amount, 300);
  near(fig.pct, 6.25, "discount %");
  assert.match(discountText(fig), /ลด 6\.25%/);
});

test("NIK'S OTHER EXAMPLE: cost 2,000 against 4,500 is 44.44%", () => {
  const fig = foodCostFigure(2000, 4500);
  near(fig.pct!, 44.44, "food cost %");
  assert.equal(foodCostFigure(2000, null).pct, null, "no price, no percentage");
  assert.equal(foodCostFigure(2000, 0).pct, null);
});

test("a set that sells for more than its dishes says so; no dishes says nothing", () => {
  const fig = discountFigure(4000, 4500)!;
  assert.ok(fig.amount < 0);
  assert.match(discountText(fig), /แพงกว่าราคาแยก 12\.50%/);
  assert.equal(discountFigure(0, 4500), null);
  assert.equal(discountFigure(4800, null), null);
  assert.match(discountText(null), /ยังคำนวณส่วนลดไม่ได้/);
  assert.match(discountText(discountFigure(4500, 4500)), /เท่ากับราคาเมนูแยกพอดี/);
  // Per-table quantities count: two portions of a 400 dish is 800.
  assert.equal(dishesTotalPerTable([dish("ผัดผัก", 400, 2)]), 800);
});

test("a swap is flagged past 10%, in either direction, and exactly 10% is not past it", () => {
  assert.equal(SWAP_WARN_RATIO, 0.1);
  assert.equal(swapPriceWarning(1000, 1100).warn, false, "exactly +10%");
  assert.equal(swapPriceWarning(1000, 900).warn, false, "exactly -10%");
  assert.equal(swapPriceWarning(1000, 1101).warn, true);
  assert.equal(swapPriceWarning(1000, 899).warn, true);
  assert.equal(swapPriceWarning(1000, 1000).warn, false);
  assert.equal(swapPriceWarning(0, 500).warn, false, "no old price, nothing to compare against");
  assert.equal(swapPriceWarning(NaN, 500).warn, false);
  near(swapPriceWarning(1200, 1500).diffPct!, 25, "diff %");
  const text = swapWarningText("ปลากะพงทอดน้ำปลา", 1200, "ปลากะพงอบเกลือ", 1500);
  assert.match(text, /แพงกว่า/);
  assert.match(text, /25\.0%/);
  assert.match(text, /เกิน 10%/);
  assert.match(swapWarningText("A", 1500, "B", 1200), /ถูกกว่า/);
});

test("the copy is the record; a booking from before the feature falls back to the shared set", () => {
  const copy = [dish("copied", 100)];
  const shared = [dish("shared", 100)];
  assert.deepEqual(resolveDishes(copy, shared, true), { source: "copy", dishes: copy });
  assert.deepEqual(resolveDishes(undefined, shared, false), { source: "shared", dishes: shared }, "never copied: the shared set, as before");
  assert.deepEqual(resolveDishes(undefined, undefined, false), { source: "none", dishes: [] });
  assert.deepEqual(resolveDishes([], [], false), { source: "none", dishes: [] });
  // Rows without the marker (a direct insert) still count as a copy.
  assert.deepEqual(resolveDishes(copy, shared, false), { source: "copy", dishes: copy });
});

test("THE REVIEW'S HOLE: a copy emptied to zero rows is still a copy, not a fall-back to the shared set", () => {
  const shared = [dish("shared", 100)];
  // Before the fix this returned the shared set: the owner deleted every
  // course to rebuild the set, and every sheet printed the shared set instead.
  assert.deepEqual(resolveDishes([], shared, true), { source: "copy", dishes: [] });
  assert.deepEqual(resolveDishes(undefined, shared, true), { source: "copy", dishes: [] });
});

test("a set line is one with a shared source, or one naming no dish (a custom set); a dish line names a dish", () => {
  assert.equal(isSetLine({ set_menu_id: "s1", menu_id: null }), true, "copied from a shared set");
  assert.equal(isSetLine({ set_menu_id: null, menu_id: null }), true, "a custom set: neither, by the widened CHECK");
  assert.equal(isSetLine({ set_menu_id: null, menu_id: "m1" }), false, "a single dish");
});

test("the page's lines carry the charge's price per table and the resolved dishes; dish lines are left out", () => {
  const menus = [
    { id: "L1", set_menu_id: "s1", menu_id: null, name: "ชุด 4,500", quantity: 10 },
    { id: "L2", set_menu_id: null, menu_id: null, name: "ชุดพิเศษ", quantity: 2 },
    { id: "D1", set_menu_id: null, menu_id: "m9", name: "ข้าวผัดกุ้ง", quantity: 10 },
  ];
  const charges = [
    { event_menu_id: "L1", unit_price: 4500 },
    { event_menu_id: "L2", unit_price: 3000 },
    { event_menu_id: "D1", unit_price: 160 },
    { event_menu_id: null, unit_price: 2000 },
  ];
  const dishes = new Map([["L1", { source: "copy" as const, dishes: [dish("ปลากะพง", 1200)] }]]);
  const lines = buildEventMenuLines(menus, charges, dishes);
  assert.deepEqual(lines.map((l) => l.id), ["L1", "L2"]);
  assert.equal(lines[0]!.pricePerTable, 4500);
  assert.equal(lines[0]!.tables, 10);
  assert.equal(lines[0]!.source, "copy");
  assert.equal(lines[0]!.sourceSetMenuId, "s1");
  assert.equal(lines[1]!.pricePerTable, 3000);
  assert.equal(lines[1]!.source, "none", "a custom set with no dishes yet");
  assert.equal(lines[1]!.sourceSetMenuId, null);
});

test("THE PAYLOAD: a sales session is never sent a cost, even when the builder is handed one", () => {
  const line: EventMenuLine = {
    id: "L1", name: "ชุด 4,500", tables: 10, pricePerTable: 4500, sourceSetMenuId: "s1", source: "copy",
    dishes: [dish("ปลากะพง", 1200)],
  };
  const cost = { L1: { costPerTable: 2000, pct: 44.44, hasUnknownCost: false } };

  const sales = buildEventMenuView({ access: "view", locked: false, lines: [line], costByLine: cost });
  assert.equal(sales.costByLine, null, "the cost is dropped for a viewer");
  assert.equal(sales.canEdit, false);
  assert.ok(!JSON.stringify(sales).includes("2000"), "and no cost figure survives serialisation");
  assert.ok(JSON.stringify(sales).includes("4500"), "while the customer price, which sales may see, does");

  const admin = buildEventMenuView({ access: "edit", locked: false, lines: [line], costByLine: cost });
  assert.deepEqual(admin.costByLine, cost);
  assert.equal(admin.canEdit, true);

  const lockedAdmin = buildEventMenuView({ access: "edit", locked: true, lines: [line], costByLine: cost });
  assert.equal(lockedAdmin.canEdit, false, "a locked booking's menu is frozen for everyone");
  assert.equal(lockedAdmin.locked, true);
  assert.deepEqual(lockedAdmin.costByLine, cost, "frozen, not hidden: the owner still reads the cost");

  assert.equal(buildEventMenuView({ access: "none", locked: false, lines: [line], costByLine: cost }).costByLine, null);
});
