/**
 * Run with: npm test — the booking screen's price box saves a quantity as it
 * was typed, and loads it back the same.
 *
 * Until 2026-09-21 every set and dish line was saved as Math.max(1, typed):
 * half a kilo of a dish sold by weight was saved as a kilo and the quotation
 * doubled. These tests go through the real functions the screen uses to load
 * the charge rows (linesFromCharges) and to build the save (bookingLinesForSave).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingLinesForSave, bookingLinesQuantityProblem, linesFromCharges, menuChargeAmount, menuLineQuantityOk,
  priceBoxQuantityProblem, type Line,
} from "./booking-lines.ts";
import type { BookingLine, CateringCharge } from "./actions";

/** A menu-linked charge row as getCateringCharges returns it. */
function menuCharge(kind: "set" | "dish", quantity: number, unitPrice: number): CateringCharge {
  return {
    id: `c-${kind}`, label: kind === "set" ? "โต๊ะจีน A" : "กุ้งก้ามกรามเผา", charge_type: "food",
    unit_price: unitPrice, quantity, amount: unitPrice * quantity, note: null,
    event_menu_id: `m-${kind}`, event_menu_kind: kind, event_menu_ref: `ref-${kind}`,
    rate_id: null, rate_type: null, rate_display_label: null,
  };
}

function dishLine(quantity: string): Line {
  return {
    key: "k1", kind: "dish", section: "menu", refId: "ref-dish", eventMenuId: "m-dish", label: "กุ้งก้ามกรามเผา",
    unitPrice: "1000", quantity, amount: "", chargeType: "food",
  };
}

test("a dish line typed as 0.5 is sent to the save as 0.5", () => {
  const [saved] = bookingLinesForSave([dishLine("0.5")]);
  assert.equal(saved.kind, "dish");
  assert.equal(saved.quantity, 0.5);
});

test("0.5 survives a save and a reload, and a second save of the reloaded line", () => {
  // Save: what the screen sends; saveBooking writes l.quantity to the charge row.
  const [first] = bookingLinesForSave([dishLine("0.5")]);
  // Reload: the stored row as getCateringCharges returns it, through the
  // screen's own loader.
  const [loaded] = linesFromCharges([menuCharge("dish", first.quantity, 1000)]);
  assert.equal(loaded.quantity, "0.5");
  // Saving the booking again without touching the line keeps it.
  const [second] = bookingLinesForSave([loaded]);
  assert.equal(second.quantity, 0.5);
});

test("the stored charge of a 0.5 line is to the satang, and loads back as typed", () => {
  // saveBooking writes quantity: l.quantity and amount: menuChargeAmount(row.unit_price,
  // l.quantity) for a menu line; save-booking-lock.test.ts holds its source to exactly that.
  const [saved] = bookingLinesForSave([dishLine("0.5")]);
  const stored = { ...menuCharge("dish", 1, 1300), quantity: saved.quantity, amount: menuChargeAmount(1300, saved.quantity) };
  const [loaded] = linesFromCharges([stored]);
  assert.deepEqual([loaded.quantity, loaded.amount], ["0.5", "650"]);
});

test("a menu line's charge is price × quantity to the satang", () => {
  assert.equal(1300 * 0.7, 909.9999999999999); // the floating-point product the row used to keep
  assert.equal(menuChargeAmount(1300, 0.7), 910);
  assert.equal(menuChargeAmount(1000, 0.5), 500);
  assert.equal(menuChargeAmount(4500, 10), 45000);
});

test("a dish takes any quantity above 0; a set takes whole tables, at least 1", () => {
  for (const q of [0.5, 0.25, 1, 1.5, 30]) assert.equal(menuLineQuantityOk("dish", q), true, `dish ${q}`);
  for (const q of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null, undefined]) assert.equal(menuLineQuantityOk("dish", q), false, `dish ${String(q)}`);
  for (const q of [1, 2, 10]) assert.equal(menuLineQuantityOk("set", q), true, `set ${q}`);
  for (const q of [0, 0.5, 2.5, -1, "1", null]) assert.equal(menuLineQuantityOk("set", q), false, `set ${String(q)}`);
});

test("the screen refuses a quantity outside its rule, naming the line, and never changes it", () => {
  const set = (quantity: string): Line => ({ ...dishLine(quantity), key: "k2", kind: "set", refId: "ref-set", eventMenuId: "m-set", label: "โต๊ะจีน A" });
  for (const q of ["0", "", "abc", "-1"]) {
    assert.equal(priceBoxQuantityProblem([dishLine(q)]), "“กุ้งก้ามกรามเผา”: จำนวนต้องมากกว่า 0 (ใส่ทศนิยมได้ เช่น 0.5)", `dish "${q}"`);
  }
  for (const q of ["2.5", "0", "0.5", ""]) {
    assert.equal(priceBoxQuantityProblem([set(q)]), "“โต๊ะจีน A”: จำนวนโต๊ะต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป", `set "${q}"`);
  }
  assert.equal(priceBoxQuantityProblem([dishLine("0.5"), set("10"), set("1.0")]), null);
  // Rate, typed and discount lines keep their own rules: none of them is checked here.
  const manual: Line = { ...dishLine("0"), key: "k3", kind: "manual", section: "other", refId: null, eventMenuId: null, label: "ค่าไฟ", chargeType: "other" };
  assert.equal(priceBoxQuantityProblem([manual]), null);
});

