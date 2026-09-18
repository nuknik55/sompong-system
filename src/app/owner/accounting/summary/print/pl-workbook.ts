/**
 * The owner's P&L Excel file: two sheets from one month (Nik, 2026-09-17).
 *
 *   ฉบับเต็ม        everything, as the screen shows it. The owner-only
 *                   account (790) and every figure that contains it are
 *                   marked, so the reader knows which numbers not to quote.
 *   สำหรับประชุม   the same month with the owner-only accounts taken out and
 *                   every total and percentage recomputed from what is left,
 *                   so the sheet adds up on its own. Nothing on it says that
 *                   anything was removed.
 *
 * Pure: rows in, rows out, no library and no import of a value, so the test
 * runner loads it as is. The client (PLPrintClient) turns the rows into cells
 * and paints the marked rows; the tests prove what the meeting sheet does and
 * does not contain.
 */
import type { MonthlyCovers, MonthlySummaryGroup } from "../../actions";
import type { MonthCompleteness } from "../completeness";

export type PlSummary = {
  groups: MonthlySummaryGroup[];
  nonOperating: MonthlySummaryGroup[];
  totalRevenue: number;
  operatingExpense: number;
  capex: number;
  tax: number;
} & MonthCompleteness;

export type Cell = string | number;

export type SheetSpec = {
  name: string;
  rows: Cell[][];
  /** Row indexes (0-based) whose figures contain an owner-only account. Empty on the meeting sheet. */
  markedRows: number[];
  /** The first row that carries amounts; number formats apply from here down. */
  numbersFrom: number;
  /** Rows whose amount is a count (bills, customers), formatted without decimals. */
  countRows: number[];
};

// Two "other" lines, deliberately distinguished: pos_other is the POS's own
// อื่นๆ group (ค่าทำ/ค่าห้อง, เพิ่มราคา), while other is the figure the
// accountants compile — scrap and used-oil sales among other things.
export const REVENUE_LABELS: Record<string, string> = {
  food: "อาหาร",
  drink: "เครื่องดื่ม",
  dessert: "ของหวาน",
  delivery: "เดลิเวอรี่",
  souvenir: "ของฝาก",
  pos_other: "อื่นๆ (POS)",
  other: "อื่นๆ (บัญชี)",
};
export const REVENUE_KEYS = ["food", "drink", "dessert", "delivery", "souvenir", "pos_other", "other"];

export const FULL_SHEET = "ฉบับเต็ม";
export const MEETING_SHEET = "สำหรับประชุม";

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

/**
 * The month without its owner-only accounts, every total recomputed from the
 * rows that remain. A group left with no rows is dropped, as the screen
 * drops a group with no entries.
 */
export function withoutSensitive(s: PlSummary): PlSummary {
  const strip = (groups: MonthlySummaryGroup[]) =>
    groups
      .map((g) => {
        const accounts = g.accounts
          .filter((a) => !a.is_sensitive)
          .map((a) => ({ ...a, pct_of_revenue: s.totalRevenue > 0 ? pct(a.total, s.totalRevenue) : null }));
        const total = accounts.reduce((sum, a) => sum + a.total, 0);
        return { ...g, accounts, total, pct_of_revenue: s.totalRevenue > 0 ? pct(total, s.totalRevenue) : null };
      })
      .filter((g) => g.accounts.length > 0);
  const groups = strip(s.groups);
  const nonOperating = strip(s.nonOperating);
  return {
    ...s,
    groups,
    nonOperating,
    operatingExpense: groups.reduce((sum, g) => sum + g.total, 0),
    capex: nonOperating.find((g) => g.group_code === "G990")?.total ?? 0,
    tax: nonOperating.find((g) => g.group_code === "G950")?.total ?? 0,
  };
}

/** True when any account in the month is owner-only and has an amount. */
export function hasSensitive(s: PlSummary): boolean {
  return [...s.groups, ...s.nonOperating].some((g) => g.accounts.some((a) => a.is_sensitive));
}

