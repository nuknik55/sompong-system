/** Run with: npm test — the menu card on each table (README item 39, Nik 2026-09-24). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIT_STEPS,
  MAX_COPIES,
  MENU_CARD_DEFAULT_TITLE,
  buildMenuCard,
  defaultCopies,
  manualLinesProblem,
  parseCopies,
  parseManualLines,
  storedManualLines,
  thaiLongDate,
  type MenuCardInput,
} from "./menu-card.ts";

const SECTIONS = [
  { value: "dish", label: "รายการอาหาร" },
  { value: "dessert", label: "ขนมหวาน" },
  { value: "drink", label: "เครื่องดื่ม" },
  { value: "free", label: "รายการแถมฟรี" },
];
const dish = (id: string, name: string, section: string, note: string | null = null) =>
  ({ id, menu_name: name, quantity: 3, note, section });

const base = (over: Partial<MenuCardInput> = {}): MenuCardInput => ({
  eventTypeLabel: "วันเกิด",
  customerName: "คุณป้อม",
  companyName: null,
  eventDate: "2026-09-18",
  venue: "ห้อง V1",
  setLines: [{
    id: "L1",
    name: "โต๊ะจีน ชุด A",
    dishes: [
      dish("d1", "ออร์เดิร์ฟรวม", "dish", "ครัว: ไม่ใส่ผักชี"),
      dish("d2", "ปลากะพงนึ่งมะนาว", "dish"),
      dish("d3", "บัวลอยไข่หวาน", "dessert"),
    ],
  }],
  extraNames: ["ปูม้านึ่ง"],
  sections: SECTIONS,
  ...over,
});

test("the card: the set's courses grouped by section in print order, then the extras", () => {
  const card = buildMenuCard(base());
  assert.equal(card.title, "วันเกิด");
  assert.equal(card.host, "คุณป้อม");
  assert.equal(card.date, "วันศุกร์ที่ 18 กันยายน 2569");
  assert.equal(card.venue, "ห้อง V1");
  assert.deepEqual(card.blocks, [{
    key: "L1",
    heading: null,
    sections: [
      { key: "dish", label: "รายการอาหาร", items: ["ออร์เดิร์ฟรวม", "ปลากะพงนึ่งมะนาว"] },
      { key: "dessert", label: "ขนมหวาน", items: ["บัวลอยไข่หวาน"] },
    ],
  }]);
  assert.deepEqual(card.extras, ["ปูม้านึ่ง"]);
});

test("NAMES ONLY: no price, no quantity, no kitchen note reaches the card", () => {
  const card = buildMenuCard(base({
    setLines: [{ id: "L1", name: "ชุด", dishes: [{ ...dish("d1", "ต้มยำกุ้ง", "dish", "ครัว: เผ็ดน้อย"), quantity: 7 }] }],
  }));
  const json = JSON.stringify(card);
  assert.ok(!json.includes("ครัว: เผ็ดน้อย"), "a course's note is for the kitchen");
  assert.ok(!/"(note|quantity|selling_price|price|amount)"/.test(json), json);
  assert.ok(!/\b7\b/.test(json), "the per-table quantity is not printed");
});

test("several sets: each is headed by its name; an empty set is left out, and one set left needs no heading", () => {
  const two = buildMenuCard(base({
    setLines: [
      { id: "L1", name: "ชุดโต๊ะจีน", dishes: [dish("a", "หูฉลาม", "dish")] },
      { id: "L2", name: "ชุดเด็ก", dishes: [dish("b", "ไก่ทอด", "dish")] },
    ],
  }));
  assert.deepEqual(two.blocks.map((b) => b.heading), ["ชุดโต๊ะจีน", "ชุดเด็ก"]);
  const oneLeft = buildMenuCard(base({
    setLines: [
      { id: "L1", name: "ชุดโต๊ะจีน", dishes: [dish("a", "หูฉลาม", "dish")] },
      { id: "L2", name: "ชุดว่าง", dishes: [] },
    ],
  }));
  assert.deepEqual(oneLeft.blocks.map((b) => [b.key, b.heading]), [["L1", null]]);
});

test("the heading: the event type, else a plain title; the host: the company before the person", () => {
  assert.equal(buildMenuCard(base({ eventTypeLabel: null })).title, MENU_CARD_DEFAULT_TITLE);
  assert.equal(buildMenuCard(base({ eventTypeLabel: "  " })).title, MENU_CARD_DEFAULT_TITLE);
  assert.equal(buildMenuCard(base({ companyName: "บริษัท ทดสอบ จำกัด" })).host, "บริษัท ทดสอบ จำกัด");
  assert.equal(buildMenuCard(base({ customerName: null })).host, null);
});

test("the date: weekday, day, full month and Buddhist year, from the calendar date", () => {
  assert.equal(thaiLongDate("2026-09-18"), "วันศุกร์ที่ 18 กันยายน 2569");
  assert.equal(thaiLongDate("2027-01-01"), "วันศุกร์ที่ 1 มกราคม 2570");
  assert.equal(thaiLongDate("2026-10-04"), "วันอาทิตย์ที่ 4 ตุลาคม 2569");
  assert.equal(thaiLongDate("not a date"), "not a date");
});

test("hand-typed lines: one per line, trimmed, blanks dropped; at most 20 lines of 100 characters", () => {
  assert.deepEqual(parseManualLines("  เค้กวันเกิด \r\n\n ผลไม้รวม "), ["เค้กวันเกิด", "ผลไม้รวม"]);
  assert.deepEqual(parseManualLines(null), []);
  assert.equal(storedManualLines("  a \n\n b "), "a\nb");
  assert.equal(storedManualLines(" \n  \n"), null);
  const twenty = Array.from({ length: 20 }, (_, i) => `รายการ ${i + 1}`).join("\n");
  assert.equal(manualLinesProblem(twenty + "\n\n\n"), null);
  assert.match(manualLinesProblem(twenty + "\nเกิน") ?? "", /ไม่เกิน 20 บรรทัด/);
  assert.equal(manualLinesProblem("ก".repeat(100)), null);
  assert.match(manualLinesProblem("สั้น\n" + "ก".repeat(101)) ?? "", /บรรทัดที่ 2/);
});

test("copies: one per table to start, at least one, at most MAX_COPIES; only a whole number is accepted", () => {
  assert.equal(defaultCopies(null), 1);
  assert.equal(defaultCopies(0), 1);
  assert.equal(defaultCopies(12), 12);
  assert.equal(defaultCopies(12.5), 13);
  assert.equal(defaultCopies(10_000), MAX_COPIES);
  assert.equal(parseCopies("2"), 2);
  assert.equal(parseCopies(" 14 "), 14);
  for (const bad of ["0", "201", "1.5", "-1", "", "abc"]) assert.equal(parseCopies(bad), null, bad);
});

test("too long for a page: smaller type first, down to 60%, and only then two columns", () => {
  assert.deepEqual(FIT_STEPS[0], { cols: 1, scale: 1 });
  const firstTwo = FIT_STEPS.findIndex((s) => s.cols === 2);
  assert.ok(firstTwo > 0 && FIT_STEPS.slice(0, firstTwo).every((s) => s.cols === 1));
  assert.ok(FIT_STEPS.slice(firstTwo).every((s) => s.cols === 2));
  assert.equal(Math.min(...FIT_STEPS.map((s) => s.scale)), 0.6);
  for (const group of [FIT_STEPS.slice(0, firstTwo), FIT_STEPS.slice(firstTwo)]) {
    for (let i = 1; i < group.length; i++) assert.ok(group[i].scale < group[i - 1].scale);
  }
});
