/**
 * Run with: npm test — the head chef's food-cost month (queue item 37).
 *
 * The page it feeds is what an admin gets INSTEAD of the P&L, so the point of
 * these tests is as much what the result does not contain as what it does:
 * no other group's amount, no owner-only account, nothing to subtract a
 * profit from. Each finder is first shown finding something, so the "no leak"
 * assertions below mean something.
 *
 * WHICH LAYER: this file covers the builder, which is what shapes the page.
 * It does NOT exercise getFoodCostMonth's three queries or the page itself;
 * that the page is a server component with no client child, so nothing but
 * the builder's result reaches the browser, was checked by reading the built
 * client-reference manifest for the route, not here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFoodCostMonth, type FoodCostCoaRow } from "./food-cost.ts";

const COA: FoodCostCoaRow[] = [
  { code: "G100", name: "ต้นทุนวัตถุดิบ (COGS)", group_code: null, target_pct: 38, is_sensitive: false },
  { code: "110", name: "ผักสด", group_code: "G100", target_pct: null, is_sensitive: false },
  { code: "120", name: "ของสด", group_code: "G100", target_pct: null, is_sensitive: false },
  { code: "130", name: "ของแห้ง", group_code: "G100", target_pct: null, is_sensitive: false },
  { code: "G700", name: "บริหาร (G&A)", group_code: null, target_pct: null, is_sensitive: false },
  { code: "710", name: "ค่าเช่า", group_code: "G700", target_pct: null, is_sensitive: false },
  { code: "790", name: "เงินเดือนเจ้าของร้าน", group_code: "G700", target_pct: null, is_sensitive: true },
  { code: "G950", name: "ภาษี", group_code: null, target_pct: null, is_sensitive: false },
  { code: "951", name: "ภาษีมูลค่าเพิ่ม", group_code: "G950", target_pct: null, is_sensitive: false },
];
const RENT = 50_000;
const OWNER_PAY = 60_000;
const TAX = 12_000;
const ENTRIES = [
  { coa_code: "110", amount: 100_000 },
  { coa_code: "120", amount: 250_000 },
  { coa_code: "110", amount: 50_000 },
  { coa_code: "710", amount: RENT },
  { coa_code: "790", amount: OWNER_PAY },
  { coa_code: "951", amount: TAX },
];
const REVENUE = [{ amount: 800_000 }, { amount: 200_000 }]; // 1,000,000
const WHOLE_MONTH = { expenseDataIncomplete: false, monthInProgress: false };

const build = (over: Partial<Parameters<typeof buildFoodCostMonth>[0]> = {}) =>
  buildFoodCostMonth({ yearMonth: "2026-08", coa: COA, entries: ENTRIES, revenueRows: REVENUE, completeness: WHOLE_MONTH, ...over });

/** Every number anywhere in the result, however nested. */
const amountsIn = (view: unknown): number[] =>
  JSON.stringify(view).match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];

test("both leak-finders see what IS meant to be in the result", () => {
  const view = build();
  assert.ok(amountsIn(view).includes(250_000), "ของสด's 250,000 must be in the result");
  // The word finder, proven on a name that belongs here, so its misses below
  // are the builder's doing and not the finder's.
  assert.ok(JSON.stringify(view).includes("ของสด"), "the finder must see an account name that belongs");
});

test("no other group's amount is anywhere in the result — not the owner's pay, rent or tax", () => {
  const found = amountsIn(build());
  for (const [what, amount] of [["the owner's pay", OWNER_PAY], ["rent", RENT], ["tax", TAX]] as const) {
    assert.ok(!found.includes(amount), `${what} (${amount}) must not appear`);
  }
  const text = JSON.stringify(build());
  for (const word of ["เงินเดือนเจ้าของร้าน", "790", "ค่าเช่า", "ภาษี", "กำไร"]) {
    assert.ok(!text.includes(word), word);
  }
});

test("COGS is the G100 accounts only, biggest first, and the percentage follows", () => {
  const view = build();
  assert.deepEqual(view.accounts.map((a) => a.code), ["120", "110"]); // 130 has no entries
  assert.equal(view.accounts[0]!.total, 250_000);
  assert.equal(view.accounts[1]!.total, 150_000); // two entries in 110, added
  assert.equal(view.cogs, 400_000);
  assert.equal(view.revenue, 1_000_000);
  assert.equal(view.pctOfRevenue, 40);
  assert.equal(view.accounts[0]!.pctOfRevenue, 25);
});

