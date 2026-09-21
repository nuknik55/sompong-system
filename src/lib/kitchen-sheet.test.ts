/** Run with: npm test — the kitchen function sheet's rules (document B). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  thWeekdayFullDate, kitchenHeading, priceCell, plateCount, amountCell, fmtQty, weightSoldMenuIds,
  setCountUnit, splitAmount, dishAmount, dishPrice, AMOUNT_TOTAL_SEPARATOR,
} from "./kitchen-sheet.ts";

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

test("plateCount is per-set count x sets ordered — the three-readings rule", () => {
  assert.equal(plateCount(1, 10), 10, "Nik: the chef cooks 10 plates");
  assert.equal(plateCount(5, 6), 30);
  // The paper example that could NOT distinguish the three readings: 1 x 6
  // equals per-set-alone-with-6-tables AND table-count-6. Only q!=1 or
  // sets!=1 separates them.
  assert.equal(plateCount(1, 6), 6);
});

test("ราคา IS THE PRICE ALONE — the size to plate, never multiplied", () => {
  assert.equal(priceCell(180), "180");
  assert.equal(priceCell(200), "200");
  assert.equal(priceCell(1000), "1,000");
  assert.equal(priceCell(547.06), "547.06");
  assert.ok(!priceCell(485)!.includes("฿"));
  assert.ok(!priceCell(485)!.includes(".00"));
});

test("A DISH SOLD BY WEIGHT IS PRICED PER KILO, AND SAYS SO", () => {
  assert.equal(priceCell(1000, true), "1,000/กก.");
});

test("a dish with no price is blank, never a portion size of zero", () => {
  assert.equal(priceCell(0), null);
  assert.equal(priceCell(null), null);
  assert.equal(priceCell(-1), null);
});

test("จำนวน: PER TABLE AND TABLES SEPARATELY, THEN THE TOTAL", () => {
  assert.equal(amountCell(1, 10), "1 × 10 โต๊ะ = 10", "Nik's 10-set booking: 10 plates, 1 a table");
  assert.equal(amountCell(5, 10), "5 × 10 โต๊ะ = 50", "กุ้งแก้ว (เล็ก) at 5 a table");
});

test("HALF A KILO FOR 20 TABLES READS AS HALF A KILO A TABLE — the reason for the change", () => {
  assert.equal(amountCell(0.5, 20, true), "0.5 กก. × 20 โต๊ะ = 10 กก.");
  // It used to print "1,000 x 10", which the chef read as ten one-kilo
  // plates: the price cell must carry no count, and the per-table half
  // kilo must lead the quantity cell.
  assert.ok(!/[x×]|10/.test(priceCell(1000, true)!), "no count in the price cell");
  assert.equal(splitAmount(amountCell(0.5, 20, true)!)[0], "0.5 กก. × 20 โต๊ะ");
});

test("NO FLOATING-POINT TAILS: quantities round to three decimals", () => {
  assert.equal(amountCell(0.1, 3, true), "0.1 กก. × 3 โต๊ะ = 0.3 กก.");
  assert.equal(amountCell(0.3, 3), "0.3 × 3 โต๊ะ = 0.9");
  assert.equal(fmtQty(0.1 * 3), "0.3");
  // The row must add up AS PRINTED: 0.333 × 3 is 0.999, never "= 1".
  assert.equal(amountCell(1 / 3, 3), "0.333 × 3 โต๊ะ = 0.999");
  assert.equal(amountCell(0.1255, 2, true), "0.126 กก. × 2 โต๊ะ = 0.252 กก.");
  assert.equal(fmtQty(0.125), "0.125");
  assert.equal(fmtQty(1500), "1,500");
});

test("ONE TABLE, OR A DISH ORDERED DIRECTLY: just the quantity", () => {
  assert.equal(amountCell(2, 1), "2");
  assert.equal(amountCell(0.5, 1, true), "0.5 กก.");
  // รายการอาหารเพิ่มเติม: the line quantity already is the whole job.
  assert.equal(amountCell(10, null), "10", "ข้าวผัดกุ้ง (กลาง) x 10 on the real booking");
  assert.equal(amountCell(2, null, true), "2 กก.");
});

test("a quantity of zero or less prints blank — and so does a set count of zero or less", () => {
  assert.equal(amountCell(0, 10), null);
  assert.equal(amountCell(-1, 10), null);
  assert.equal(amountCell(5, 0), null, "not '5', which would read as the whole job");
  assert.equal(amountCell(5, -2), null);
  assert.equal(amountCell(0.0004, null), null, "rounds to 0: blank, never a printed 0");
});

test("THE COUNT'S UNIT FOLLOWS THE FOOD FORMAT: tables, boxes, or sets", () => {
  assert.equal(setCountUnit("chinese_table"), "โต๊ะ");
  assert.equal(setCountUnit("box_set"), "กล่อง");
  assert.equal(setCountUnit("set_menu"), "ชุด");
  assert.equal(setCountUnit("buffet"), "ชุด");
  assert.equal(setCountUnit(null), "ชุด");
  assert.equal(amountCell(1, 200, false, setCountUnit("box_set")), "1 × 200 กล่อง = 200");
});

test("THE LINE BREAKS ONLY AT THE TOTAL", () => {
  assert.deepEqual(splitAmount("0.5 กก. × 20 โต๊ะ = 10 กก."), ["0.5 กก. × 20 โต๊ะ", "= 10 กก."]);
  assert.deepEqual(splitAmount("2 กก."), ["2 กก.", null]);
  // amountCell writes exactly the separator splitAmount breaks on.
  assert.ok(amountCell(1, 10)!.includes(AMOUNT_TOTAL_SEPARATOR));
});

test("BOTH SHEETS PRINT THROUGH ONE FUNCTION: the weight comes from the dish's menu", () => {
  const kilo = new Set(["m-prawn"]);
  const table = "chinese_table";
  assert.equal(dishAmount({ quantity: 0.5, menu_id: "m-prawn" }, 20, kilo, table), "0.5 กก. × 20 โต๊ะ = 10 กก.");
  assert.equal(dishAmount({ quantity: 1, menu_id: "m-rice" }, 20, kilo, table), "1 × 20 โต๊ะ = 20");
  assert.equal(dishAmount({ quantity: 2, menu_id: "m-prawn" }, null, kilo, table), "2 กก.", "a dish ordered directly");
  assert.equal(dishAmount({ quantity: 2, menu_id: null }, null, kilo, table), "2", "no menu: never kilos");
  assert.equal(dishPrice(1000, "m-prawn", kilo), "1,000/กก.");
  assert.equal(dishPrice(160, "m-rice", kilo), "160");
});

test("THE PER-TABLE COUNT IS PRINTED ONCE in the จำนวน cell (the name column carries none: the page passes the name alone)", () => {
  // setโต๊ะพรีเมี่ยม carries กุ้งแก้ว (เล็ก) at 5 a table. The old
  // "(5 ที่/โต๊ะ)" annotation beside the name stays gone: printing the same
  // number twice on one row invites the chef to multiply them.
  const tokens = amountCell(5, 10)!.split(" ");
  assert.equal(tokens.filter((t) => t === "5").length, 1, "the per-table 5 appears once");
  assert.equal(tokens[tokens.length - 1], "50", "and the row ends with the total");
});

test("WHICH DISHES PRINT IN KILOS: a ÷10 POS divisor, and nothing else", () => {
  const ids = weightSoldMenuIds([
    { menu_id: "prawn-grill", divisor: 10 },       // กุ้งก้ามกรามเผา, counted in ขีด
    { menu_id: "prawn-grill", divisor: 1 },        // its 1-กก. button
    { menu_id: "prawn-grill", divisor: 2 },        // its 5-ขีด button
    { menu_id: "river-prawn", divisor: 4 },        // one 4-ขีด plate: the exception
    { menu_id: "hor-mok", divisor: 4 },            // ห่อหมก1กระทง, a portion
    { menu_id: "other-spelling", divisor: 1 },
  ]);
  assert.deepEqual([...ids], ["prawn-grill"]);
});
