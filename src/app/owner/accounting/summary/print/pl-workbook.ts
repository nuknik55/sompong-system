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
 * No runtime import, so the test runner loads it as is: the library is PASSED
 * IN (sheetFromSpec, buildPlFile) rather than imported, which also keeps it
 * off the page until the button is pressed. Everything the reader sees in
 * Excel is decided here — widths, number formats, the header band, the filter
 * and the frozen rows — so pl-excel.test.ts can build the real file, read it
 * back, and check it. The client only hands over the bytes.
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
  /** The "*** " warnings under the title. */
  noticeRows: number[];
  /** The three section headers (รายได้, ค่าใช้จ่าย, รายการที่ไม่หัก...) — white on dark. */
  headerRows: number[];
  /** Group lines, bold above their accounts. */
  groupRows: number[];
  /** รวม / กำไร lines: bold, with a rule above. */
  totalRows: number[];
  /**
   * The expense list, which is what the autofilter covers. Excel allows ONE
   * filter range per sheet, so it goes on the long list a person actually
   * sorts; the totals below it stay outside the range, where a filter cannot
   * hide them and a sort cannot move them. null when the month has no
   * expense rows at all.
   */
  filter: { headerRow: number; lastRow: number } | null;
  /** Rows frozen at the top: the title, the notices and the column header. */
  freezeRows: number;
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
  const noticeRows: number[] = [];
  const headerRows: number[] = [];
  const groupRows: number[] = [];
  const totalRows: number[] = [];
  const push = (row: Cell[], marked = false) => {
    if (marked && mark) markedRows.push(rows.length);
    rows.push(row);
  };
  /** Records the row about to be pushed. `at(headerRows); push(...)` */
  const at = (list: number[]) => list.push(rows.length);

  push([title]);
  // A warning is a CELL, not a styled banner: this file leaves the building,
  // and a reader in Excel has none of the screen's context. It is bold and
  // brown in the file, which is as far as styling a sentence should go.
  for (const notice of notices) {
    at(noticeRows);
    push([`*** ${notice}`]);
  }
  push([]);

  // Every header row spans all five columns, empty cells included, so the
  // dark band and the filter arrows cover the same width on each of them.
  at(headerRows);
  push(["รายได้", "", "จำนวน (฿)", "% ของรายได้", ""]);
  const numbersFrom = rows.length;
  for (const key of REVENUE_KEYS) {
    const amt = revenueMap[key] ?? 0;
    if (amt > 0) push([REVENUE_LABELS[key]!, "", amt, pct(amt, s.totalRevenue)]);
  }
  at(totalRows);
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

  at(headerRows);
  const filterHeader = rows.length;
  push(["ค่าใช้จ่าย", "", "จำนวน (฿)", "% จริง", "% เป้า"]);
  for (const g of s.groups) {
    if (g.total === 0) continue;
    at(groupRows);
    push([g.group_name, "", g.total, g.pct_of_revenue ?? 0, g.target_pct ?? ""], groupHasSensitive(g));
    for (const a of g.accounts) {
      push([`  ${a.name}`, "", a.total, a.pct_of_revenue ?? 0, ""], a.is_sensitive);
    }
  }
  // The filter stops at the last expense line: รวม and กำไร below it are not
  // rows a filter may hide or a sort may reorder.
  const filterLast = rows.length - 1;
  at(totalRows);
  push(["รวมค่าใช้จ่ายดำเนินงาน", "", s.operatingExpense, pct(s.operatingExpense, s.totalRevenue), ""], operatingHasSensitive);
  push([]);

  // Operating profit. CapEx and tax are listed below it and never subtracted,
  // so an exported month stays comparable with the month beside it.
  const operatingProfit = s.totalRevenue - s.operatingExpense;
  at(totalRows);
  push(["กำไรจากการดำเนินงาน", "", operatingProfit, pct(operatingProfit, s.totalRevenue)], operatingHasSensitive);
  push([]);

  at(headerRows);
  push(["รายการที่ไม่หักจากกำไรดำเนินงาน", "", "จำนวน (฿)", "% ของรายได้", ""]);
  for (const g of s.nonOperating) {
    at(groupRows);
    push([g.group_name, "", g.total, g.pct_of_revenue ?? 0, ""], groupHasSensitive(g));
    for (const a of g.accounts) {
      push([`  ${a.name}`, "", a.total, a.pct_of_revenue ?? 0, ""], a.is_sensitive);
    }
  }

  return {
    name, rows, markedRows, numbersFrom, countRows,
    noticeRows, headerRows, groupRows, totalRows,
    filter: filterLast > filterHeader ? { headerRow: filterHeader, lastRow: filterLast } : null,
    // Everything above the first amount: the title, any warning, and the
    // column header, which labels C and D for the whole sheet.
    freezeRows: numbersFrom,
  };
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

