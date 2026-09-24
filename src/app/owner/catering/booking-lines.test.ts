/**
 * Run with: npm test — the booking screen's price box: what it saves, what it
 * refuses, and that it loads back what it saved.
 *
 * Until 2026-09-21 every set and dish line was saved as Math.max(1, typed):
 * half a kilo of a dish sold by weight was saved as a kilo and the quotation
 * doubled. And the save deleted every charge row before inserting the new
 * list, so one line the database refused left the booking with no price
 * lines at all. These tests go through the real functions the screen uses to
 * load the charge rows (linesFromCharges), to check them (priceBoxProblem),
 * and to build the save (bookingLinesForSave), and the check saveBooking
 * repeats on what it is sent (bookingLinesProblem). The database's own copy
 * of the rules is tested as real accounts in
 * supabase/catering_booking_prices_save_migration.sql.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingLinesForSave, bookingLinesProblem, chargeLineError, hasAtMost3Decimals, isEmptyTypedRow, linesFromCharges,
  menuLineQuantityError, menuLineQuantityOk, priceBoxProblem, type ChargeLine, type Line,
} from "./booking-lines.ts";
import type { BookingLine, CateringCharge } from "./actions";

/** A menu-linked charge row as getCateringCharges returns it. */
function menuCharge(kind: "set" | "dish", quantity: number, unitPrice: number): CateringCharge {
  return {
    id: `c-${kind}`, label: kind === "set" ? "โต๊ะจีน A" : "กุ้งก้ามกรามเผา", charge_type: "food",
    unit_price: unitPrice, quantity, amount: unitPrice * quantity, note: null,
    event_menu_id: `m-${kind}`, event_menu_kind: kind, event_menu_ref: `ref-${kind}`,
    rate_id: null, rate_type: null, rate_display_label: null, is_free: false,
  };
}

function dishLine(quantity: string): Line {
  return {
    key: "k1", kind: "dish", section: "menu", refId: "ref-dish", eventMenuId: "m-dish", label: "กุ้งก้ามกรามเผา",
    unitPrice: "1000", quantity, amount: "", chargeType: "food", note: null, free: false,
  };
}

const setLine = (quantity: string): Line => ({
  ...dishLine(quantity), key: "k2", kind: "set", refId: "ref-set", eventMenuId: "m-set", label: "โต๊ะจีน A",
});

const typedLine = (patch: Partial<Line>): Line => ({
  key: "k3", kind: "manual", section: "other", refId: null, eventMenuId: null, label: "ค่าไฟ",
  unitPrice: "500", quantity: "1", amount: "500", chargeType: "other", note: null, free: false, ...patch,
});

const charge = (patch: Partial<ChargeLine>): ChargeLine => ({
  kind: "charge", label: "ค่าไฟ", charge_type: "other", unit_price: 500, quantity: 1, amount: 500, note: null, rate_id: null, ...patch,
});

// ── The quantity: saved as typed ────────────────────────────────────────────

test("a dish line typed as 0.5 is sent to the save as 0.5", () => {
  const [saved] = bookingLinesForSave([dishLine("0.5")]);
  assert.equal(saved.kind, "dish");
  assert.equal(saved.quantity, 0.5);
});

test("0.5 survives a save and a reload, and a second save of the reloaded line", () => {
  // Save: what the screen sends. The database writes the quantity as sent
  // (catering_save_booking_prices; P2 in its migration).
  const [first] = bookingLinesForSave([dishLine("0.5")]);
  // Reload: the stored row as getCateringCharges returns it, through the
  // screen's own loader.
  const [loaded] = linesFromCharges([menuCharge("dish", first.quantity, 1000)]);
  assert.equal(loaded.quantity, "0.5");
  // Saving the booking again without touching the line keeps it.
  const [second] = bookingLinesForSave([loaded]);
  assert.equal(second.quantity, 0.5);
});

test("a menu line sends NO price: its price is the stored charge's (THE ONE PRICE)", () => {
  for (const l of bookingLinesForSave([dishLine("2"), setLine("10")])) {
    // is_free since 2026-09-24: the free mark, not a price.
    assert.deepEqual(Object.keys(l).sort(), ["eventMenuId", "is_free", "kind", "quantity", "refId"]);
  }
});

// ── The quantity rule ───────────────────────────────────────────────────────

