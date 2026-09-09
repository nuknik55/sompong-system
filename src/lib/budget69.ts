// Relative imports WITH the .ts extension, like pos-revenue.ts: this module
// is unit-tested under `node --test`, which resolves neither the "@/" alias
// nor extensionless relative paths.
import * as XLSX from "xlsx";
import { BUDGET69_MAP, NET_PROFIT_ROW, POS_OWNED_CODES, REVENUE_ROW, SECTION_OTHER_ROW, SECTION_OTHER_BY_CODE_PREFIX } from "./budget69-map.ts";

/**
 * budget69.xlsx, sheet งบ69 — the source of the monthly-billed costs the
 * app's ledger has never held (salaries, rent, utilities, owner's pay, card
 * fees: ≈฿1.03M a month). Pure: no I/O, no Supabase.
 *
 * ── THE SHEET'S SHAPE, AND WHAT THIS RELIES ON ─────────────────────────────
 *
 * One row per account with the name in column B. Months run left to right in
 * PAIRS, budget then ACTUAL, each pair headed by the month number in row 2 —
 * the actual is the right-hand, green-filled column. Quarter and total
 * columns are interleaved and carry no month number. Section subtotals sit
 * on rows of their own; some accounts have detail lines beneath them that
 * sum to the account. Rows from "Net Profit" downward are targets and
 * templates, not actuals.
 *
 * The column map is DERIVED from row 2 on every parse and refused if it does
 * not yield twelve budget/actual pairs — it is the only thing telling us
 * which column is the real figure, and a sheet reorganised in Excel must fail
 * loudly here, not silently read the budget.
 */

export type SheetRow = {
  row: number;
  name: string;
  /** Actual per month 1–12, 0 where blank. */
  actual: number[];
};

export type Budget69Sheet = {
  rows: SheetRow[];
  /** Column index (0-based) of the ACTUAL for month m, at index m. */
  actualCol: number[];
};

const TOLERANCE = 1;

export function parseBudget69(buffer: ArrayBuffer): { sheet: Budget69Sheet } | { error: string } {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets["งบ69"];
  if (!ws) return { error: `ไม่พบแผ่น "งบ69" ในไฟล์ (มี: ${wb.SheetNames.join(", ")})` };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
  return parseBudget69Grid(grid);
}

/** Split out so tests can feed a grid without building a workbook. */
export function parseBudget69Grid(grid: unknown[][]): { sheet: Budget69Sheet } | { error: string } {
  const header = grid[1] ?? [];
  const budgetCol: number[] = [];
  const actualCol: number[] = [];
  for (let c = 2; c < header.length; c++) {
    const v = header[c];
    if (typeof v !== "number" || v < 1 || v > 12 || !Number.isInteger(v)) continue;
    if (budgetCol[v] === undefined) budgetCol[v] = c;
    else if (actualCol[v] === undefined) actualCol[v] = c;
  }
  const missing = [];
  for (let m = 1; m <= 12; m++) if (budgetCol[m] === undefined || actualCol[m] === undefined) missing.push(m);
  if (missing.length > 0) {
    return {
      error:
        `แถวที่ 2 ของแผ่น งบ69 ต้องมีเลขเดือน 1–12 เดือนละ 2 คอลัมน์ (งบ แล้ว จริง) ` +
        `แต่เดือน ${missing.join(", ")} ไม่ครบ — ถ้าไฟล์ถูกจัดคอลัมน์ใหม่ ต้องแก้ตัวอ่านก่อน ไม่ใช่เดาว่าคอลัมน์ไหนคือยอดจริง`,
    };
  }

  const rows: SheetRow[] = [];
  let cut = Infinity;
  for (let i = 2; i < grid.length; i++) {
    const r = grid[i];
    if (!r) continue;
    const raw = r[1];
    if (raw == null || String(raw).trim() === "") continue;
    const name = String(raw).trim();
    if (name === NET_PROFIT_ROW) cut = i;
    if (i > cut) break;
    const actual: number[] = [0];
    for (let m = 1; m <= 12; m++) {
      const v = r[actualCol[m]!];
      actual.push(typeof v === "number" && Number.isFinite(v) ? v : 0);
    }
    rows.push({ row: i + 1, name, actual });
  }
  if (!rows.some((r) => r.name === REVENUE_ROW)) return { error: `ไม่พบแถว "${REVENUE_ROW}" ในแผ่น งบ69` };
  if (!rows.some((r) => r.name === NET_PROFIT_ROW)) return { error: `ไม่พบแถว "${NET_PROFIT_ROW}" ในแผ่น งบ69` };
  return { sheet: { rows, actualCol } };
}