function sheet(
  name: string,
  title: string,
  s: PlSummary,
  revenueMap: Record<string, number>,
  covers: MonthlyCovers | null,
  notices: string[],
  mark: boolean,
): SheetSpec {
  const rows: Cell[][] = [];
  const markedRows: number[] = [];
  const countRows: number[] = [];
  const push = (row: Cell[], marked = false) => {
    if (marked && mark) markedRows.push(rows.length);
    rows.push(row);
  };

  push([title]);
  // A warning is a CELL, not a styled banner: this file leaves the building,
  // and a reader in Excel has none of the screen's context.
  for (const notice of notices) push([`*** ${notice}`]);
  push([]);

  push(["รายได้", "", "จำนวน (฿)", "% ของรายได้"]);
  const numbersFrom = rows.length;
  for (const key of REVENUE_KEYS) {
    const amt = revenueMap[key] ?? 0;
    if (amt > 0) push([REVENUE_LABELS[key]!, "", amt, pct(amt, s.totalRevenue)]);
  }
  push(["รวมรายได้", "", s.totalRevenue, 100]);
  if (covers) {
    countRows.push(rows.length);
    push(["จำนวนบิล", "", covers.bills, ""]);
    countRows.push(rows.length);
    push(["จำนวนลูกค้า", "", covers.customers, ""]);
  }
  push([]);

  // A group's total contains the owner-only account if one of its rows is
  // one, and so do the operating total and the profit line below.
  const groupHasSensitive = (g: MonthlySummaryGroup) => g.accounts.some((a) => a.is_sensitive);
  const operatingHasSensitive = s.groups.some(groupHasSensitive);

  push(["ค่าใช้จ่าย", "", "จำนวน (฿)", "% จริง", "% เป้า"]);
  for (const g of s.groups) {
    if (g.total === 0) continue;
    push([g.group_name, "", g.total, g.pct_of_revenue ?? 0, g.target_pct ?? ""], groupHasSensitive(g));
    for (const a of g.accounts) {
      push([`  ${a.name}`, "", a.total, a.pct_of_revenue ?? 0, ""], a.is_sensitive);
    }
  }
  push(["รวมค่าใช้จ่ายดำเนินงาน", "", s.operatingExpense, pct(s.operatingExpense, s.totalRevenue), ""], operatingHasSensitive);
  push([]);

  // Operating profit. CapEx and tax are listed below it and never subtracted,
  // so an exported month stays comparable with the month beside it.
  const operatingProfit = s.totalRevenue - s.operatingExpense;
  push(["กำไรจากการดำเนินงาน", "", operatingProfit, pct(operatingProfit, s.totalRevenue)], operatingHasSensitive);
  push([]);

  push(["รายการที่ไม่หักจากกำไรดำเนินงาน", "", "จำนวน (฿)", "% ของรายได้", ""]);
  for (const g of s.nonOperating) {
    push([g.group_name, "", g.total, g.pct_of_revenue ?? 0, ""], groupHasSensitive(g));
    for (const a of g.accounts) {
      push([`  ${a.name}`, "", a.total, a.pct_of_revenue ?? 0, ""], a.is_sensitive);
    }
  }

  return { name, rows, markedRows, numbersFrom, countRows };
}

/** Both sheets of the owner's file. The meeting sheet is built from the stripped month, so it is never marked. */
export function buildPlWorkbook(
  thaiMonth: string,
  summary: PlSummary,
  revenueMap: Record<string, number>,
  covers: MonthlyCovers | null,
  /** completenessNotices(summary): about the month, not about any account, so both sheets carry them. */
  notices: string[],
): { full: SheetSpec; meeting: SheetSpec } {
  const title = `งบกำไรขาดทุน (P&L) — ${thaiMonth}`;
  return {
    full: sheet(FULL_SHEET, title, summary, revenueMap, covers, notices, true),
    meeting: sheet(MEETING_SHEET, title, withoutSensitive(summary), revenueMap, covers, notices, false),
  };
}
