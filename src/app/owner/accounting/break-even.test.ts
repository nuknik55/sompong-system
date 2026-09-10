/** Run with: npm test — the break-even arithmetic and the cost_behavior resolution rule. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { breakEven, resolveBehavior, type CoaBehaviorRow } from "./break-even.ts";

const COA: CoaBehaviorRow[] = [
  { code: "G100", group_code: null, cost_behavior: "variable" },
  { code: "G200", group_code: null, cost_behavior: "fixed" },
  { code: "G500", group_code: null, cost_behavior: "fixed" },
  { code: "G900", group_code: null, cost_behavior: "fixed" },
  { code: "G950", group_code: null, cost_behavior: null },
  { code: "110", group_code: "G100", cost_behavior: null },
  { code: "210", group_code: "G200", cost_behavior: "variable" },
  { code: "220", group_code: "G200", cost_behavior: null },
  { code: "520", group_code: "G500", cost_behavior: null },
  { code: "998", group_code: "G900", cost_behavior: "excluded" },
  { code: "951", group_code: "G950", cost_behavior: null },
];
const headerOf = new Map(COA.filter((c) => c.group_code === null).map((c) => [c.code, c]));
const row = (code: string) => COA.find((c) => c.code === code)!;

test("the resolution rule: own value, else the header; excluded never inherited; NULL header excludes", () => {
  assert.equal(resolveBehavior(row("110"), headerOf), "variable", "inherits G100");
  assert.equal(resolveBehavior(row("210"), headerOf), "variable", "own value beats the fixed header");
  assert.equal(resolveBehavior(row("220"), headerOf), "fixed", "inherits G200");
  assert.equal(resolveBehavior(row("998"), headerOf), "excluded", "explicit, whatever G900 says");
  assert.equal(resolveBehavior(row("951"), headerOf), null, "NULL header: the group is out");
});

test("August-shaped month: margin, break-even, safety, bills", () => {
  const r = breakEven({
    revenue: 3_880_645,
    accounts: [
      { code: "110", total: 1_788_631 }, // variable
      { code: "210", total: 93_532 },    // variable by own value
      { code: "220", total: 734_638 },   // fixed by header
      { code: "520", total: 145_007 },   // fixed by header
      { code: "998", total: 3_614 },     // excluded
      { code: "951", total: 25_545.81 }, // tax: out
    ],
    coa: COA,
    covers: { bills: 2690, customers: 6686 },
  });
  assert.equal(r.variable, 1_882_163);
  assert.equal(r.fixed, 879_645);
  assert.equal(r.excluded, round2(3_614 + 25_545.81));
  assert.ok(r.contributionMargin !== null && Math.abs(r.contributionMargin - (1 - 1_882_163 / 3_880_645)) < 1e-9);
  assert.equal(r.breakEvenRevenue, round2(879_645 / (1 - 1_882_163 / 3_880_645)));
  assert.equal(r.safetyMargin, round2(3_880_645 - r.breakEvenRevenue!));
  assert.equal(r.revenuePerBill, round2(3_880_645 / 2690));
  assert.equal(r.breakEvenBills, Math.ceil(r.breakEvenRevenue! / (3_880_645 / 2690)));
  assert.deepEqual(r.fixedByHeader, ["G200", "G500"], "the groups whose accounts were fixed by the header alone — named for the page");
  assert.deepEqual(r.unresolved, []);
});

test("no revenue → no margin, no break-even; covers without a break-even → no bills", () => {
  const r = breakEven({ revenue: 0, accounts: [{ code: "220", total: 100 }], coa: COA, covers: { bills: 10, customers: 20 } });
  assert.equal(r.contributionMargin, null);
  assert.equal(r.breakEvenRevenue, null);
  assert.equal(r.safetyMargin, null);
  assert.equal(r.breakEvenBills, null);
});

test("variable costs at or above revenue → margin ≤ 0 → no break-even at any volume, stated as null not Infinity", () => {
  const r = breakEven({ revenue: 100, accounts: [{ code: "110", total: 120 }, { code: "220", total: 5 }], coa: COA, covers: null });
  assert.ok(r.contributionMargin !== null && r.contributionMargin < 0);
  assert.equal(r.breakEvenRevenue, null);
  assert.equal(r.breakEvenBills, null);
});

test("an account with no chart row is reported, not silently dropped; zero totals are ignored", () => {
  const r = breakEven({ revenue: 100, accounts: [{ code: "999", total: 5 }, { code: "220", total: 0 }], coa: COA, covers: null });
  assert.deepEqual(r.unresolved, ["999"]);
  assert.equal(r.fixed, 0);
  assert.deepEqual(r.fixedByHeader, []);
});

function round2(n: number) { return Math.round(n * 100) / 100; }