/**
 * Parent detection by arithmetic: a row is the parent of the k rows after
 * it when, for every month with data, those k rows sum to it. Nothing in the
 * sheet marks structure; the numbers do.
 *
 * Two things the real file taught this function:
 *
 *   - Subtotal formulas in the sheet do not always cover every row beneath
 *     them. `- ต้นทุนอื่นๆ` equals its children in Jan–May but not Jun–Jul,
 *     because ของฝาก was added later and sits outside the SUM range. So a
 *     parent may match with exactly ONE child excluded — and that child is
 *     recorded, because the sheet's own bottom line then omits it and the
 *     stop check has to know why.
 *   - Blocks nest (Supply - ครัว holds Supply - ครัวอื่นๆ). Detection runs
 *     bottom-up, and a detected parent inside a block contributes its own
 *     value while its children are stepped over.
 */
function detectParents(rows: SheetRow[]): { kidsOf: Map<number, number>; excludedChild: Map<number, number> } {
  const kidsOf = new Map<number, number>();
  const excludedChild = new Map<number, number>();
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // Leaf-level members of a block starting after i, spanning k rows.
  const members = (i: number, k: number): number[] => {
    const out: number[] = [];
    for (let j = i + 1; j <= i + k; ) { out.push(j); j += 1 + (kidsOf.get(j) ?? 0); }
    return out;
  };

  // Revenue and the bottom line are never parents and never members: the
  // sheet's own identity is revenue = Σ costs + net profit, which would make
  // ยอดขาย the "parent" of the entire sheet and steal every row's parent
  // pointer. It did exactly that on a five-row fixture.
  const structural = (i: number) => rows[i]!.name === REVENUE_ROW || rows[i]!.name === NET_PROFIT_ROW;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (structural(i)) continue;
    const parent = rows[i]!;
    const active = months.filter((mm) => parent.actual[mm] !== 0);
    if (active.length < 2) continue;
    for (let k = 1; k <= 45 && i + k < rows.length; k++) {
      if (structural(i + k)) break;
      const mem = members(i, k);
      if (mem[mem.length - 1]! + (kidsOf.get(mem[mem.length - 1]!) ?? 0) !== i + k) continue; // block must end on a boundary
      const diff = (mm: number) => parent.actual[mm]! - mem.reduce((acc, j) => acc + rows[j]!.actual[mm]!, 0);
      if (active.every((mm) => Math.abs(diff(mm)) <= TOLERANCE)) { kidsOf.set(i, k); break; }
      // One child left out of the subtotal formula — in SOME months. The
      // sheet's formulas are per column, so June's subtotal can include
      // ของฝาก while July's omits it. Per month the gap is therefore either
      // zero or exactly that child; the child is fixed across months.
      // The parent is SMALLER than its members when a child is left out, so
      // the gap is negative and equals minus the child — parent + child = Σ.
      const culprit = mem.find((j) => months.every((mm) => Math.abs(diff(mm)) <= TOLERANCE || Math.abs(diff(mm) + rows[j]!.actual[mm]!) <= TOLERANCE));
      if (culprit !== undefined && mem.length >= 2) { kidsOf.set(i, k); excludedChild.set(i, culprit); break; }
    }
  }
  return { kidsOf, excludedChild };
}

export type MonthEntry = { coa_code: string; sheetAmount: number; appAmount: number; lump: number; rows: number[] };

export type Budget69Block =
  | { kind: "unmapped"; rows: { row: number; name: string; amount: number }[]; total: number }
  | {
      /** The sheet's own total and the sum of everything named disagree. A stop, not a warning. */
      kind: "unexplained";
      sheetExpenseTotal: number;
      /** Σ rows the sheet's own subtotals skip — in the sheet, not in its bottom line. */
      sheetExcluded: number;
      explained: number;
      diff: number;
    };

