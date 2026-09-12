/** Run with: npm test — the quote/deposit/invoice document's rules (document C). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocState, docMoney, conditionsFor, moneyRowsFor, DOC_TITLE } from "./quote-doc.ts";

test("the three states, and an unknown one falls back to the quote", () => {
  assert.equal(parseDocState("quote"), "quote");
  assert.equal(parseDocState("deposit"), "deposit");
  assert.equal(parseDocState("invoice"), "invoice");
  // The booking screen's existing link carries no parameter at all.
  assert.equal(parseDocState(undefined), "quote");
  assert.equal(parseDocState(""), "quote");
  assert.equal(parseDocState("receipt"), "quote");
  assert.equal(parseDocState("QUOTE"), "quote", "case-sensitive, no silent coercion");
});

test("each state has its own title, and they are all distinct", () => {
  assert.deepEqual(DOC_TITLE, { quote: "ใบเสนอราคา", deposit: "ใบมัดจำ", invoice: "ใบแจ้งหนี้" });
  assert.equal(new Set(Object.values(DOC_TITLE)).size, 3);
});

test("the deposit due is percent of total, rounded to the satang", () => {
  assert.equal(docMoney(10000, 30, null).depositDue, 3000);
  assert.equal(docMoney(10000, 50, null).depositDue, 5000);
  assert.equal(docMoney(3333, 30, null).depositDue, 999.9);
});

test("no agreed percentage means no computed deposit — never a zero", () => {
  const m = docMoney(10000, null, null);
  assert.equal(m.percent, null);
  assert.equal(m.depositDue, null);
  assert.notEqual(m.depositDue, 0, "0 would assert that no deposit is due");
});

test("the balance uses what was RECEIVED, not what was due", () => {
  // A customer who rounded ฿4,500 up to ฿5,000 owes the smaller balance.
  const m = docMoney(15000, 30, 5000);
  assert.equal(m.depositDue, 4500, "the agreed term");
  assert.equal(m.depositPaid, 5000, "the fact");
  assert.equal(m.balance, 10000, "15,000 - 5,000, not 15,000 - 4,500");
});

test("nothing received means no balance line at all", () => {
  const m = docMoney(15000, 30, null);
  assert.equal(m.balance, null, "printing the total twice invites a double payment");
});

test("the quote prints only the total — a deposit line there reads as a demand", () => {
  const rows = moneyRowsFor("quote", docMoney(10000, 30, null));
  assert.deepEqual(rows.map((r) => r.label), ["รวมทั้งหมด"]);
});

test("the deposit document prints the total and the figure due", () => {
  const rows = moneyRowsFor("deposit", docMoney(10000, 30, null));
  assert.deepEqual(rows.map((r) => r.label), ["รวมทั้งหมด", "เงินมัดจำ 30%"]);
  assert.equal(rows[1].amount, 3000);
});

test("the invoice deducts what was received and shows what is left", () => {
  const rows = moneyRowsFor("invoice", docMoney(15000, 30, 5000));
  assert.deepEqual(rows.map((r) => r.label), ["รวมทั้งหมด", "หัก เงินมัดจำที่ชำระแล้ว", "ยอดคงเหลือ"]);
  assert.equal(rows[1].amount, -5000, "the deduction prints negative");
  assert.equal(rows[2].amount, 10000);
});

test("an invoice with nothing received shows the total alone", () => {
  const rows = moneyRowsFor("invoice", docMoney(15000, 30, null));
  assert.deepEqual(rows.map((r) => r.label), ["รวมทั้งหมด"]);
});

test("a deposit document with no agreed percentage omits the line, not prints zero", () => {
  const rows = moneyRowsFor("deposit", docMoney(10000, null, null));
  assert.deepEqual(rows.map((r) => r.label), ["รวมทั้งหมด"]);
});

test("the percentage in the conditions comes from the event", () => {
  assert.ok(conditionsFor("quote", 30).some((l) => l.includes("มัดจำ 30%")));
  assert.ok(conditionsFor("quote", 50).some((l) => l.includes("มัดจำ 50%")));
});

test("no agreed percentage leaves a blank to write in, never a number", () => {
  const lines = conditionsFor("quote", null);
  assert.ok(lines.some((l) => l.includes("______")));
  assert.ok(!lines.some((l) => /\d+%/.test(l)), "no percentage is invented");
});

test("a percentage never prints trailing zeros on a customer document", () => {
  assert.ok(conditionsFor("quote", 30).some((l) => l.includes("30%")));
  assert.ok(!conditionsFor("quote", 30).some((l) => l.includes("30.00%")));
  assert.ok(conditionsFor("quote", 33.5).some((l) => l.includes("33.5%")));
});

test("the quote's validity is 15 days, from Nik's paper — not the 30 that was invented", () => {
  const lines = conditionsFor("quote", 30);
  assert.ok(lines.some((l) => l.includes("15 วัน")));
  assert.ok(!lines.some((l) => l.includes("30 วัน")));
});

test("cancellation is 7 days' notice, and only on the documents that carry it", () => {
  assert.ok(conditionsFor("invoice", 30).some((l) => l.includes("7 วัน")));
  assert.ok(conditionsFor("deposit", 30).some((l) => l.includes("7 วัน")));
  assert.ok(!conditionsFor("quote", 30).some((l) => l.includes("7 วัน")));
});

test("every state has conditions, and none is empty", () => {
  for (const s of ["quote", "deposit", "invoice"] as const) {
    assert.ok(conditionsFor(s, 30).length > 0, s);
    assert.ok(conditionsFor(s, 30).every((l) => l.trim().length > 0), s);
  }
});

// ── percent = 0: agreed NO deposit. Nik's third state — not a blank, not "0%". ──

test("0 omits the deposit clause entirely — no 0%, no blank", () => {
  for (const s of ["quote", "deposit", "invoice"] as const) {
    const lines = conditionsFor(s, 0);
    assert.ok(!lines.some((l) => l.includes("%")), `${s}: no percent sign at all`);
    assert.ok(!lines.some((l) => l.includes("______")), `${s}: no blank to write in — 0 is an answer`);
    assert.ok(!lines.some((l) => l.includes("ยอดมัดจำคิดจาก")), s);
    assert.ok(!lines.some((l) => l.includes("เพื่อยืนยันการจอง")), s);
  }
});

test("0 prints no deposit row anywhere, even though the computed figure is honestly 0", () => {
  const m = docMoney(10000, 0, null);
  assert.equal(m.depositDue, 0, "docMoney stays honest: 0% of the total is 0");
  assert.deepEqual(moneyRowsFor("deposit", m).map((r) => r.label), ["รวมทั้งหมด"]);
  assert.deepEqual(moneyRowsFor("quote", m).map((r) => r.label), ["รวมทั้งหมด"]);
});

test("0 keeps the 7-day notice but drops its no-refund tail", () => {
  // Asserting "no refund of the deposit" on a job with no deposit reads as a
  // threat about money that was never taken.
  const lines = conditionsFor("invoice", 0);
  assert.ok(lines.some((l) => l.includes("7 วัน")), "the notice term is Nik's regardless of deposit");
  assert.ok(!lines.some((l) => l.includes("ไม่คืนเงินมัดจำ")));
  // And with a real percent the tail is present.
  assert.ok(conditionsFor("invoice", 30).some((l) => l.includes("ไม่คืนเงินมัดจำ")));
});

test("the three states stay distinct: null blanks, 0 omits, 30 prints", () => {
  const q = (p: number | null) => conditionsFor("quote", p);
  assert.ok(q(null).some((l) => l.includes("______%")));
  assert.equal(q(0).length, 1, "0 leaves only the validity line on the quote");
  assert.ok(q(30).some((l) => l.includes("30%")));
});