test("the gap against the target is in points and in baht", () => {
  const view = build();
  assert.equal(view.targetPct, 38);
  assert.ok(Math.abs(view.gapPoints! - 2) < 1e-9, "40% against a 38% target is 2 points over");
  assert.ok(Math.abs(view.gapBaht! - 20_000) < 1e-9, "2 points of 1,000,000 is 20,000");
});

test("an owner-only account is dropped even if it is put in G100", () => {
  const coa: FoodCostCoaRow[] = [
    ...COA,
    { code: "795", name: "ของเจ้าของ", group_code: "G100", target_pct: null, is_sensitive: true },
  ];
  const view = build({ coa, entries: [...ENTRIES, { coa_code: "795", amount: 7_777 }] });
  assert.ok(!amountsIn(view).includes(7_777));
  assert.equal(view.cogs, 400_000);
});

test("no revenue: the percentages are null rather than zero or Infinity", () => {
  const view = build({ revenueRows: [] });
  assert.equal(view.revenue, 0);
  assert.equal(view.cogs, 400_000);
  assert.equal(view.pctOfRevenue, null);
  assert.equal(view.gapPoints, null);
  assert.equal(view.gapBaht, null);
  assert.equal(view.accounts[0]!.pctOfRevenue, null);
});

test("no target on the group header: the figures still stand, the gap does not", () => {
  const coa = COA.map((c) => (c.code === "G100" ? { ...c, target_pct: null } : c));
  const view = build({ coa });
  assert.equal(view.targetPct, null);
  assert.equal(view.gapPoints, null);
  assert.equal(view.pctOfRevenue, 40);
});

test("the completeness flags travel with the month", () => {
  const view = build({ completeness: { expenseDataIncomplete: true, monthInProgress: true } });
  assert.equal(view.expenseDataIncomplete, true);
  assert.equal(view.monthInProgress, true);
});

test("THE DEFECT: an account that nets negative still counts in the total", () => {
  // A delivery credited back in full: 110 nets -50,000 for the month. Adding
  // up only the positive rows gave 400,000 (40%, over a 38% target) when the
  // month actually spent 350,000 (35%, under it).
  const view = build({ entries: [{ coa_code: "120", amount: 400_000 }, { coa_code: "110", amount: -50_000 }] });
  assert.equal(view.cogs, 350_000);
  assert.equal(view.pctOfRevenue, 35);
  assert.ok(view.gapPoints! < 0, "35% against a 38% target is under, not over");
  // And the credited account is still listed, so the figure can be explained.
  assert.deepEqual(view.accounts.map((a) => [a.code, a.total]), [["120", 400_000], ["110", -50_000]]);
});

test("an entry whose account is not in the chart of accounts is ignored", () => {
  const view = build({ entries: [...ENTRIES, { coa_code: "999", amount: 99_999 }] });
  assert.equal(view.cogs, 400_000);
  assert.ok(!amountsIn(view).includes(99_999));
});

test("an account with no entries is not listed, and does not disturb the total", () => {
  const view = build();
  assert.ok(!view.accounts.some((a) => a.code === "130"), "ของแห้ง has no entries this month");
  assert.equal(view.cogs, 400_000);
});

test("the result carries these keys and no others", () => {
  // A new field is a new thing reaching the browser, so it has to be
  // deliberate: this fails until it is added here.
  assert.deepEqual(Object.keys(build()).sort(), [
    "accounts", "cogs", "expenseDataIncomplete", "gapBaht", "gapPoints",
    "monthInProgress", "pctOfRevenue", "revenue", "targetPct", "yearMonth",
  ]);
  assert.deepEqual(Object.keys(build().accounts[0]!).sort(), ["code", "name", "pctOfRevenue", "total"]);
});

test("amounts that arrive as strings are added, not concatenated", () => {
  const view = build({
    revenueRows: [{ amount: "800000" as unknown as number }, { amount: "200000" as unknown as number }],
    entries: [{ coa_code: "110", amount: "1000" as unknown as number }, { coa_code: "120", amount: "2000" as unknown as number }],
  });
  assert.equal(view.revenue, 1_000_000);
  assert.equal(view.cogs, 3_000);
});
