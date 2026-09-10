/**
 * Run with:  npm test
 *
 * FORMULA layer, on workbooks built in memory in the shape of 69-08.xlsx.
 * The data layer — the real parser on the real file, Dec 2568 → Aug 2569,
 * every block locating structurally and the identity holding to the baht —
 * is run by hand and recorded in supabase/README.md, because the file lives
 * outside the repo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseOutsourceWorkbook, projectOutsourceMonth, resolveStoredYear, type OutsourceFile } from "./outsource.ts";

/** Excel serial for the calendar date Excel would DISPLAY — i.e. the stored, unresolved year. */
const serial = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;

type MonthSpec = {
  /** The year as Excel stored it (1968 for a typed "68"), and the month. */
  storedYear: number;
  month: number;
  days?: number;
  cardFee?: number;
  cash: [string, number][];
  monthly: [string, number][];
  /** รวมคชจ.; defaults to the identity so a test must opt in to breaking it. */
  total?: number;
  /** Month sheet: name and F7. `f7Ref` = the expense-sheet row the formula points at ("auto" = this month's รับอื่น ๆ row). */
  sheet?: { name: string; f7: number; f7Ref?: number | "auto" | "none" };
};

function build(expenseSheet: string, specs: MonthSpec[], extraSheets: string[] = []): XLSX.WorkBook {
  const grid: unknown[][] = [];
  const sheets: { name: string; f7: number; f: string | null }[] = [];
  for (const s of specs) {
    grid.push([null, "วันที่", "ยอดเต็ม"]);
    for (let d = 1; d <= (s.days ?? 3); d++) grid.push([serial(s.storedYear, s.month, d), 1000, 0]);
    const cashTotal = s.cash.reduce((a, [, v]) => a + v, 0);
    const monthlySum = s.monthly.reduce((a, [, v]) => a + v, 0);
    grid.push(["รวม", 3000]);
    grid.push([null, null, s.cardFee ?? 100, null, null, 2900]);
    grid.push([null, 0.03, 0, null, null, s.cardFee ?? 100]);
    grid.push([]);
    grid.push([null, null, "ขายสด", null, null, 1000]);
    const otherRow = grid.length + 1;
    grid.push([null, null, "รับอื่น ๆ", null, null, s.sheet?.f7 ?? 0]);
    grid.push([null, null, "รวม", null, null, 1000]);
    grid.push([]);
    grid.push([null, null, "หักจ่ายสด", null, null, cashTotal]);
    for (const [l, v] of s.cash) grid.push([null, null, l, null, null, v]);
    grid.push([]);
    for (const [l, v] of s.monthly) grid.push([null, null, l, null, null, v]);
    grid.push([null, null, "รวมคชจ.", null, null, s.total ?? cashTotal + monthlySum]);
    if (s.sheet) {
      const ref = s.sheet.f7Ref === "none" ? null : s.sheet.f7Ref === undefined || s.sheet.f7Ref === "auto" ? otherRow : s.sheet.f7Ref;
      sheets.push({ name: s.sheet.name, f7: s.sheet.f7, f: ref === null ? null : `+'${expenseSheet}'!F${ref}` });
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid as XLSX.CellObject[][]), expenseSheet);
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([[], [], [], [], [], [], [null, "รายได้อื่นๆ (ค่าเช่าร้าน+อื่นๆ)", null, null, null, s.f7]]);
    if (s.f) (ws["F7"] as XLSX.CellObject).f = s.f;
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  for (const n of extraSheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), n);
  return wb;
}

const parse = (wb: XLSX.WorkBook): OutsourceFile => {
  const p = parseOutsourceWorkbook(wb);
  if ("error" in p) throw new Error(p.error);
  return p.file;
};

