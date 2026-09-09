/**
 * Run with:  npm test
 *
 * Covers the FORMULA layer with synthetic exports. The data layer — the real
 * projection against the live 523-row category table and the real August
 * export — is verified by hand and recorded in supabase/README.md: six rows
 * totalling ฿3,859,852, coffee ฿129,277, and the two summing to the file's
 * own ฿3,989,129 exactly.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PosMonthlyExport, PosSalesLine } from "./pos-parse.ts";
import { projectPosRevenue, type StoredCategory } from "./pos-revenue.ts";

function line(over: Partial<PosSalesLine> = {}): PosSalesLine {
  return {
    saleMode: "Eat In", group: "อาหาร", category: "", productName: "ข้าวผัด",
    qty: 1, unitPrice: 100, gross: 100, discount: 0, net: 100, ...over,
  };
}

function report(lines: PosSalesLine[], over: Partial<PosMonthlyExport> = {}): PosMonthlyExport {
  const gross = lines.reduce((s, l) => s + l.gross, 0);
  return {
    dateFrom: "สิงหาคม 2569", dateTo: "สิงหาคม 2569", lines,
    grossTotal: gross, discountTotal: 0, netTotal: gross,
    discounts: [], payments: [], customerCount: 0, billCount: 0,
    cancelledBills: 0, cancelledAmount: 0, ...over,
  };
}

const cat = (category: string, share: number | null = null): StoredCategory => ({
  category, coffeeSharePerUnit: share,
});

const amountOf = (revenue: { revenue_type: string; amount: number }[], t: string) =>
  revenue.find((r) => r.revenue_type === t)?.amount;

test("dine-in categories map to their own types, and POS 'other' becomes pos_other", () => {
  const cats = new Map([
    ["ข้าวผัด", cat("food")], ["ชา", cat("drink")], ["ไอติม", cat("dessert")],
    ["ทองม้วน", cat("souvenir")], ["ค่าห้อง", cat("other")],
  ]);
  const { projection, blocks } = projectPosRevenue(
    report([
      line({ productName: "ข้าวผัด", gross: 1000 }),
      line({ productName: "ชา", gross: 200 }),
      line({ productName: "ไอติม", gross: 300 }),
      line({ productName: "ทองม้วน", gross: 50 }),
      line({ productName: "ค่าห้อง", gross: 400 }),
    ]),
    "2026-08", cats,
  );
  assert.deepEqual(blocks, []);
  assert.equal(amountOf(projection.revenue, "food"), 1000);
  assert.equal(amountOf(projection.revenue, "drink"), 200);
  assert.equal(amountOf(projection.revenue, "dessert"), 300);
  assert.equal(amountOf(projection.revenue, "souvenir"), 50);
  assert.equal(amountOf(projection.revenue, "pos_other"), 400);
  // "other" is the accountants' box and cannot be produced here at all.
  assert.equal(amountOf(projection.revenue, "other"), undefined);
});

test("delivery is a CHANNEL bucket: every non-coffee category on Grab/LineMan lands on one line", () => {
  const cats = new Map([["ข้าวผัด", cat("food")], ["ไอติม", cat("dessert")], ["ชา", cat("drink")]]);
  const { projection } = projectPosRevenue(
    report([
      line({ productName: "ข้าวผัด", saleMode: "Grab", gross: 500 }),
      line({ productName: "ไอติม", saleMode: "Lineman", gross: 200 }),
      line({ productName: "ชา", saleMode: "Grab", gross: 100 }),
      line({ productName: "ข้าวผัด", saleMode: "อาหารห่อ", gross: 900 }),
    ]),
    "2026-08", cats,
  );
  assert.equal(amountOf(projection.revenue, "delivery"), 800);
  // อาหารห่อ is takeaway from the restaurant floor, not a platform.
  assert.equal(amountOf(projection.revenue, "food"), 900);
  assert.equal(amountOf(projection.revenue, "dessert"), undefined);
});

test("coffee leaves entirely and appears in no revenue row", () => {
  const cats = new Map([["ข้าวผัด", cat("food")], ["ลาเต้", cat("coffee")]]);
  const { projection } = projectPosRevenue(
    report([line({ productName: "ข้าวผัด", gross: 1000 }), line({ productName: "ลาเต้", gross: 250 })]),
    "2026-08", cats,
  );
  assert.equal(projection.restaurantGross, 1000);
  assert.equal(projection.coffeeGross, 250);
  assert.equal(projection.grossTotal, 1250);
  assert.equal(projection.revenue.length, 1);
});

test("a carve-out splits the line: the category keeps the remainder, coffee takes the share", () => {
  // ไอติมข้าวเหนียวมะม่วง: ฿129 a unit, ฿15 of it the coffee shop's.
  const cats = new Map([["ไอติมข้าวเหนียวมะม่วง", cat("dessert", 15)]]);
  const { projection } = projectPosRevenue(
    report([line({ productName: "ไอติมข้าวเหนียวมะม่วง", qty: 51, gross: 129 * 51 })]),
    "2026-08", cats,
  );
  assert.equal(amountOf(projection.revenue, "dessert"), 129 * 51 - 765);
  assert.equal(projection.carveOut, 765);
  assert.equal(projection.coffeeGross, 765);
  // Not "coffee with a ฿15 share" — that would strand the other ฿114 a unit.
  assert.equal(projection.restaurantGross + projection.coffeeGross, 129 * 51);
});

test("a carve-out on a delivery line splits the same way, into the delivery bucket", () => {
  const cats = new Map([["ไอติมข้าวเหนียวมะม่วง", cat("dessert", 15)]]);
  const { projection } = projectPosRevenue(
    report([line({ productName: "ไอติมข้าวเหนียวมะม่วง", saleMode: "Grab", qty: 2, gross: 258 })]),
    "2026-08", cats,
  );
  assert.equal(amountOf(projection.revenue, "delivery"), 228);
  assert.equal(projection.coffeeGross, 30);
});

test("an unstored product blocks the import and is never defaulted into a category", () => {
  const cats = new Map([["ข้าวผัด", cat("food")]]);
  const { projection, blocks } = projectPosRevenue(
    report([
      line({ productName: "ข้าวผัด", gross: 1000 }),
      line({ productName: "เมนูใหม่", gross: 700 }),
      line({ productName: "เมนูใหม่กว่า", gross: 300 }),
    ]),
    "2026-08", cats,
  );
  const block = blocks.find((b) => b.kind === "unstored");
  assert.ok(block && block.kind === "unstored");
  assert.equal(block.products.length, 2);
  assert.equal(block.totalGross, 1000);
  // Largest first, so the biggest decision is the first one offered.
  assert.equal(block.products[0]!.productName, "เมนูใหม่");
  // The money is in no revenue row — dropped, visibly, not absorbed.
  assert.equal(projection.restaurantGross, 1000);
});

test("the sum checks are skipped while products are unstored, so the block names the cause", () => {
  const cats = new Map([["ข้าวผัด", cat("food")]]);
  const { blocks } = projectPosRevenue(
    report([line({ productName: "ข้าวผัด", gross: 1000 }), line({ productName: "ใหม่", gross: 700 })]),
    "2026-08", cats,
  );
  // Without the skip this would also report a 700 sum mismatch — the symptom
  // of the unstored product, reported as if it were a second fault.
  assert.deepEqual(blocks.map((b) => b.kind), ["unstored"]);
});

test("a sum mismatch blocks: the file's own gross disagreeing with the classified lines", () => {
  const cats = new Map([["ข้าวผัด", cat("food")]]);
  const { blocks } = projectPosRevenue(
    // Sheet3 claims 5,000 while the lines total 1,000.
    report([line({ productName: "ข้าวผัด", gross: 1000 })], { grossTotal: 5000 }),
    "2026-08", cats,
  );
  const sums = blocks.filter((b) => b.kind === "sum");
  assert.equal(sums.length, 2);
  assert.ok(sums.every((b) => b.kind === "sum" && b.computed !== b.expected));
});

test("a ฿1 rounding difference passes — Sheet3 rounds its header to the baht", () => {
  const cats = new Map([["ข้าวผัด", cat("food")]]);
  const { blocks } = projectPosRevenue(
    report([line({ productName: "ข้าวผัด", gross: 1000.4 })], { grossTotal: 1000 }),
    "2026-08", cats,
  );
  assert.deepEqual(blocks, []);
});

test("the three expense entries carry the month in their bill_ref and the right accounts", () => {
  const cats = new Map([["ข้าวผัด", cat("food")]]);
  const { projection } = projectPosRevenue(
    report([line({ productName: "ข้าวผัด", gross: 1000 })], {
      discounts: [{ name: "ส่วนลด 10%", amount: 800 }, { name: "แลกพ้อยท์", amount: 200 }],
      payments: [
        { method: "LineMan", amount: 1000, platformFee: 267.5, actual: 732.5 },
        { method: "Grab", amount: 500, platformFee: 150, actual: 350 },
      ],
    }),
    "2026-08", cats,
  );
  const by = Object.fromEntries(projection.expenses.map((e) => [e.coa_code, e]));
  // CRM is booked at half, deliberately — see splitPosDiscounts.
  assert.equal(by["650"]!.amount, 900);
  assert.equal(by["650"]!.bill_ref, "POS-DISCOUNT-2026-08");
  assert.equal(by["752"]!.amount, 267.5);
  assert.equal(by["752"]!.bill_ref, "POS-GP-LM-2026-08");
  assert.equal(by["753"]!.amount, 150);
  assert.equal(by["753"]!.bill_ref, "POS-GP-GRAB-2026-08");
  assert.deepEqual(projection.platformFees.map((p) => p.ratePct), [26.75, 30]);
});

test("an absent platform writes no GP entry rather than a zero one", () => {
  const cats = new Map([["ข้าวผัด", cat("food")]]);
  const { projection } = projectPosRevenue(
    report([line({ productName: "ข้าวผัด", gross: 1000 })], {
      payments: [{ method: "Cash", amount: 1000, platformFee: 0, actual: 1000 }],
    }),
    "2026-08", cats,
  );
  assert.deepEqual(projection.expenses, []);
});

test("entryDate is the last day of the month, including February and 30-day months", () => {
  const cats = new Map([["ข้าวผัด", cat("food")]]);
  const run = (ym: string) =>
    projectPosRevenue(report([line({ productName: "ข้าวผัด", gross: 1 })]), ym, cats).projection.entryDate;
  assert.equal(run("2026-08"), "2026-08-31");
  assert.equal(run("2026-09"), "2026-09-30");
  assert.equal(run("2026-02"), "2026-02-28");
  assert.equal(run("2024-02"), "2024-02-29");
});

test("a type with no sales is omitted rather than written as zero", () => {
  const cats = new Map([["ข้าวผัด", cat("food")]]);
  const { projection } = projectPosRevenue(
    report([line({ productName: "ข้าวผัด", gross: 1000 })]), "2026-08", cats,
  );
  assert.deepEqual(projection.revenue.map((r) => r.revenue_type), ["food"]);
});