test("three decimals at most, read with a tolerance for floating point", () => {
  for (const q of [0.5, 0.1, 0.001, 1.125, 1.005, 1.001, 0.3, 100_000]) assert.equal(hasAtMost3Decimals(q), true, `${q}`);
  for (const q of [0.0005, 1.0005, 0.3333]) assert.equal(hasAtMost3Decimals(q), false, `${q}`);
  assert.equal(1.005 * 1000, 1004.9999999999999); // why the tolerance
});

test("a dish takes above 0, up to three decimals; a set takes whole counts, at least 1; neither above 100,000", () => {
  for (const q of [0.5, 0.25, 0.001, 1, 1.5, 1.125, 30, 100_000]) assert.equal(menuLineQuantityOk("dish", q), true, `dish ${q}`);
  for (const q of [0, -0.5, 0.0005, 1.0005, 100_000.5, 100_001, 1e305, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null, undefined]) {
    assert.equal(menuLineQuantityOk("dish", q), false, `dish ${String(q)}`);
  }
  for (const q of [1, 2, 10, 100_000]) assert.equal(menuLineQuantityOk("set", q), true, `set ${q}`);
  for (const q of [0, 0.5, 2.5, -1, 100_001, "1", null]) assert.equal(menuLineQuantityOk("set", q), false, `set ${String(q)}`);
});