export type Budget69Projection = {
  yearMonth: string;
  month: number;
  revenue: number;
  netProfit: number;
  /** revenue − net profit: what the sheet itself says the month cost. */
  sheetExpenseTotal: number;
  entries: MonthEntry[];
  /** Codes the POS import owns, shown so their absence is visible. */
  posOwned: { coa_code: string; sheetAmount: number }[];
  /** Codes with app entries this month that the sheet has no row for (993, 998 …). */
  appOnly: { coa_code: string; appAmount: number }[];
  /** Entries whose daily sum exceeded the sheet: lump clamped to 0, entries kept. */
  negatives: { coa_code: string; sheetAmount: number; appAmount: number }[];
  memoRows: { row: number; name: string; amount: number }[];
  /** Rows present in the sheet but outside its own subtotal formulas — counted, and named. */
  sheetExcluded: { row: number; name: string; amount: number }[];
  sheetTotalMapped: number;
  writtenTotal: number;
};

/**
 * Which rows are entries, which are covered by a parent, which block.
 *
 *   - a mapped row with no mapped children is an entry; its children (if any)
 *     are covered by it
 *   - a parent with ANY mapped child is skipped, and its children stand on
 *     their own — mapped ones are entries, unmapped ones block
 *   - an unmapped parent is a subtotal: skipped, children stand on their own
 *   - memo rows are never entries and never block
 *
 * The second rule is why Variable MKT's children map individually: the app
 * books ค่าสิ่งพิมพ์ to 610 and ของแจก to 630, and lumping the parent into 630
 * would set July's 610 remainder against the wrong figure.
 */