// ── The Excel file ────────────────────────────────────────────────────────────
//
// xlsx-js-style, not xlsx: the file needs cells painted, and the community
// edition of SheetJS writes no cell styles at all (its writer says
// "TODO: cell style"). Two things it still cannot do, both checked against the
// installed copy (1.2.0) rather than assumed:
//
//   - a real Excel TABLE, the thing Excel calls a ListObject. The writer has
//     no tableParts at all, so a "table" here is what one is used FOR: a
//     filter over the expense list, a header band, frozen rows, and widths
//     that fit the numbers.
//   - freeze panes. It writes `<sheetView workbookViewId="0"/>` with no
//     `<pane>` child and offers no way to ask for one, so the panes are put
//     into the written file by freezeTopRows below.

type XlsxLib = typeof import("xlsx-js-style");
type CellStyle = Record<string, unknown>;

/** The mark on a figure that contains the owner-only account. */
export const RED_FILL = { patternType: "solid", fgColor: { rgb: "FF9999" } };

const TITLE_STYLE: CellStyle = { font: { bold: true, sz: 14 } };
const NOTICE_STYLE: CellStyle = { font: { bold: true, color: { rgb: "92400E" } } };
const HEADER_STYLE: CellStyle = {
  font: { bold: true, color: { rgb: "FFFFFF" } },
  fill: { patternType: "solid", fgColor: { rgb: "1F2937" } },
};
const GROUP_STYLE: CellStyle = { font: { bold: true } };
const TOTAL_STYLE: CellStyle = {
  font: { bold: true },
  border: { top: { style: "thin", color: { rgb: "9CA3AF" } } },
};

/** Columns A..E. */
const LAST_COL = 4;
/** Thai vowels and tone marks sit above or below the line and take no width of their own. */
const THAI_MARKS = /[ัิ-ฺ็-๎]/g;
const MIN_WIDTH = [24, 4, 14, 10, 8];
const MAX_WIDTH = [48, 6, 22, 14, 12];

/** Characters a formatted number occupies: digits, thousands separators, decimals, minus. */
function numberWidth(n: number, decimals: number, grouped: boolean): number {
  const digits = Math.max(1, Math.floor(Math.log10(Math.abs(n) || 1)) + 1);
  const separators = grouped ? Math.floor((digits - 1) / 3) : 0;
  return digits + separators + (decimals > 0 ? decimals + 1 : 0) + (n < 0 ? 1 : 0);
}

/**
 * Column widths from the contents, so no number shows as ####. Excel shrinks
 * nothing and wraps nothing: a column too narrow for its number shows hashes,
 * which is the one failure that makes a figure unreadable rather than ugly.
 */
export function columnWidths(spec: SheetSpec): number[] {
  const widths = MIN_WIDTH.slice();
  const notices = new Set(spec.noticeRows);
  const counts = new Set(spec.countRows);
  for (let r = 0; r < spec.rows.length; r++) {
    const row = spec.rows[r]!;
    for (let c = 0; c <= LAST_COL && c < row.length; c++) {
      const v = row[c];
      if (v === "" || v === undefined) continue;
      // The title and the warnings are sentences, not data. Measured, they
      // would set column A to their own length and push the amounts off the
      // screen; they overflow across the empty cells beside them instead.
      if (c === 0 && (r === 0 || notices.has(r))) continue;
      const len =
        typeof v === "number"
          ? c === 2
            ? numberWidth(v, counts.has(r) ? 0 : 2, true)
            : numberWidth(v, 1, false)
          : v.replace(THAI_MARKS, "").length;
      widths[c] = Math.min(Math.max(widths[c]!, len + 2), MAX_WIDTH[c]!);
    }
  }
  return widths;
}

/**
 * One sheet as Excel will show it: widths, number formats, the header band,
 * the filter over the expense list, and the red marking.
 *
 * THE RED FILL GOES ON LAST, over whatever style the row already carries, and
 * replaces only the fill. A marked total therefore keeps its bold and its
 * rule, and no header or total styling can take the mark off a figure that
 * contains the owner-only account.
 */
