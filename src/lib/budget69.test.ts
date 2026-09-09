/**
 * Run with:  npm test
 *
 * FORMULA layer, on synthetic grids shaped like งบ69. The data layer — the
 * real parser and projection on the real file, Jan–Jul 2569, reconciling to
 * the sheet's own bottom line to the baht in every month — is run by hand
 * and recorded in supabase/README.md, because the file lives outside the
 * repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBudget69Grid, projectBudget69Month } from "./budget69.ts";

/**
 * A grid with row 2 carrying twelve budget/actual pairs. Actual columns are
 * placed like the real sheet: budget at c, actual at c+2, with an unrelated
 * column between and quarter columns interleaved — the column map must be
 * derived, never assumed.
 */
function grid(rows: [string, ...number[]][]): unknown[][] {
  const header: unknown[] = [null, null];
  const actualCol: number[] = [];
  let c = 2;
  for (let m = 1; m <= 12; m++) {
    header[c] = m; header[c + 1] = null; header[c + 2] = m; header[c + 3] = null;
    actualCol[m] = c + 2;
    c += 4;
    if (m % 3 === 0) { header[c] = `งบQ${m / 3}`; header[c + 2] = `รวมQ${m / 3}`; c += 4; }
  }
  const out: unknown[][] = [[null, "ทำค่าPF"], header];
  for (const [name, ...actuals] of rows) {
    const r: unknown[] = [null, name];
    for (let m = 1; m <= 12; m++) { r[actualCol[m]!] = actuals[m - 1] ?? 0; r[actualCol[m]! - 2] = 999999; /* budget: must never be read */ }
    out.push(r);
  }
  return out;
}

const parse = (rows: [string, ...number[]][]) => {
  const p = parseBudget69Grid(grid(rows));
  if ("error" in p) throw new Error(p.error);
  return p.sheet;
};

test("column map: the SECOND occurrence of a month number is the actual, never the budget", () => {
  const sheet = parse([["ยอดขาย", 100, 200], ["ผักสด", 10, 20], ["Net Profit", 90, 180]]);
  const row = sheet.rows.find((r) => r.name === "ผักสด")!;
  assert.equal(row.actual[1], 10);
  assert.equal(row.actual[2], 20);
  assert.equal(row.actual[3], 0);
});

test("a sheet without twelve budget/actual pairs is refused, not guessed", () => {
  const g = grid([["ยอดขาย", 1], ["Net Profit", 1]]);
  (g[1] as unknown[])[4] = null; // remove month 1's actual header
  const p = parseBudget69Grid(g);
  assert.ok("error" in p);
  assert.match(p.error, /เดือน 1/);
});

test("rows below Net Profit are cut — targets and templates, not actuals", () => {
  const sheet = parse([["ยอดขาย", 1], ["ผักสด", 1], ["Net Profit", 0], ["ครัว 7-8.5%", 500], ["ผักสด", 777]]);
  assert.equal(sheet.rows.filter((r) => r.name === "ผักสด").length, 1);
  assert.equal(sheet.rows.at(-1)!.name, "Net Profit");
});

test("the remainder rule: lump = sheet − app entries, clamped at zero and reported", () => {
  const sheet = parse([["ยอดขาย", 1000, 1000], ["ผักสด", 100, 100], ["ค่าเครื่องเขียน", 50, 50], ["Net Profit", 850, 850]]);
  const { projection: p, blocks } = projectBudget69Month(sheet, 1, new Map([["110", 40], ["780", 60]]), "2026-01");
  assert.deepEqual(blocks, []);
  const by = Object.fromEntries(p.entries.map((e) => [e.coa_code, e]));
  assert.equal(by["110"]!.lump, 60);
  assert.equal(by["780"]!.lump, 0, "app exceeded the sheet: clamped");
  assert.deepEqual(p.negatives, [{ coa_code: "780", sheetAmount: 50, appAmount: 60 }]);
  assert.equal(p.writtenTotal, 60);
});

test("POS-owned codes are excluded from entries and shown separately", () => {
  const sheet = parse([["ยอดขาย", 1000], ["Discount", 80], ["- ค่า GP Lineman", 30], ["ผักสด", 10], ["Net Profit", 880]]);
  const { projection: p, blocks } = projectBudget69Month(sheet, 1, new Map(), "2026-01");
  assert.deepEqual(blocks, []);
  assert.deepEqual(p.entries.map((e) => e.coa_code), ["110"]);
  assert.deepEqual(p.posOwned.map((x) => `${x.coa_code}=${x.sheetAmount}`), ["650=80", "752=30"]);
});

test("a mapped parent covers its unmapped detail lines; they are not entries and do not block", () => {
  // Supply - ครัว 100 = จาน 60 + ถุงมือดำ 40, two months so it is a parent by arithmetic.
  const sheet = parse([["ยอดขาย", 500, 500], ["Supply - ครัว", 100, 70], ["จาน", 60, 30], ["ถุงมือดำ", 40, 40], ["Net Profit", 400, 430]]);
  const { projection: p, blocks } = projectBudget69Month(sheet, 1, new Map(), "2026-01");
  assert.deepEqual(blocks, []);
  assert.deepEqual(p.entries.map((e) => [e.coa_code, e.sheetAmount]), [["810", 100]]);
});