export function projectBudget69Month(
  sheet: Budget69Sheet,
  month: number,
  appSumsByCode: ReadonlyMap<string, number>,
  yearMonth: string,
): { projection: Budget69Projection; blocks: Budget69Block[] } {
  const { rows } = sheet;
  const { kidsOf, excludedChild } = detectParents(rows);
  // Each row's INNERMOST parent: a nested block's rows belong to the inner
  // parent, not to the outer one that contains it.
  const parentOf = new Map<number, number>();
  for (const [p, k] of kidsOf) {
    for (let j = p + 1; j <= p + k; ) { parentOf.set(j, p); j += 1 + (kidsOf.get(j) ?? 0); }
  }

  const mapOf = (r: SheetRow) => BUDGET69_MAP[r.name];
  const codeOf = (i: number): string | null => {
    const m = mapOf(rows[i]!);
    if (m && m.code !== null) return m.code;
    // "- ต้นทุนอื่นๆ" is a subtotal in one section and a leaf in two others —
    // the same name, so the map cannot hold both. A LEAF with that name is
    // its section's "other" line, taken from the nearest preceding mapped
    // code's prefix (2xx → 240, 4xx → 420). A section with no such line
    // stays unmapped and blocks, by name.
    if (rows[i]!.name === SECTION_OTHER_ROW && !kidsOf.has(i)) {
      for (let q = i - 1; q >= 0; q--) {
        const mm = mapOf(rows[q]!);
        if (mm && mm.code !== null && mm.tier !== "memo") return SECTION_OTHER_BY_CODE_PREFIX[mm.code[0]!] ?? null;
      }
    }
    return null;
  };
  const isMapped = (i: number) => codeOf(i) !== null;
  const isMemo = (i: number) => mapOf(rows[i]!)?.tier === "memo";
  // A parent is split only when a child maps to a DIFFERENT code. A child on
  // the same code (ผ้าเย็น under Supply - บาร์น้ำ, both 820) and a memo child
  // are covered by the parent; splitting there would strand the unmapped
  // siblings for no reason.
  const hasMappedChild = (i: number) => {
    const k = kidsOf.get(i) ?? 0; const own = codeOf(i);
    for (let j = 1; j <= k; j++) { if (isMemo(i + j)) continue; const c = codeOf(i + j); if (c !== null && c !== own) return true; }
    return false;
  };

  const revenueRow = rows.find((r) => r.name === REVENUE_ROW)!;
  const netRow = rows.find((r) => r.name === NET_PROFIT_ROW)!;
  const revenue = revenueRow.actual[month]!;
  const netProfit = netRow.actual[month]!;

  const byCode = new Map<string, { sheetAmount: number; rows: number[] }>();
  const unmapped: { row: number; name: string; amount: number }[] = [];
  const memoRows: { row: number; name: string; amount: number }[] = [];
  let explained = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r === revenueRow || r === netRow) continue;
    const amount = r.actual[month]!;
    // Covered by a parent that is itself the entry (mapped, no mapped child).
    const p = parentOf.get(i);
    if (p !== undefined && isMapped(p) && !hasMappedChild(p)) continue;
    // A parent whose children stand on their own is a subtotal, not a line.
    if (kidsOf.has(i) && (!isMapped(i) || hasMappedChild(i))) continue;
    if (isMemo(i)) { if (amount !== 0) memoRows.push({ row: r.row, name: r.name, amount }); continue; }
    if (amount === 0) continue;
    const code = codeOf(i);
    if (code === null) { unmapped.push({ row: r.row, name: r.name, amount }); explained += amount; continue; }
    const e = byCode.get(code) ?? { sheetAmount: 0, rows: [] };
    e.sheetAmount += amount; e.rows.push(r.row); byCode.set(code, e);
    explained += amount;
  }

  const posOwned: Budget69Projection["posOwned"] = [];
  const entries: MonthEntry[] = [];
  const negatives: Budget69Projection["negatives"] = [];
  let sheetTotalMapped = 0, writtenTotal = 0;
  for (const [code, e] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sheetAmount = round2(e.sheetAmount);
    if ((POS_OWNED_CODES as readonly string[]).includes(code)) { posOwned.push({ coa_code: code, sheetAmount }); continue; }
    sheetTotalMapped += sheetAmount;
    const appAmount = round2(appSumsByCode.get(code) ?? 0);
    let lump = round2(sheetAmount - appAmount);
    if (lump < 0) { negatives.push({ coa_code: code, sheetAmount, appAmount }); lump = 0; }
    writtenTotal += lump;
    entries.push({ coa_code: code, sheetAmount, appAmount, lump, rows: e.rows });
  }
  const appOnly = [...appSumsByCode.entries()]
    .filter(([code, amt]) => amt > 0 && !byCode.has(code))
    .map(([coa_code, appAmount]) => ({ coa_code, appAmount: round2(appAmount) }))
    .sort((a, b) => a.coa_code.localeCompare(b.coa_code));

  const blocks: Budget69Block[] = [];
  if (unmapped.length > 0) blocks.push({ kind: "unmapped", rows: unmapped, total: round2(unmapped.reduce((s, u) => s + u.amount, 0)) });

  // THE STOP CHECK. Everything the sheet calls a cost this month must be
  // accounted for by a named bucket — an entry, a POS-owned exclusion, or an
  // unmapped block. If the sheet's own bottom line disagrees with that sum,
  // some row is being skipped or double-counted, and that is not a warning.
  // Rows the sheet's own subtotal formulas leave out are in the sheet but
  // not in its bottom line. They are counted above (they are real costs Nik
  // typed) and named here, so the reconciliation is explicit rather than a
  // tolerance. The excluded amount is THIS month's gap between the parent
  // and its members — zero in a month whose formula does include the row.
  const sheetExcluded: { row: number; name: string; amount: number }[] = [];
  for (const [pi, j] of excludedChild) {
    const k = kidsOf.get(pi)!;
    let sum = 0;
    for (let q = pi + 1; q <= pi + k; ) { sum += rows[q]!.actual[month]!; q += 1 + (kidsOf.get(q) ?? 0); }
    const gap = round2(rows[pi]!.actual[month]! - sum);
    if (Math.abs(gap) > TOLERANCE) sheetExcluded.push({ row: rows[j]!.row, name: rows[j]!.name, amount: round2(-gap) });
  }
  const excludedTotal = round2(sheetExcluded.reduce((s, x) => s + x.amount, 0));
  const sheetExpenseTotal = round2(revenue - netProfit);
  const diff = round2(sheetExpenseTotal + excludedTotal - explained);
  if (Math.abs(diff) > TOLERANCE) blocks.push({ kind: "unexplained", sheetExpenseTotal, sheetExcluded: excludedTotal, explained: round2(explained), diff });

  return {
    projection: {
      yearMonth, month, revenue, netProfit, sheetExpenseTotal, entries, posOwned, appOnly, negatives, memoRows, sheetExcluded,
      sheetTotalMapped: round2(sheetTotalMapped), writtenTotal: round2(writtenTotal),
    },
    blocks,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
