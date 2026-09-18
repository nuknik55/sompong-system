/**
 * Run with: npm test — the P&L's group totals (Nik, 2026-09-18).
 *
 * The regression this file exists for: an account that nets negative for the
 * month — a delivery credited back in full — used to be dropped from its
 * group's total, because the total was added up from the DISPLAY list, which
 * kept only strictly positive rows. The month then read as more expensive
 * than it was, on the summary, the print page, both Excel sheets and
 * break-even, all of which take these figures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthlySummaryGroups, isNonOperatingGroup, NON_OPERATING_GROUPS } from "./monthly-summary.ts";
import type { CoaAccount } from "./actions.ts";

const coa = (code: string, name: string, group_code: string | null, target_pct: number | null = null, is_sensitive = false): CoaAccount => ({
  code, name, group_code, group_name: null, target_pct, sort_order: Number(code.replace(/\D/g, "")) || 0, is_sensitive,
});
const COA: CoaAccount[] = [
  coa("G100", "ต้นทุนวัตถุดิบ (COGS)", null, 38),
  coa("110", "ผักสด", "G100"),
  coa("120", "ของสด", "G100"),
  coa("130", "ของแห้ง", "G100"),
  coa("G700", "บริหาร (G&A)", null),
  coa("710", "ค่าเช่า", "G700"),
  coa("G950", "ภาษี", null),
  coa("951", "ภาษีมูลค่าเพิ่ม", "G950"),
  coa("G990", "CapEx", null),
  coa("991", "เครื่องครัว", "G990"),
];
const REVENUE = 1_000_000;
const build = (pairs: [string, number][]) =>
  buildMonthlySummaryGroups({ visibleCoa: COA, totals: new Map(pairs), totalRevenue: REVENUE });
const group = (r: ReturnType<typeof build>, code: string) =>
  [...r.groups, ...r.nonOperating].find((g) => g.group_code === code)!;

test("THE DEFECT: an account that nets negative still counts in its group and in the operating total", () => {
  // ผักสด credited back in full; ของสด bought as usual.
  const r = build([["120", 400_000], ["110", -50_000], ["710", 60_000]]);
  assert.equal(group(r, "G100").total, 350_000, "the credit must reduce the group");
  assert.equal(r.operatingExpense, 410_000, "and the operating total with it");
  assert.equal(group(r, "G100").pct_of_revenue, 35);
  // The credited account is still listed, so the figure can be explained.
  assert.deepEqual(group(r, "G100").accounts.map((a) => [a.code, a.total]), [["110", -50_000], ["120", 400_000]]);
});

test("a month with no credits is unchanged — the ordinary case still adds up", () => {
  const r = build([["110", 150_000], ["120", 250_000], ["710", 50_000], ["951", 12_000], ["991", 5_000]]);
  assert.equal(group(r, "G100").total, 400_000);
  assert.equal(group(r, "G700").total, 50_000);
  assert.equal(r.operatingExpense, 450_000);
  assert.equal(r.tax, 12_000);
  assert.equal(r.capex, 5_000);
  assert.deepEqual(r.groups.map((g) => g.group_code), ["G100", "G700"]);
  assert.deepEqual(r.nonOperating.map((g) => g.group_code), ["G950", "G990"]);
});

test("an account with nothing in it is left out of the display but breaks no total", () => {
  const r = build([["110", 150_000]]);
  assert.deepEqual(group(r, "G100").accounts.map((a) => a.code), ["110"], "ของสด and ของแห้ง are not listed");
  assert.equal(group(r, "G100").total, 150_000);
  // A group with no entries at all still exists, with a zero total.
  assert.equal(group(r, "G700").total, 0);
  assert.deepEqual(group(r, "G700").accounts, []);
});

test("a group whose credits cancel its purchases nets zero, and lists both rows", () => {
  const r = build([["110", 90_000], ["120", -90_000]]);
  assert.equal(group(r, "G100").total, 0);
  assert.equal(r.operatingExpense, 0);
  assert.equal(group(r, "G100").accounts.length, 2, "both rows are shown: a zero total is a fact about the month");
});

test("percentages follow the totals, and are null when there is no revenue", () => {
  const withRevenue = build([["110", 100_000]]);
  assert.equal(group(withRevenue, "G100").accounts[0]!.pct_of_revenue, 10);
  const noRevenue = buildMonthlySummaryGroups({ visibleCoa: COA, totals: new Map([["110", 100_000]]), totalRevenue: 0 });
  assert.equal(group(noRevenue, "G100").total, 100_000);
  assert.equal(group(noRevenue, "G100").pct_of_revenue, null);
  assert.equal(group(noRevenue, "G100").accounts[0]!.pct_of_revenue, null);
});

test("only G950 and G990 sit below the line", () => {
  assert.deepEqual([...NON_OPERATING_GROUPS], ["G950", "G990"]);
  assert.equal(isNonOperatingGroup("G950"), true);
  assert.equal(isNonOperatingGroup("G100"), false);
});
