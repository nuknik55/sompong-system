/**
 * Run with:  npm test
 *
 * Covers the FORMULA layer only: that netWhole and carveWeight fold per-channel
 * discount and GP the way the screen claims. Whether the August export and the
 * seeded table reproduce Nik's figure is a data-layer question, checked by
 * hand against production (฿128,656.69, ฿31.69 above his flat-30% estimate).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PosMonthlyExport, PosSalesLine } from "./pos-parse.ts";
import { aggregateForClassification, platformRates } from "./pos-classify.ts";

function line(saleMode: string, productName: string, qty: number, gross: number, discount = 0): PosSalesLine {
  return { saleMode, group: "ร้านกาแฟ", category: "", productName, qty, unitPrice: gross / qty, gross, discount, net: gross - discount };
}

function report(lines: PosSalesLine[], payments: PosMonthlyExport["payments"]): PosMonthlyExport {
  return {
    dateFrom: "2569-08-01",
    dateTo: "2569-08-31",
    lines,
    grossTotal: lines.reduce((s, l) => s + l.gross, 0),
    discountTotal: lines.reduce((s, l) => s + l.discount, 0),
    netTotal: lines.reduce((s, l) => s + l.net, 0),
    discounts: [],
    payments,
    customerCount: 0,
    billCount: 0,
    cancelledBills: 0,
    cancelledAmount: 0,
  };
}

const PAYMENTS: PosMonthlyExport["payments"] = [
  { method: "Cash", amount: 1000, platformFee: 0, actual: 1000 },
  { method: "Grab", amount: 1000, platformFee: 300, actual: 700 },       // 30.00%
  { method: "LineMan", amount: 1000, platformFee: 267.5, actual: 732.5 }, // 26.75%
];

test("rates come from Sheet2 per platform, and dine-in modes carry none", () => {
  const r = report([line("Eat In", "ชานม", 1, 50), line("อาหารห่อ", "ชานม", 1, 50), line("Grab", "ชานม", 1, 50), line("Lineman", "ชานม", 1, 50)], PAYMENTS);
  const { rates, missing } = platformRates(r);
  assert.deepEqual(missing, []);
  assert.equal(rates.get("Eat In"), 0);
  assert.equal(rates.get("อาหารห่อ"), 0);
  assert.equal(rates.get("Grab"), 0.3);
  assert.equal(rates.get("Lineman"), 0.2675);
});

test("a delivery mode with no payment row is reported, never defaulted to 0", () => {
  const r = report([line("Lineman", "ชานม", 1, 50)], PAYMENTS.filter((p) => p.method !== "LineMan"));
  assert.deepEqual(platformRates(r).missing, ["Lineman"]);
});

test("an unknown sale mode is reported too — a new platform must be wired, not guessed", () => {
  const r = report([line("Robinhood", "ชานม", 1, 50)], PAYMENTS);
  assert.deepEqual(platformRates(r).missing, ["Robinhood"]);
});

test("netWhole nets discount then GP per channel; carveWeight nets GP per unit", () => {
  const r = report(
    [
      line("Eat In", "ชานม", 2, 100, 10), // 90 net, no GP
      line("Grab", "ชานม", 1, 50),         // 50 × 0.70   = 35
      line("Lineman", "ชานม", 1, 50),      // 50 × 0.7325 = 36.625
    ],
    PAYMENTS,
  );
  const [item] = aggregateForClassification(r, platformRates(r).rates);
  assert.equal(item.productName, "ชานม");
  assert.equal(item.qty, 4);
  assert.equal(item.gross, 200);
  assert.ok(Math.abs(item.netWhole - 161.625) < 1e-9);
  // 2 units at 1, one at 0.70, one at 0.7325 → a ฿15 carve-out nets 15 × 3.4325
  assert.ok(Math.abs(item.carveWeight - 3.4325) < 1e-9);
});

test("products collapse across sale modes and sort largest gross first", () => {
  const r = report(
    [line("Eat In", "ข้าวผัด", 1, 80), line("Grab", "ชานม", 3, 150), line("Lineman", "ชานม", 1, 50)],
    PAYMENTS,
  );
  const items = aggregateForClassification(r, platformRates(r).rates);
  assert.deepEqual(items.map((i) => i.productName), ["ชานม", "ข้าวผัด"]);
  assert.equal(items.length, 2);
});

test("a line whose mode has no rate throws rather than contributing a wrong number", () => {
  const r = report([line("Grab", "ชานม", 1, 50)], PAYMENTS);
  assert.throws(() => aggregateForClassification(r, new Map([["Eat In", 0]])), /Grab/);
});