const AUG: MonthSpec = {
  storedYear: 1969, month: 8, cardFee: 32681.52,
  cash: [["ผักสด", 245483], ["ค่าแรงพนักงาน", 78497], ["ค่าอาหารพนักงาน", 27725], ["ค่าเช่า", 9120], ["ค่าประกันสังคม", 36360], ["ค่าภ.ง.ด.1", 10]],
  monthly: [["ค่าแรงพนักงาน", 604970], ["เงินเดือนออฟฟิศ", 205000], ["ค่าอาหารพนักงาน", 71080], ["ค่าเช่า", 120000], ["ค่าไฟ", 82468.4], ["ค่าน้ำประปา", 12489.47], ["ค่าภงด.3,53", 4593.79], ["ค่า ภพ.30", 25545.81], ["ค่าทำบัญชี", 12480], ["จ่ายคืนร้านกาแฟ", 128625]],
  sheet: { name: "สค.69", f7: 20793 },
};

test("resolveStoredYear: the two-digit-year rule, the four-digit Buddhist rule, and CE untouched", () => {
  assert.equal(resolveStoredYear(1968), 2025, '"68" read by Excel as 1968 → BE 2568 → 2025');
  assert.equal(resolveStoredYear(1969), 2026);
  assert.equal(resolveStoredYear(1970), 2027, "the rollover");
  assert.equal(resolveStoredYear(2570), 2027, "typed in full");
  assert.equal(resolveStoredYear(2027), 2027, "already CE");
});

test("the month comes from the date column, not from any name: a 1969-08 block is 2026-08", () => {
  const f = parse(build("รับ-จ่าย69", [AUG]));
  assert.equal(f.expenseSheet, "รับ-จ่าย69");
  assert.deepEqual(f.months.map((m) => m.yearMonth), ["2026-08"]);
});

test("70-SERIES ROLLOVER: รับ-จ่าย70 with ธค.69 and มค.70 resolves to 2026-12 and 2027-01, two distinct months", () => {
  const dec: MonthSpec = { ...AUG, storedYear: 1969, month: 12, sheet: { name: "ธค.69", f7: 111 } };
  const jan: MonthSpec = { ...AUG, storedYear: 1970, month: 1, sheet: { name: "มค.70", f7: 222 } };
  const f = parse(build("รับ-จ่าย70", [dec, jan]));
  assert.equal(f.expenseSheet, "รับ-จ่าย70");
  assert.deepEqual(f.months.map((m) => m.yearMonth), ["2026-12", "2027-01"]);
  assert.deepEqual(f.months.map((m) => ("value" in m.other ? [m.other.sheet, m.other.value, m.other.tiedBy] : m.other)), [["ธค.69", 111, "formula+name"], ["มค.70", 222, "formula+name"]]);
  // And the same December typed a year earlier is a different month, not the same label.
  const dec68 = parse(build("รับ-จ่าย69", [{ ...dec, storedYear: 1968, sheet: { name: "ธค.68", f7: 1 } }]));
  assert.equal(dec68.months[0]!.yearMonth, "2025-12");
});

test("the expense sheet is found by pattern; none or several is a refusal, not a guess", () => {
  const none = parseOutsourceWorkbook(build("สรุป69", [AUG]));
  assert.ok("error" in none && /ไม่พบแผ่นรายจ่าย/.test(none.error));
  const two = parseOutsourceWorkbook(build("รับ-จ่าย69", [AUG], ["รับ-จ่าย70"]));
  assert.ok("error" in two && /มากกว่าหนึ่งแผ่น/.test(two.error));
});

test("a block whose dates span two months is refused by name", () => {
  const wb = build("รับ-จ่าย69", [AUG]);
  const ws = wb.Sheets["รับ-จ่าย69"]!;
  ws["A3"] = { t: "n", v: serial(1969, 9, 1) };
  const p = parseOutsourceWorkbook(wb);
  assert.ok("error" in p && /คนละเดือน/.test(p.error));
});

