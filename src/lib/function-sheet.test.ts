/** Run with: npm test — the service function sheet's two rules (document A). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupBySection, moneyFields } from "./function-sheet.ts";

/** Mirrors SET_MENU_SECTIONS in the catering module — order is print order. */
const SECTIONS = [
  { value: "dish", label: "รายการอาหาร" },
  { value: "dessert", label: "ขนมหวาน" },
  { value: "drink", label: "เครื่องดื่ม" },
  { value: "free", label: "รายการแถมฟรี" },
];

const row = (id: string, section: string, menu_name = id) => ({
  id, menu_name, quantity: 1, note: null, section,
});

test("sections print in SET_MENU_SECTIONS order, not insertion order", () => {
  const groups = groupBySection(
    [row("a", "free"), row("b", "dish"), row("c", "drink"), row("d", "dessert")],
    SECTIONS,
  );
  assert.deepEqual(groups.map((g) => g.key), ["dish", "dessert", "drink", "free"]);
});

test("a section with no rows prints NOTHING — no heading, no empty group", () => {
  // The package everything else in this module is built around: dishes only.
  const groups = groupBySection([row("a", "dish"), row("b", "dish")], SECTIONS);
  assert.deepEqual(groups.map((g) => g.key), ["dish"]);
  assert.equal(groups.length, 1, "the other three sections must not appear at all");
  assert.equal(groups[0].lines.length, 2);
});

test("a package with no rows at all yields no groups, not four empty ones", () => {
  assert.deepEqual(groupBySection([], SECTIONS), []);
});

test("every section populated gives all four, each with only its own rows", () => {
  const groups = groupBySection(
    [row("d1", "dish"), row("d2", "dish"), row("s1", "dessert"), row("k1", "drink"), row("f1", "free"), row("f2", "free")],
    SECTIONS,
  );
  assert.deepEqual(groups.map((g) => [g.key, g.lines.length]), [
    ["dish", 2], ["dessert", 1], ["drink", 1], ["free", 2],
  ]);
});

test("a row with an unknown section is dropped, not given a heading of its own", () => {
  // Unreachable through the CHECK constraint; asserted so a future widening of
  // the constraint without widening SET_MENU_SECTIONS fails here rather than
  // printing an unnamed group on a document.
  const groups = groupBySection([row("a", "dish"), row("x", "beverage")], SECTIONS);
  assert.deepEqual(groups.map((g) => g.key), ["dish"]);
  assert.equal(groups[0].lines.length, 1);
});

test("line fields carry through, note included", () => {
  const groups = groupBySection(
    [{ id: "i1", menu_name: "ปลากะพงนึ่งมะนาว", quantity: 3, note: "ไม่ใส่ผัก", section: "dish" }],
    SECTIONS,
  );
  assert.deepEqual(groups[0].lines[0], {
    id: "i1", name: "ปลากะพงนึ่งมะนาว", quantity: 3, note: "ไม่ใส่ผัก",
  });
});

test("the four money fields are always four, in the paper form's order", () => {
  const fields = moneyFields([], null);
  assert.deepEqual(fields.map((f) => f.label), ["ค่าขนส่ง", "Service", "ค่าไฟ", "ค่ามัดจำ"]);
});

test("no charge of a type gives a ruled line (null), not ฿0", () => {
  const fields = moneyFields([], null);
  assert.deepEqual(fields.map((f) => f.amount), [null, null, null, null]);
});

test("a charge that sums to zero PRINTS as 0 — somebody entered it", () => {
  const fields = moneyFields([{ charge_type: "transport", amount: 0 }], null);
  assert.equal(fields[0].amount, 0, "0 is a decision; null is an unanswered question");
  assert.notEqual(fields[0].amount, null);
});

test("several charges of one type are summed", () => {
  const fields = moneyFields(
    [{ charge_type: "transport", amount: 300 }, { charge_type: "transport", amount: 450 }],
    null,
  );
  assert.equal(fields[0].amount, 750);
});

test("each field reads only its own charge type", () => {
  const fields = moneyFields(
    [
      { charge_type: "transport", amount: 500 },
      { charge_type: "service", amount: 1200 },
      { charge_type: "other", amount: 9999 },
      { charge_type: "food", amount: 30000 },
      { charge_type: "discount", amount: -500 },
    ],
    2500,
  );
  assert.deepEqual(fields.map((f) => f.amount), [500, 1200, null, 2500]);
});

test("ค่าไฟ stays a ruled line even when an 'other' charge exists", () => {
  // The band's electricity lands in 'other' via rate_type 'music'. Printing
  // that figure would also print เบี้ยเลี้ยง and every อื่นๆ line as ค่าไฟ.
  const fields = moneyFields([{ charge_type: "other", amount: 3000 }], null);
  assert.equal(fields[2].label, "ค่าไฟ");
  assert.equal(fields[2].amount, null);
});

test("ค่ามัดจำ comes from the event, and 0 deposit prints as 0", () => {
  assert.equal(moneyFields([], 0)[3].amount, 0);
  assert.equal(moneyFields([], 5000)[3].amount, 5000);
  assert.equal(moneyFields([], null)[3].amount, null);
});