test("an unmapped subtotal is skipped and its mapped children stand on their own", () => {
  const sheet = parse([["ยอดขาย", 500, 500], ["- ต้นทุนอาหาร", 30, 50], ["ผักสด", 10, 20], ["ของสด", 20, 30], ["Net Profit", 470, 450]]);
  const { projection: p, blocks } = projectBudget69Month(sheet, 2, new Map(), "2026-02");
  assert.deepEqual(blocks, []);
  assert.deepEqual(p.entries.map((e) => [e.coa_code, e.sheetAmount]), [["110", 20], ["120", 30]]);
});

test("a parent with a mapped child is split: children are the entries, the parent is not", () => {
  // Variable MKT 6 = ของแจก 4 (→630) + ค่าสิ่งพิมพ์ 2 (→610); lumping the parent
  // into 630 would set 610's remainder against the wrong figure.
  const sheet = parse([["ยอดขาย", 100, 100], ["Variable MKT", 6, 6], ["ของแจก", 4, 4], ["ค่าสิ่งพิมพ์", 2, 2], ["Net Profit", 94, 94]]);
  const { projection: p, blocks } = projectBudget69Month(sheet, 1, new Map([["610", 5]]), "2026-01");
  assert.deepEqual(blocks, []);
  const by = Object.fromEntries(p.entries.map((e) => [e.coa_code, e]));
  assert.equal(by["630"]!.sheetAmount, 4);
  assert.equal(by["610"]!.sheetAmount, 2);
  assert.equal(by["610"]!.lump, 0);
  assert.equal(p.negatives.length, 1);
});

test("a subtotal whose formula skips a child in SOME months is still a parent, and the skip is named", () => {
  // - ต้นทุนอื่นๆ: Jan formula includes ของฝาก (0 anyway), Feb includes it, Mar leaves it out.
  const sheet = parse([
    ["ยอดขาย", 100, 100, 100],
    ["- ต้นทุนอื่นๆ", 10, 15, 10],
    ["ของฝาก", 0, 5, 3],
    ["ค่าขนส่งวัตถุดิบ", 10, 10, 10],
    ["Net Profit", 90, 85, 90],
  ]);
  const mar = projectBudget69Month(sheet, 3, new Map(), "2026-03");
  assert.deepEqual(mar.blocks, [], "reconciles once the skipped row is named");
  assert.deepEqual(mar.projection.sheetExcluded, [{ row: 5, name: "ของฝาก", amount: 3 }]);
  assert.deepEqual(mar.projection.entries.map((e) => [e.coa_code, e.sheetAmount]), [["170", 10], ["174", 3]]);
  const feb = projectBudget69Month(sheet, 2, new Map(), "2026-02");
  assert.deepEqual(feb.projection.sheetExcluded, [], "February's formula included it");
});

test("memo rows are covered by their parent and never become entries", () => {
  const sheet = parse([["ยอดขาย", 100, 100], ["Discount", 8, 8], ["ส่วนลด", 7, 7], ["คะแนนcrm(ต้องเอามาหาร50%)", 1, 1], ["Net Profit", 92, 92]]);
  const { projection: p, blocks } = projectBudget69Month(sheet, 1, new Map(), "2026-01");
  assert.deepEqual(blocks, []);
  assert.deepEqual(p.posOwned, [{ coa_code: "650", sheetAmount: 8 }]);
  assert.deepEqual(p.entries, []);
});

test("an unmapped row with money BLOCKS, named, with its amount", () => {
  const sheet = parse([["ยอดขาย", 100], ["ผักสด", 10], ["ค่าอะไรสักอย่าง", 7], ["Net Profit", 83]]);
  const { blocks } = projectBudget69Month(sheet, 1, new Map(), "2026-01");
  const b = blocks.find((x) => x.kind === "unmapped");
  assert.ok(b && b.kind === "unmapped");
  assert.deepEqual(b.rows, [{ row: 5, name: "ค่าอะไรสักอย่าง", amount: 7 }]);
  assert.equal(blocks.some((x) => x.kind === "unexplained"), false, "named blocks explain the total");
});

test("THE STOP: the sheet's bottom line disagreeing with everything named is a block, not a warning", () => {
  // Net Profit says costs were 20; the rows only name 10. Something in the
  // sheet is not being seen. Must refuse.
  const sheet = parse([["ยอดขาย", 100], ["ผักสด", 10], ["Net Profit", 80]]);
  const { blocks } = projectBudget69Month(sheet, 1, new Map(), "2026-01");
  const b = blocks.find((x) => x.kind === "unexplained");
  assert.ok(b && b.kind === "unexplained");
  assert.equal(b.sheetExpenseTotal, 20);
  assert.equal(b.explained, 10);
  assert.equal(b.diff, 10);
});

test("app entries for codes the sheet has no row for are listed, not silently ignored", () => {
  const sheet = parse([["ยอดขาย", 100], ["ผักสด", 10], ["Net Profit", 90]]);
  const { projection: p } = projectBudget69Month(sheet, 1, new Map([["993", 50000], ["998", 4073]]), "2026-01");
  assert.deepEqual(p.appOnly, [{ coa_code: "993", appAmount: 50000 }, { coa_code: "998", appAmount: 4073 }]);
});