test("the monthly block is located after the blank row that follows the cash-paid block — twins resolve to the monthly figure", () => {
  const f = parse(build("รับ-จ่าย69", [AUG]));
  const m = f.months[0]!;
  assert.deepEqual(m.monthly.map((x) => x.label), AUG.monthly.map(([l]) => l));
  assert.equal(m.monthly.find((x) => x.label === "ค่าแรงพนักงาน")!.value, 604970);
  assert.equal(m.cashPaid.find((x) => x.label === "ค่าแรงพนักงาน")!.value, 78497);
  assert.equal(m.cardFee.value, 32681.52);
  assert.equal(m.cardFee.row, m.totalRow + 1);
  const { projection: p, blocks } = projectOutsourceMonth(m, new Map(), false);
  assert.deepEqual(blocks, []);
  const wage = p.entries.find((e) => e.coa_code === "220")!;
  assert.equal(wage.amount, 604970, "written in full");
  assert.deepEqual(wage.cashTwin, { row: m.cashPaid[1]!.row, label: "ค่าแรงพนักงาน", value: 78497 });
  assert.equal(p.entries.find((e) => e.coa_code === "745")!.amount, 32681.52);
  assert.equal(p.entries.find((e) => e.coa_code === "221")!.amount, 71080, "ค่าอาหารพนักงาน → 221");
  assert.equal(p.other, 20793);
});

test("figures are written in full: the app's daily on the same code is carried, never subtracted", () => {
  const f = parse(build("รับ-จ่าย69", [AUG]));
  const { projection: p } = projectOutsourceMonth(f.months[0]!, new Map([["221", 9360], ["952", 10]]), false);
  const meals = p.entries.find((e) => e.coa_code === "221")!;
  assert.equal(meals.amount, 71080);
  assert.equal(meals.appDaily, 9360);
  assert.equal(p.entries.find((e) => e.coa_code === "952")!.amount, 4593.79, "the ฿10 ภ.ง.ด.1 leak is accepted, not corrected");
  assert.equal(p.writtenTotal, p.blockTotal);
});

test("ค่าประกันสังคม and จ่ายคืนร้านกาแฟ are shown and never written; the social-security check compares file vs daily 230+231", () => {
  const f = parse(build("รับ-จ่าย69", [AUG]));
  const ok = projectOutsourceMonth(f.months[0]!, new Map([["231", 36360]]), false).projection;
  assert.equal(ok.entries.some((e) => e.coa_code === "230" || e.coa_code === "231"), false);
  const ss = ok.notImported.find((n) => n.label === "ค่าประกันสังคม")!;
  assert.equal(ss.value, 36360); assert.equal(ss.appDaily, 36360); assert.equal(ss.mismatch, false);
  const coffee = ok.notImported.find((n) => n.label === "จ่ายคืนร้านกาแฟ")!;
  assert.equal(coffee.value, 128625);
  assert.equal(ok.blockTotal, 604970 + 205000 + 71080 + 120000 + 82468.4 + 12489.47 + 4593.79 + 25545.81 + 12480 + 32681.52);
  const bad = projectOutsourceMonth(f.months[0]!, new Map([["230", 20000]]), false).projection;
  assert.equal(bad.notImported.find((n) => n.label === "ค่าประกันสังคม")!.mismatch, true);
});

test("an unknown label in the monthly block is a named stop with its row and amount", () => {
  const spec: MonthSpec = { ...AUG, monthly: [...AUG.monthly, ["ค่าอะไรใหม่", 777]] };
  const f = parse(build("รับ-จ่าย69", [spec]));
  const { blocks } = projectOutsourceMonth(f.months[0]!, new Map(), false);
  const b = blocks.find((x) => x.kind === "unmapped");
  assert.ok(b && b.kind === "unmapped");
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0]!.label, "ค่าอะไรใหม่");
  assert.equal(b.rows[0]!.value, 777);
  assert.equal(b.rows[0]!.row, f.months[0]!.monthly.at(-1)!.row);
  assert.equal(blocks.some((x) => x.kind === "identity"), false, "the identity still holds — the row is in the sheet's own total");
});

