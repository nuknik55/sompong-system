/**
 * Run with: npm test — the owner's two-sheet P&L file (Nik, 2026-09-17).
 *
 * The meeting sheet must carry no trace of the owner-only account and must
 * add up from its own rows; the full sheet must mark that account and every
 * figure that contains it. The first test shows the leak-finder used below
 * can find a leak, so a passing meeting sheet means something.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlWorkbook, withoutSensitive, hasSensitive, FULL_SHEET, MEETING_SHEET,
  type PlSummary, type SheetSpec, type Cell,
} from "./pl-workbook.ts";

const OWNER_PAY = 60000;
const OWNER_NAME = "เงินเดือนเจ้าของร้าน";

const acc = (code: string, name: string, total: number, revenue: number, is_sensitive = false) => ({
  code, name, total, pct_of_revenue: (total / revenue) * 100, is_sensitive,
});
function month(withOwnerPay: boolean): PlSummary {
  const revenue = 1_000_000;
  const cogs = [acc("110", "ผักสด", 200000, revenue), acc("120", "ของสด", 180000, revenue)];
  const ga = [acc("710", "ค่าเช่า", 50000, revenue), ...(withOwnerPay ? [acc("790", OWNER_NAME, OWNER_PAY, revenue, true)] : [])];
  const tax = [acc("951", "ภาษีมูลค่าเพิ่ม", 12000, revenue)];
  const group = (code: string, name: string, target: number | null, accounts: ReturnType<typeof acc>[]) => {
    const total = accounts.reduce((s, a) => s + a.total, 0);
    return { group_code: code, group_name: name, target_pct: target, total, pct_of_revenue: (total / revenue) * 100, accounts };
  };
  const groups = [group("G100", "ต้นทุนวัตถุดิบ (COGS)", 38, cogs), group("G700", "บริหาร (G&A)", null, ga)];
  const nonOperating = [group("G950", "ภาษี", null, tax)];
  return {
    groups, nonOperating, totalRevenue: revenue,
    operatingExpense: groups.reduce((s, g) => s + g.total, 0),
    capex: 0, tax: 12000,
    expenseDataIncomplete: false, monthInProgress: false,
  };
}
const REVENUE = { food: 800000, drink: 200000 };
const COVERS = { bills: 2500, customers: 6000, cancelledBills: 3, cancelledAmount: 1200 };

/** Every cell of a sheet that names or equals the owner-only figure. */
function leaks(sheet: SheetSpec): Cell[] {
  return sheet.rows.flat().filter((c) => (typeof c === "string" ? c.includes(OWNER_NAME) : c === OWNER_PAY));
}
const numberIn = (row: Cell[]) => row[2] as number;
const rowNamed = (sheet: SheetSpec, name: string) => {
  const r = sheet.rows.find((row) => typeof row[0] === "string" && row[0].trim() === name);
  assert.ok(r, `row "${name}" is missing`);
  return r!;
};
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.005, `${what}: ${a} vs ${b}`);

test("the leak-finder finds the owner-only account on the FULL sheet", () => {
  const { full } = buildPlWorkbook("สิงหาคม 2569", month(true), REVENUE, COVERS, []);
  assert.equal(full.name, FULL_SHEET);
  assert.ok(leaks(full).length >= 2, "the full sheet must show the account and its amount");
});

test("the meeting sheet holds no owner-only name, amount, or mention of a removal", () => {
  const { meeting } = buildPlWorkbook("สิงหาคม 2569", month(true), REVENUE, COVERS, []);
  assert.equal(meeting.name, MEETING_SHEET);
  assert.deepEqual(leaks(meeting), []);
  const text = meeting.rows.flat().filter((c): c is string => typeof c === "string").join("\n");
  for (const word of ["ไม่แสดง", "ตัด", "ซ่อน", "เจ้าของร้าน", "790", "***"]) assert.ok(!text.includes(word), word);
});

test("the meeting sheet adds up from its own visible rows", () => {
  const { meeting } = buildPlWorkbook("สิงหาคม 2569", month(true), REVENUE, COVERS, []);
  const revenue = numberIn(rowNamed(meeting, "รวมรายได้"));
  const opex = numberIn(rowNamed(meeting, "รวมค่าใช้จ่ายดำเนินงาน"));
  const profit = numberIn(rowNamed(meeting, "กำไรจากการดำเนินงาน"));
  // Each group row equals the sum of the account rows under it, and the
  // operating total equals the sum of the group rows.
  const start = meeting.rows.findIndex((r) => r[0] === "ค่าใช้จ่าย") + 1;
  const end = meeting.rows.findIndex((r) => r[0] === "รวมค่าใช้จ่ายดำเนินงาน");
  let groupSum = 0, groupTotal: number | null = null, accountSum = 0;
  const closeGroup = () => { if (groupTotal !== null) near(groupTotal, accountSum, "group total"); };
  for (let i = start; i < end; i++) {
    const row = meeting.rows[i]!;
    const label = row[0] as string;
    if (label.startsWith("  ")) accountSum += numberIn(row);
    else { closeGroup(); groupTotal = numberIn(row); groupSum += groupTotal; accountSum = 0; }
  }
  closeGroup();
  near(opex, groupSum, "operating expense");
  near(profit, revenue - opex, "profit");
  near(rowNamed(meeting, "รวมค่าใช้จ่ายดำเนินงาน")[3] as number, (opex / revenue) * 100, "opex %");
  near(rowNamed(meeting, "กำไรจากการดำเนินงาน")[3] as number, (profit / revenue) * 100, "profit %");
  // And the figures are the stripped ones, not the full ones.
  assert.equal(opex, 430000);
  assert.equal(profit, 570000);
  near(rowNamed(meeting, "บริหาร (G&A)")[3] as number, 5, "G&A % without the owner's pay");
});

test("the full sheet marks the owner-only row and exactly the figures that contain it", () => {
  const { full } = buildPlWorkbook("สิงหาคม 2569", month(true), REVENUE, COVERS, []);
  const marked = full.markedRows.map((i) => (full.rows[i]![0] as string).trim());
  assert.deepEqual(marked, ["บริหาร (G&A)", OWNER_NAME, "รวมค่าใช้จ่ายดำเนินงาน", "กำไรจากการดำเนินงาน"]);
  // COGS, revenue and tax do not contain it and are not marked.
  assert.equal(numberIn(rowNamed(full, "รวมค่าใช้จ่ายดำเนินงาน")), 490000);
  assert.equal(numberIn(rowNamed(full, "กำไรจากการดำเนินงาน")), 510000);
});

test("a month with no owner-only entries gives two identical sheets and no marks", () => {
  const { full, meeting } = buildPlWorkbook("กรกฎาคม 2569", month(false), REVENUE, null, []);
  assert.deepEqual(full.rows, meeting.rows);
  assert.deepEqual(full.markedRows, []);
  assert.equal(hasSensitive(month(false)), false);
  assert.equal(hasSensitive(month(true)), true);
});

test("withoutSensitive drops a group left empty and recomputes CapEx and tax", () => {
  const m = month(true);
  m.nonOperating.push({
    group_code: "G990", group_name: "CapEx", target_pct: null, total: 5000, pct_of_revenue: 0.5,
    accounts: [acc("991", "ซื้อเครื่อง (เจ้าของ)", 5000, 1_000_000, true)],
  });
  m.capex = 5000;
  const s = withoutSensitive(m);
  assert.deepEqual(s.nonOperating.map((g) => g.group_code), ["G950"]);
  assert.equal(s.capex, 0);
  assert.equal(s.tax, 12000);
  assert.equal(s.operatingExpense, 430000);
});