test("a set's refusal names the booking's own unit, as the kitchen sheet counts it", () => {
  assert.equal(menuLineQuantityError("set", 2.5), "จำนวนโต๊ะต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
  assert.equal(menuLineQuantityError("set", 2.5, "กล่อง"), "จำนวนกล่องต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
  assert.equal(menuLineQuantityError("set", 0, "ชุด"), "จำนวนชุดต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
  assert.equal(priceBoxProblem([setLine("2.5")], "กล่อง"), "“โต๊ะจีน A”: จำนวนกล่องต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป");
  assert.equal(menuLineQuantityError("dish", 1.0005), "จำนวนต้องมากกว่า 0 และมีทศนิยมไม่เกิน 3 ตำแหน่ง (เช่น 0.5)");
  assert.equal(menuLineQuantityError("set", 100_001), "จำนวนต้องไม่เกิน 100,000");
});

// ── Every other line: what the database would otherwise refuse after the delete ──

test("a charge line is refused for exactly what its insert would fail on, and nothing else", () => {
  assert.equal(chargeLineError(charge({})), null);
  assert.equal(chargeLineError(charge({ label: "  " })), "ต้องมีชื่อรายการ");
  assert.equal(chargeLineError(charge({ charge_type: "xyz" })), "ประเภทรายการไม่ถูกต้อง");
  assert.match(chargeLineError(charge({ charge_type: "food" })) ?? "", /อาหารต้องเลือกจากชุดเมนู/);
  assert.equal(chargeLineError(charge({ amount: Number.NaN })), "ราคา จำนวน และยอดเงินต้องเป็นตัวเลข");
  assert.equal(chargeLineError(charge({ amount: "500" as unknown as number })), "ราคา จำนวน และยอดเงินต้องเป็นตัวเลข");
  assert.equal(chargeLineError(charge({ unit_price: 1e9, amount: 1e9 })), "ยอดเงินต้องไม่เกิน 100,000,000 บาท");
  assert.equal(chargeLineError(charge({ quantity: -1 })), "จำนวนต้องอยู่ระหว่าง 0 ถึง 100,000");
  assert.match(chargeLineError(charge({ unit_price: -500, amount: -500 })) ?? "", /ต้องไม่ติดลบ/);
  assert.equal(chargeLineError(charge({ label: "ส่วนลด", charge_type: "discount", amount: 500 })), "ส่วนลดต้องเป็นยอดติดลบหรือ 0");
  assert.equal(chargeLineError(charge({ rate_id: 5 as unknown as string })), "รูปแบบข้อมูลไม่ถูกต้อง");
});

test("every shape a stored charge has in production passes (read 2026-09-21: free lines, a 0 × 0 discount)", () => {
  assert.equal(chargeLineError(charge({ label: "ส่วนลด", charge_type: "discount", unit_price: 0, quantity: 0, amount: 0 })), null);
  assert.equal(chargeLineError(charge({ label: "ส่วนลด", charge_type: "discount", unit_price: 1000, quantity: 1, amount: -1000 })), null);
  assert.equal(chargeLineError(charge({ label: "เครื่องดื่มเหมา 80-100 ท่าน", charge_type: "drink", unit_price: 0, quantity: 1, amount: 0, rate_id: "r-1" })), null);
  assert.equal(chargeLineError(charge({ label: "ระยะ 11-15 กม.", charge_type: "transport", unit_price: 3000, quantity: 1, amount: 3000 })), null);
  for (const t of ["drink", "venue", "service", "transport", "equipment", "other"]) assert.equal(chargeLineError(charge({ charge_type: t })), null, t);
});

test("the screen names the line it refuses; an empty typed row is not a line; a nameless row with a price is refused, not dropped", () => {
  assert.equal(priceBoxProblem([typedLine({ unitPrice: "-500", amount: "-500" })]), "“ค่าไฟ”: ราคาและยอดเงินต้องไม่ติดลบ — ถ้าเป็นส่วนลด ให้ใช้แถวส่วนลด");
  assert.equal(priceBoxProblem([typedLine({ label: "", unitPrice: "", amount: "" })]), null);
  assert.equal(isEmptyTypedRow(typedLine({ label: "", unitPrice: "", amount: "" })), true);
  assert.match(priceBoxProblem([typedLine({ label: " ", unitPrice: "500", amount: "500" })]) ?? "", /^มีรายการที่ยังไม่มีชื่อในกล่องราคา/);
  assert.equal(isEmptyTypedRow(typedLine({ label: " ", unitPrice: "500", amount: "500" })), false);
  assert.equal(priceBoxProblem([dishLine("0.5"), setLine("10"), typedLine({})]), null);
});

test("typed, rate and discount lines are sent as before, the stored note carried through; an empty typed row is dropped", () => {
  const manual = typedLine({ quantity: "2.5", unitPrice: "100", amount: "250", note: "หมายเหตุเดิม" });
  const rate: Line = { ...manual, key: "k4", kind: "rate", refId: "rate-1", label: "ห้อง VIP", quantity: "1", amount: "100", note: null };
  const discount: Line = { ...manual, key: "k6", kind: "discount", section: "discount", label: "ส่วนลด", unitPrice: "500", quantity: "1", amount: "-500", chargeType: "discount", note: null };
  const empty = typedLine({ key: "k5", label: "", unitPrice: "", amount: "" });
  const out = bookingLinesForSave([manual, rate, discount, empty]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { kind: "charge", label: "ค่าไฟ", charge_type: "other", unit_price: 100, quantity: 2.5, amount: 250, note: "หมายเหตุเดิม", rate_id: null, is_free: false });
  assert.equal(out[1].kind === "charge" && out[1].rate_id, "rate-1");
  assert.deepEqual(out[2], { kind: "charge", label: "ส่วนลด", charge_type: "discount", unit_price: 500, quantity: 1, amount: -500, note: null, rate_id: null, is_free: false });
  // The note round-trips from the stored row.
  const [loaded] = linesFromCharges([{ ...menuCharge("dish", 1, 1), event_menu_id: null, event_menu_kind: null, event_menu_ref: null, charge_type: "other", note: "จากเดิม" }]);
  assert.equal(loaded.note, "จากเดิม");
});

// ── saveBooking's own check ─────────────────────────────────────────────────

test("saveBooking's own check holds a call it did not get from the screen to the same rules", () => {
  const dish = (quantity: unknown) => ({ kind: "dish", refId: "d", eventMenuId: null, quantity }) as BookingLine;
  const set = (quantity: unknown) => ({ kind: "set", refId: "s", eventMenuId: null, quantity }) as BookingLine;
  assert.equal(bookingLinesProblem([dish(0.5), set(10), charge({})], new Map()), null);
  for (const bad of [[dish(0)], [dish(-1)], [dish("0.5")], [dish(null)], [dish(1.0005)], [set(2.5)], [set(0)], [set("1")]]) {
    assert.match(bookingLinesProblem(bad, new Map()) ?? "", /^จำนวนในกล่องราคาไม่ถูกต้อง: .* — ยังไม่ได้บันทึกอะไร$/, JSON.stringify(bad));
  }
  // A line the booking already stores is judged by its STORED kind: a set
  // line sent as a "dish" cannot be given half a table (review, 2026-09-21).
  const forged = { kind: "dish", refId: "s", eventMenuId: "m-set", quantity: 0.5 } as BookingLine;
  assert.equal(bookingLinesProblem([forged], new Map()), null, "without the stored kinds the sent kind decides");
  assert.match(bookingLinesProblem([forged], new Map([["m-set", "set"]])) ?? "", /^จำนวนในกล่องราคาไม่ถูกต้อง/);
  // A set's refusal names the unit it is given.
  assert.match(bookingLinesProblem([set(2.5)], new Map(), "กล่อง") ?? "", /จำนวนกล่อง/);
  // Charge lines, named.
  assert.equal(bookingLinesProblem([charge({ unit_price: -1, amount: -1 })], new Map()), "“ค่าไฟ”: ราคาและยอดเงินต้องไม่ติดลบ — ถ้าเป็นส่วนลด ให้ใช้แถวส่วนลด — ยังไม่ได้บันทึกอะไร");
  assert.match(bookingLinesProblem([charge({ label: "" })], new Map()) ?? "", /^รายการที่ยังไม่มีชื่อ: ต้องมีชื่อรายการ/);
  // Not a line at all.
  for (const bad of ["x", null, [null], ["x"], [{ kind: "xyz", refId: "d", eventMenuId: null, quantity: 1 }]]) {
    assert.equal(bookingLinesProblem(bad, new Map()), "รูปแบบข้อมูลไม่ถูกต้อง — ยังไม่ได้บันทึกอะไร", JSON.stringify(bad));
  }
});

// ── แถมฟรี, the free mark (Nik, 2026-09-24) ────────────────────────────────

test("the free mark round-trips: loaded from the charge, sent on the dish and the typed line, never on a set", () => {
  const stored = { ...menuCharge("dish", 1, 0), is_free: true };
  const [loaded] = linesFromCharges([stored]);
  assert.equal(loaded.free, true);
  const [dish, set, typed] = bookingLinesForSave([
    { ...dishLine("1"), amount: "0", free: true },
    { ...setLine("3"), free: true },
    typedLine({ unitPrice: "0", amount: "0", free: true }),
  ]);
  assert.equal(dish.kind === "dish" && dish.is_free, true);
  assert.equal(set.kind === "set" && set.is_free, false);
  assert.equal(typed.kind === "charge" && typed.is_free, true);
});

test("a line marked free must be ฿0, and a set or the discount cannot be marked at all", () => {
  assert.match(priceBoxProblem([typedLine({ free: true })]) ?? "", /แถมฟรี/);
  assert.equal(priceBoxProblem([typedLine({ unitPrice: "0", amount: "0", free: true })]), null);
  // A dish marked free is priced ฿0 by the mark itself (the screen and the database): never refused for its price.
  assert.equal(priceBoxProblem([{ ...dishLine("1"), amount: "120", free: true }]), null);
  assert.equal(priceBoxProblem([{ ...dishLine("1"), amount: "0", free: true }]), null);
  // ฿5,000 × 0 totals ฿0 and is still not free.
  assert.match(priceBoxProblem([typedLine({ unitPrice: "5000", quantity: "0", amount: "0", free: true })]) ?? "", /แถมฟรี/);
  assert.match(priceBoxProblem([{ ...setLine("3"), amount: "0", free: true }]) ?? "", /แถมฟรี/);
  assert.ok(chargeLineError(charge({ unit_price: 0, amount: 0, is_free: true })) === null);
  assert.ok(chargeLineError(charge({ is_free: true })));
  assert.ok(chargeLineError(charge({ charge_type: "discount", unit_price: 0, amount: 0, is_free: true })));
});

test("a set or the discount stored as free loads unmarked, so it cannot block every later save", () => {
  const [set] = linesFromCharges([{ ...menuCharge("set", 2, 0), is_free: true }]);
  assert.equal(set.free, false);
  const [discount] = linesFromCharges([{ ...menuCharge("dish", 1, 0), event_menu_id: null, event_menu_kind: null, event_menu_ref: null, charge_type: "discount", is_free: true }]);
  assert.equal(discount.free, false);
});

test("saveBooking's own check: the mark is a boolean, never on a set, and an older payload without it passes", () => {
  const kinds = new Map<string, "set" | "dish">([["m-set", "set"]]);
  const setAsDish = { kind: "dish", refId: "ref-set", eventMenuId: "m-set", quantity: 2, is_free: true } as BookingLine;
  assert.match(bookingLinesProblem([setAsDish], kinds) ?? "", /แถมฟรี/);
  assert.ok(bookingLinesProblem([{ kind: "dish", refId: "d", eventMenuId: null, quantity: 1, is_free: "yes" } as unknown as BookingLine], kinds));
  assert.ok(bookingLinesProblem([{ ...charge({ unit_price: 0, amount: 0 }), is_free: 1 } as unknown as BookingLine], kinds));
  assert.equal(bookingLinesProblem([charge({})], kinds), null);
  assert.equal(bookingLinesProblem([{ kind: "dish", refId: "d", eventMenuId: null, quantity: 1 }], kinds), null);
});
