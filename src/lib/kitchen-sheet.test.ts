/** Run with: npm test — the kitchen function sheet's rules (document B). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { thWeekdayFullDate, kitchenHeading, priceCell, perTableQty } from "./kitchen-sheet.ts";

test("the date form is the paper sheet's, not the app's usual one", () => {
  // The example on Nik's paper sheet, to the character.
  assert.equal(thWeekdayFullDate("2026-07-01"), "วันพุธที่ 1 ก.ค. 2569");
});

test("every weekday renders, and the year is Buddhist", () => {
  // 2026-07-01 is a Wednesday; walk the seven days from the Sunday before.
  const days = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];
  const isos = ["2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];
  isos.forEach((iso, i) => {
    assert.ok(thWeekdayFullDate(iso).startsWith(days[i] + "ที่"), `${iso} -> ${thWeekdayFullDate(iso)}`);
  });
  assert.ok(thWeekdayFullDate("2026-07-01").endsWith("2569"));
});

test("all twelve months are abbreviated as the sheet writes them", () => {
  const want = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  want.forEach((m, i) => {
    const iso = `2026-${String(i + 1).padStart(2, "0")}-15`;
    assert.ok(thWeekdayFullDate(iso).includes(` ${m} `), `${iso} should contain ${m}`);
  });
});

test("blue is ภายใน and red is ภายนอก — the colour rule keys on location_type", () => {
  assert.deepEqual(kitchenHeading("in_house"), { text: "งานจัดเลี้ยงภายใน", offsite: false });
  assert.deepEqual(kitchenHeading("offsite"), { text: "งานจัดเลี้ยงภายนอก", offsite: true });
});

test("an unknown location_type reads as ภายนอก rather than ภายใน", () => {
  // Fail safe: a job the kitchen wrongly believes is in-house is the worse
  // error — nobody loads a van for it.
  assert.equal(kitchenHeading("").offsite, true);
  assert.equal(kitchenHeading("something_new").offsite, true);
});

test("ราคา prints literally and is never multiplied", () => {
  assert.equal(priceCell(485, 6), "485 x 6");
  assert.equal(priceCell(590, 6), "590 x 6");
  // The number that must NOT appear anywhere.
  assert.notEqual(priceCell(485, 6), "2910");
  assert.ok(!priceCell(485, 6)!.includes("2,910"));
});

test("no table count leaves the portion price standing alone", () => {
  assert.equal(priceCell(485, null), "485");
  assert.equal(priceCell(485, 0), "485");
});

test("a dish with no price is blank, never a portion size of zero", () => {
  assert.equal(priceCell(0, 6), null);
  assert.equal(priceCell(null, 6), null);
  assert.equal(priceCell(-1, 6), null);
});

test("prices print without ฿ and without forced decimals", () => {
  assert.equal(priceCell(1000, 6), "1,000 x 6");
  assert.equal(priceCell(547.06, 6), "547.06 x 6");
  assert.equal(priceCell(200, 1), "200 x 1");
  assert.ok(!priceCell(485, 6)!.includes("฿"));
  assert.ok(!priceCell(485, 6)!.includes(".00"));
});

test("a dish served more than once per table says so beside the name", () => {
  // setโต๊ะพรีเมี่ยม really does carry กุ้งแก้ว (เล็ก) at quantity 5.
  assert.equal(perTableQty(5), "5 ที่/โต๊ะ");
  assert.equal(perTableQty(2), "2 ที่/โต๊ะ");
});

test("the ordinary one-per-table dish says nothing at all", () => {
  assert.equal(perTableQty(1), null);
  assert.equal(perTableQty(0), null);
});