test("saveBooking's own check holds a call it did not get from the screen to the same rule", () => {
  const dish = (quantity: unknown) => ({ kind: "dish", refId: "d", eventMenuId: null, quantity }) as BookingLine;
  const set = (quantity: unknown) => ({ kind: "set", refId: "s", eventMenuId: null, quantity }) as BookingLine;
  const charge = { kind: "charge", label: "ค่าไฟ", charge_type: "other", unit_price: 0, quantity: 0, amount: 0, note: null, rate_id: null } as BookingLine;
  assert.equal(bookingLinesQuantityProblem([dish(0.5), set(10), charge], new Map()), null);
  for (const bad of [[dish(0)], [dish(-1)], [dish("0.5")], [dish(null)], [set(2.5)], [set(0)], [set("1")]]) {
    assert.match(bookingLinesQuantityProblem(bad, new Map()) ?? "", /^จำนวนในกล่องราคาไม่ถูกต้อง/, JSON.stringify(bad));
  }
  // A line the booking already stores is judged by its STORED kind: a set line
  // sent as a "dish" cannot be given half a table (review, 2026-09-21).
  const forged = { kind: "dish", refId: "s", eventMenuId: "m-set", quantity: 0.5 } as BookingLine;
  assert.equal(bookingLinesQuantityProblem([forged], new Map()), null, "without the stored kinds the sent kind decides");
  assert.match(bookingLinesQuantityProblem([forged], new Map([["m-set", "set"]])) ?? "", /^จำนวนในกล่องราคาไม่ถูกต้อง/);
  assert.equal(bookingLinesQuantityProblem([{ ...forged, quantity: 2 }], new Map([["m-set", "set"]])), null);
  // An unknown kind is a menu line to saveBooking and a dish to addCateringEventMenu.
  assert.notEqual(bookingLinesQuantityProblem([{ kind: "xyz", refId: "d", eventMenuId: null, quantity: 0 } as unknown as BookingLine], new Map()), null);
});

test("a quantity is capped at 100,000, so price × quantity stays finite", () => {
  assert.equal(menuLineQuantityOk("set", 100_000), true);
  assert.equal(menuLineQuantityOk("dish", 100_000), true);
  for (const q of [100_000.5, 100_001, 1e305]) {
    assert.equal(menuLineQuantityOk("dish", q), false, `dish ${q}`);
    assert.equal(menuLineQuantityOk("set", q), false, `set ${q}`);
  }
  assert.equal(Number.isFinite(menuChargeAmount(4500, 1e305)), false, "what the cap is there to stop");
  assert.equal(priceBoxQuantityProblem([dishLine("1e305")]), "“กุ้งก้ามกรามเผา”: จำนวนต้องไม่เกิน 100,000");
  assert.match(bookingLinesQuantityProblem([{ kind: "set", refId: "s", eventMenuId: null, quantity: 1e305 } as BookingLine], new Map()) ?? "", /^จำนวนในกล่องราคาไม่ถูกต้อง/);
});

test("typed, rate and discount lines are sent as before", () => {
  const manual: Line = { ...dishLine("2.5"), key: "k3", kind: "manual", section: "other", refId: null, eventMenuId: null, label: "ค่าไฟ", unitPrice: "100", amount: "250", chargeType: "other" };
  const rate: Line = { ...manual, key: "k4", kind: "rate", refId: "rate-1", label: "ห้อง VIP", quantity: "1", amount: "100" };
  const discount: Line = { ...manual, key: "k6", kind: "discount", section: "discount", label: "ส่วนลด", unitPrice: "500", quantity: "1", amount: "-500", chargeType: "discount" };
  const blank: Line = { ...manual, key: "k5", label: "  " };
  const out = bookingLinesForSave([manual, rate, discount, blank]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { kind: "charge", label: "ค่าไฟ", charge_type: "other", unit_price: 100, quantity: 2.5, amount: 250, note: null, rate_id: null });
  assert.equal(out[1].kind === "charge" && out[1].rate_id, "rate-1");
  assert.deepEqual(out[2], { kind: "charge", label: "ส่วนลด", charge_type: "discount", unit_price: 500, quantity: 1, amount: -500, note: null, rate_id: null });
});