export function sheetFromSpec(XLSX: XlsxLib, spec: SheetSpec) {
  const ws = XLSX.utils.aoa_to_sheet(spec.rows);
  ws["!cols"] = columnWidths(spec).map((wch) => ({ wch }));
  if (spec.filter) ws["!autofilter"] = { ref: `A${spec.filter.headerRow + 1}:E${spec.filter.lastRow + 1}` };

  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let r = spec.numbersFrom; r <= range.e.r; r++) {
    const amount = ws[XLSX.utils.encode_cell({ r, c: 2 })];
    if (amount && typeof amount.v === "number") amount.z = spec.countRows.includes(r) ? "#,##0" : "#,##0.00";
    const percent = ws[XLSX.utils.encode_cell({ r, c: 3 })];
    if (percent && typeof percent.v === "number") percent.z = "0.0";
  }

  const base = new Map<number, CellStyle>();
  base.set(0, TITLE_STYLE);
  for (const r of spec.noticeRows) base.set(r, NOTICE_STYLE);
  for (const r of spec.groupRows) base.set(r, GROUP_STYLE);
  for (const r of spec.totalRows) base.set(r, TOTAL_STYLE);
  for (const r of spec.headerRows) base.set(r, HEADER_STYLE);
  const marked = new Set(spec.markedRows);

  for (let r = 0; r <= range.e.r; r++) {
    const style = base.get(r);
    if (!style && !marked.has(r)) continue;
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      cell.s = marked.has(r) ? { ...style, fill: RED_FILL } : { ...style };
    }
  }
  return ws;
}

/**
 * The frozen header rows, written by hand into a sheet's XML. Returns null
 * when the anchor is not there — a library update then changes the panes and
 * nothing else about the file, and pl-excel.test.ts is what fails rather than
 * the download.
 */
export function freezeSheetXml(xml: string, ySplit: number): string | null {
  const anchor = '<sheetView workbookViewId="0"/>';
  if (!Number.isInteger(ySplit) || ySplit < 1 || !xml.includes(anchor)) return null;
  const cell = `A${ySplit + 1}`;
  return xml.replace(
    anchor,
    `<sheetView workbookViewId="0"><pane ySplit="${ySplit}" topLeftCell="${cell}" activePane="bottomLeft" state="frozen"/>` +
      `<selection pane="bottomLeft" activeCell="${cell}" sqref="${cell}"/></sheetView>`,
  );
}

type ZipEntry = { name: string; content: Uint8Array<ArrayBuffer>; size: number };
type Cfb = {
  read: (data: Uint8Array<ArrayBuffer>, opts: { type: "array" }) => { FullPaths: string[]; FileIndex: ZipEntry[] };
  write: (cfb: unknown, opts: { fileType: "zip"; type: "array"; compression: boolean }) => Uint8Array<ArrayBuffer>;
};

/**
 * Freezes ySplits[i] rows on xl/worksheets/sheet{i+1}.xml — the order the
 * sheets were appended in.
 *
 * The parts are rewritten IN PLACE. Adding one under the same name instead
 * (cfb_add) leaves the package holding two parts with that name, one of them
 * the original without the pane: SheetJS reads the last and sees the freeze,
 * Excel need not, and neither is a valid workbook. The test counts the zip
 * entries for exactly that reason.
 */
export function freezeTopRows(
  XLSX: XlsxLib,
  bytes: Uint8Array<ArrayBuffer>,
  ySplits: number[],
): { bytes: Uint8Array<ArrayBuffer>; frozenSheets: number } {
  const CFB = XLSX.CFB as Cfb;
  const cfb = CFB.read(bytes, { type: "array" });
  let frozenSheets = 0;
  for (let i = 0; i < cfb.FullPaths.length; i++) {
    const match = /xl\/worksheets\/sheet(\d+)\.xml$/.exec(cfb.FullPaths[i] ?? "");
    const entry = cfb.FileIndex[i];
    if (!match || !entry) continue;
    const ySplit = ySplits[Number(match[1]) - 1];
    if (ySplit === undefined) continue;
    const patched = freezeSheetXml(new TextDecoder().decode(entry.content), ySplit);
    if (!patched) continue;
    entry.content = new TextEncoder().encode(patched);
    entry.size = entry.content.length;
    frozenSheets++;
  }
  if (frozenSheets === 0) return { bytes, frozenSheets };
  return { bytes: CFB.write(cfb, { fileType: "zip", type: "array", compression: true }), frozenSheets };
}

/**
 * The bytes the owner downloads; the client only saves them.
 *
 * A failure to put the panes in costs the frozen rows and nothing else — the
 * file still downloads, complete, and the test rather than the owner is what
 * notices.
 */
export function buildPlFile(XLSX: XlsxLib, specs: SheetSpec[]): { bytes: Uint8Array<ArrayBuffer>; frozenSheets: number } {
  const wb = XLSX.utils.book_new();
  for (const spec of specs) XLSX.utils.book_append_sheet(wb, sheetFromSpec(XLSX, spec), spec.name);
  const written = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer | Uint8Array<ArrayBuffer>;
  const bytes = written instanceof Uint8Array ? written : new Uint8Array(written);
  try {
    return freezeTopRows(XLSX, bytes, specs.map((s) => s.freezeRows));
  } catch {
    return { bytes, frozenSheets: 0 };
  }
}