test("THE STOP: รวมคชจ. ≠ หักจ่ายสด + Σ(monthly block) is a block, not a warning", () => {
  const cashTotal = AUG.cash.reduce((a, [, v]) => a + v, 0);
  const monthlySum = AUG.monthly.reduce((a, [, v]) => a + v, 0);
  const f = parse(build("รับ-จ่าย69", [{ ...AUG, total: cashTotal + monthlySum + 5000 }]));
  const { blocks } = projectOutsourceMonth(f.months[0]!, new Map(), false);
  const b = blocks.find((x) => x.kind === "identity");
  assert.ok(b && b.kind === "identity");
  assert.equal(b.diff, 5000);
});

test("two labels on one code in the same month are summed and both rows kept (June's ค่าทำบัญชี+ ค่าสอบบัญชี)", () => {
  const spec: MonthSpec = { ...AUG, monthly: AUG.monthly.map(([l, v]): [string, number] => (l === "ค่าทำบัญชี" ? ["ค่าทำบัญชี+ ค่าสอบบัญชี", 35360] : [l, v])).concat([["ค่าภงด.50", 44661.5], ["ค่าภาษีที่ดิน", 121425]]) };
  const f = parse(build("รับ-จ่าย69", [spec]));
  const { projection: p, blocks } = projectOutsourceMonth(f.months[0]!, new Map(), false);
  assert.deepEqual(blocks, []);
  assert.equal(p.entries.find((e) => e.coa_code === "710")!.amount, 35360);
  assert.equal(p.entries.find((e) => e.coa_code === "959")!.amount, 44661.5);
  assert.equal(p.entries.find((e) => e.coa_code === "954")!.amount, 121425);
});

test("a budget69-owned month writes only `other`: entries empty, stated on the projection", () => {
  const f = parse(build("รับ-จ่าย69", [{ ...AUG, storedYear: 1969, month: 7, sheet: { name: "กค.69", f7: 18165 } }]));
  const { projection: p, blocks } = projectOutsourceMonth(f.months[0]!, new Map(), true);
  assert.deepEqual(blocks, []);
  assert.equal(p.budget69Owned, true);
  assert.deepEqual(p.entries, []);
  assert.equal(p.writtenTotal, 0);
  assert.equal(p.other, 18165);
  assert.ok(p.blockTotal > 0, "the block is still parsed and shown");
});

test("other: tied by the F7 formula when the name is missing, by the name when F7 is a constant, refused when they disagree or neither exists", () => {
  // Formula only: a sheet whose name does not match the abbreviation table.
  const byFormula = parse(build("รับ-จ่าย69", [{ ...AUG, sheet: { name: "สค.69", f7: 5 } }]));
  assert.ok("value" in byFormula.months[0]!.other && byFormula.months[0]!.other.tiedBy === "formula+name");
  // Constant F7 (March 2569 is a typed 0): name only.
  const byName = parse(build("รับ-จ่าย69", [{ ...AUG, sheet: { name: "สค.69", f7: 0, f7Ref: "none" } }]));
  assert.deepEqual(byName.months[0]!.other, { sheet: "สค.69", value: 0, tiedBy: "name" });
  // Name says July, formula points at this (August) block: disagreement is a stop.
  const clash = parse(build("รับ-จ่าย69", [{ ...AUG, sheet: { name: "กค.69", f7: 5 } }]));
  const o = clash.months[0]!.other;
  assert.ok("missing" in o || ("value" in o && o.tiedBy === "formula"));
  // No sheet at all: the projection blocks, other is null, never zero.
  const none = parse(build("รับ-จ่าย69", [{ ...AUG, sheet: undefined }]));
  const { projection: p, blocks } = projectOutsourceMonth(none.months[0]!, new Map(), false);
  assert.equal(p.other, null);
  assert.ok(blocks.some((x) => x.kind === "other-missing"));
});

test("a zero F7 is a value (March 2569), not a missing one", () => {
  const f = parse(build("รับ-จ่าย69", [{ ...AUG, storedYear: 1969, month: 3, sheet: { name: "มีค.69", f7: 0, f7Ref: "none" } }]));
  const { projection: p, blocks } = projectOutsourceMonth(f.months[0]!, new Map(), true);
  assert.deepEqual(blocks, []);
  assert.equal(p.other, 0);
});
