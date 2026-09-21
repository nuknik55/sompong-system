/**
 * Run with: npm test — the POS sales import's divisors, per source.
 *
 * The August 2569 figures are the real ones: the import on 2026-09-05 gave
 * กุ้งก้ามกรามเผา 94.1 from 56 ขีด ÷10, 64 one-kilo buttons ÷1 and 49
 * half-kilo buttons ÷2, and the tests must reproduce it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { divisibleSource, movedSinceRead, routeSales, sourcesQty, validDivisor, withSessionChanges, type SalesSource } from "./pos-sales-divisor.ts";

const saved = (productName: string, qtySold: number, divisor: number): SalesSource => ({ productName, qtySold, divisor, saved: true });
const direct = (productName: string, qtySold: number): SalesSource => ({ productName, qtySold, divisor: 1, saved: false });

const prawnAugust = [saved("กุ้งก้ามกรามเผา", 56, 10), saved("กุ้งก้ามกรามเผา 1 กก.", 64, 1), saved("กุ้งก้ามกรามเผา 5 ขีด", 49, 2)];

test("EACH SOURCE OVER ITS OWN DIVISOR: August's กุ้งก้ามกรามเผา is 94.1", () => {
  assert.equal(sourcesQty(prawnAugust), 94.1);
});

test("A ROW WHOSE SOURCES ALL HAVE A DIVISOR OFFERS NO หาร", () => {
  assert.equal(divisibleSource(prawnAugust), null);
  assert.equal(divisibleSource([saved("ปูม้าใหญ่นึ่ง", 230, 10)]), null);
});

test("หาร DIVIDES ONLY THE UNSAVED SOURCE, never kilos already converted", () => {
  // The same August row as if "กุ้งก้ามกรามเผา" had no divisor yet.
  const before = [direct("กุ้งก้ามกรามเผา", 56), prawnAugust[1], prawnAugust[2]];
  assert.equal(divisibleSource(before)?.productName, "กุ้งก้ามกรามเผา");
  const after = withSessionChanges(before, 10);
  assert.equal(sourcesQty(after), 94.1);
  // The old button divided the whole row: (56 + 64 + 24.5) / 10.
  assert.notEqual(sourcesQty(after), Math.round(sourcesQty(before) / 10 * 100) / 100);
  assert.equal(divisibleSource(after), null, "and it is not offered again");
});

test("A PLAIN DISH WITH NO DIVISOR COUNTS AS IT STANDS, AND MAY BE DIVIDED", () => {
  const plain = [direct("ข้าวผัดกุ้ง", 120)];
  assert.equal(sourcesQty(plain), 120);
  assert.notEqual(divisibleSource(plain), null);
});

test("A NAME TIED IN THIS SESSION ADDS ITS OWN SHARE", () => {
  const row = [direct("ห่อหมกเนื้อปู", 30)];
  const after = withSessionChanges(row, undefined, [saved("ห่อหมก1กระทง", 8, 4)]);
  assert.equal(sourcesQty(after), 32);
});

test("A DIVISOR MUST BE A NUMBER ABOVE 0", () => {
  assert.equal(validDivisor(10), 10);
  assert.equal(validDivisor(2.5), 2.5);
  assert.equal(validDivisor(0), null);
  assert.equal(validDivisor(-10), null);
  assert.equal(validDivisor(Number.NaN), null);
  assert.equal(validDivisor(Number.POSITIVE_INFINITY), null);
});

test("A DIVISOR IS ROUNDED AS THE COLUMN STORES IT, AND 0.0001 – 1,000 ONLY", () => {
  assert.equal(validDivisor(0.00001), null, "stored as 0: refused, not silently ÷1 later");
  assert.equal(validDivisor(0.00005), 0.0001);
  assert.equal(validDivisor(1.23456), 1.2346);
  assert.equal(validDivisor(1000), 1000);
  assert.equal(validDivisor(1001), null);
});

const menus = [{ id: "m-prawn", name: "กุ้งก้ามกรามเผา" }, { id: "m-rice", name: "ข้าวผัดกุ้ง " }];
const pos = (productName: string, qtySold: number) => ({ productName, qtySold, netRevenue: 0 });

test("ROUTING: a saved divisor wins over the exact name, and is marked saved", () => {
  const { byMenu } = routeSales(
    [pos("กุ้งก้ามกรามเผา", 56), pos("กุ้งก้ามกรามเผา 1 กก.", 64), pos("กุ้งก้ามกรามเผา 5 ขีด", 49)],
    [
      { pos_product_name: "กุ้งก้ามกรามเผา", menu_id: "m-prawn", divisor: 10 },
      { pos_product_name: "กุ้งก้ามกรามเผา 1 กก.", menu_id: "m-prawn", divisor: "1.0000" },
      { pos_product_name: "กุ้งก้ามกรามเผา 5 ขีด ", menu_id: "m-prawn", divisor: 2 },
    ],
    menus,
  );
  const sources = byMenu.get("m-prawn")!.sources;
  assert.ok(sources.every((s) => s.saved), "every name has a divisor: none may be offered หาร");
  assert.equal(sourcesQty(sources), 94.1);
  assert.equal(divisibleSource(sources), null);
});

test("ROUTING: the exact name with no divisor is the one unsaved source", () => {
  const { byMenu } = routeSales([pos(" ข้าวผัดกุ้ง", 120)], [], menus);
  assert.deepEqual(byMenu.get("m-rice")!.sources, [{ productName: "ข้าวผัดกุ้ง", qtySold: 120, divisor: 1, saved: false }]);
});

test("ROUTING: a divisor whose menu is gone falls back to the name, then to unmatched", () => {
  const gone = [{ pos_product_name: "ข้าวผัดกุ้ง", menu_id: "m-deleted", divisor: 10 }];
  assert.equal(routeSales([pos("ข้าวผัดกุ้ง", 5)], gone, menus).byMenu.get("m-rice")!.sources[0].saved, false);
  const { byMenu, unmatched } = routeSales([pos("ห่อหมก1กระทง", 8)], [{ pos_product_name: "ห่อหมก1กระทง", menu_id: "m-deleted", divisor: 4 }], menus);
  assert.equal(byMenu.size, 0);
  assert.deepEqual(unmatched, [{ productName: "ห่อหมก1กระทง", qtySold: 8 }]);
});

test("ROUTING: a stored divisor that is not above 0 counts as 1", () => {
  for (const divisor of [0, null, "abc", -2]) {
    const { byMenu } = routeSales([pos("กุ้งก้ามกรามเผา", 7)], [{ pos_product_name: "กุ้งก้ามกรามเผา", menu_id: "m-prawn", divisor }], menus);
    assert.equal(byMenu.get("m-prawn")!.sources[0].divisor, 1, String(divisor));
  }
});

test("APPLY RE-CHECK: a divisor changed after the file was read is caught; unchanged divisors pass", () => {
  const file = [pos("กุ้งก้ามกรามเผา", 56), pos("กุ้งก้ามกรามเผา 1 กก.", 64), pos("กุ้งก้ามกรามเผา 5 ขีด", 49), pos("ข้าวผัดกุ้ง", 120)];
  const asRead = [
    { pos_product_name: "กุ้งก้ามกรามเผา", menu_id: "m-prawn", divisor: 10 },
    { pos_product_name: "กุ้งก้ามกรามเผา 1 กก.", menu_id: "m-prawn", divisor: 1 },
    { pos_product_name: "กุ้งก้ามกรามเผา 5 ขีด", menu_id: "m-prawn", divisor: 2 },
  ];
  const updates = [{ menuId: "m-prawn", newQty: 94.1 }, { menuId: "m-rice", newQty: 120 }];
  assert.deepEqual(movedSinceRead(updates, file, asRead, menus), []);
  // The 5-ขีด button edited to ÷1 in another tab: 94.1 would now be 118.6.
  const edited = asRead.map((a) => (a.pos_product_name.endsWith("5 ขีด") ? { ...a, divisor: 1 } : a));
  assert.deepEqual(movedSinceRead(updates, file, edited, menus), ["m-prawn"]);
  // A หาร saved in this session is found by the re-check, not flagged.
  const divided = [...asRead, { pos_product_name: "ข้าวผัดกุ้ง", menu_id: "m-rice", divisor: 2 }];
  assert.deepEqual(movedSinceRead([{ menuId: "m-rice", newQty: 60 }], file, divided, menus), []);
});
