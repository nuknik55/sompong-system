// Relative imports WITH the .ts extension, like budget69.ts: this module is
// unit-tested under `node --test`, which resolves neither the "@/" alias nor
// extensionless relative paths.
import * as XLSX from "xlsx";

/**
 * The outsourced accountant's file (69-08.xlsx, then 69-09.xlsx …, and
 * 70-01.xlsx next year) — from August 2569 the source of the monthly-billed
 * costs, and of monthly_revenue.other. Pure: no I/O, no Supabase.
 *
 * ── THE FILE'S SHAPE, AND WHAT THIS RELIES ON ──────────────────────────────
 *
 * One expense sheet, named รับ-จ่าย<yy>. For every month, top to bottom:
 *
 *   a daily table (dates in column A)
 *   a row with รวม in column A                      ← the anchor
 *   the card fee, column C of the next row
 *   receipts (ขายสด / รับบัตร / รับจากธ. / รับอื่น ๆ / รวม), labels in column C
 *   หักจ่ายสด, then the CASH-PAID block, to the first blank row
 *   THE MONTHLY BLOCK, labels in column C, amounts in column F
 *   รวมคชจ.                                          ← the end
 *
 * Nothing in the sheet marks the monthly block except its position: after
 * the blank row that follows the cash-paid block. Three labels occur in
 * BOTH blocks (ค่าแรงพนักงาน, ค่าอาหารพนักงาน, ค่าเช่า) with unrelated
 * figures — Aug 2569: 604,970 monthly vs 78,497 cash-paid. The monthly one
 * is taken because it is inside the located block, never by first match.
 *
 * The identity the sheet itself obeys, to the baht in nine of nine months:
 *
 *     รวมคชจ. = หักจ่ายสด + Σ(monthly block)
 *
 * is THE STOP. A month where it fails is refused: some row is not being
 * seen, and that is not a warning.
 *
 * Month sheets (ธค.68, มค.69 …) contribute ONE cell, F7 รายได้อื่นๆ. Each is
 * tied to its month by its F7 formula, which points at a row inside that
 * month's rows in the expense sheet, and by its name; the two must agree.
 *
 * ── THE YEAR ───────────────────────────────────────────────────────────────
 *
 * Nothing here reads a year from a sheet name or a file name. The month is
 * resolved from the daily table's date column, and the year in those cells
 * is 57 years off, not 543: the accountant typed a two-digit Buddhist year
 * ("1/12/68") and Excel read it as 1968. See resolveStoredYear.
 */

const TOLERANCE = 1;

/**
 * The year Excel decoded from a date serial → the CE year the accountant
 * meant. Three cases, and only the first occurs in the file today:
 *
 *   1900–1999  a two-digit Buddhist year read by Excel's two-digit rule:
 *              "68" → 1968. BE = 2500 + 68 = 2568, CE = 2025.
 *   ≥ 2400     a four-digit Buddhist year typed in full: 2570 → 2027
 *              (the POS parser's rule for text dates).
 *   2000–2399  already CE.
 *
 * Verified on 69-08.xlsx: every block Dec 2568 → Aug 2569 resolves to
 * 2025-12 … 2026-08 with one month per block. The 70-series fixture in the
 * tests proves the rollover ("1/1/70" → 1970 → 2027-01) before it happens.
 */
export function resolveStoredYear(storedYear: number): number {
  if (storedYear >= 2400) return storedYear - 543;
  if (storedYear < 2000) return 2500 + (storedYear % 100) - 543;
  return storedYear;
}

/** Excel serial (1900 date system) → the calendar fields Excel shows. */
function serialToYMD(serial: number): { y: number; m: number; d: number } {
  const d = new Date(Math.round((serial - 25569) * 86400000));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** The Thai month abbreviations the accountant uses for sheet names. Only
 *  the first eight and ธค have been seen in a real file; กย/ตค/พย are the
 *  natural continuations and are confirmed the first time such a sheet
 *  appears. The formula tie does not depend on them. */
export const MONTH_SHEET_ABBREV = ["มค", "กพ", "มีค", "เมย", "พค", "มิย", "กค", "สค", "กย", "ตค", "พย", "ธค"] as const;

/**
 * Exact labels as written in the monthly block → CoA code. Whitespace is
 * collapsed and trimmed; nothing else. A label not here is a named stop.
 *
 *   ค่าอาหารพนักงาน → 221, not 214: seven months of budget69 lumps put this
 *   figure on 221 ค่าอาหารพนักงาน; 214 is ค่าอาหาร Part-time.
 *   ค่าภงด.50 → 959 ค่าภาษีอื่นๆ, which is where June 2569 already holds it.
 *   จ่ายคืนร้านกาแฟ → SKIP: revenue already excludes coffee-shop sales;
 *   booking their return as an expense would double-count. Shown, never
 *   written, like 998.
 */
export const OUTSOURCE_LABEL_MAP: Readonly<Record<string, string | "SKIP">> = {
  "ค่าแรงพนักงาน": "220",
  "เงินเดือนออฟฟิศ": "790",
  "ค่าอาหารพนักงาน": "221",
  "ค่าเช่า": "310",
  "ค่าไฟ": "520",
  "ค่าน้ำประปา": "530",
  "ค่าภงด.3,53": "952",
  "ค่า ภพ.30": "951",
  "ค่าทำบัญชี": "710",
  "ค่าทำบัญชี+ ค่าสอบบัญชี": "710",
  "โบนัส": "225",
  "ค่าภงด.50": "959",
  "ค่าภาษีที่ดิน": "954",
  "จ่ายคืนร้านกาแฟ": "SKIP",
};

export const CARD_FEE_CODE = "745";
/** The cash-paid line shown as a check against the app's daily 230+231, never written. */
export const SOCIAL_SECURITY_LABEL = "ค่าประกันสังคม";
export const SOCIAL_SECURITY_CODES = ["230", "231"] as const;
const REIMBURSEMENT_LABEL = "จ่ายคืนร้านกาแฟ";
const TOTAL_LABEL = "รวม";
const CASH_HEADER = "หักจ่ายสด";
const END_LABEL = "รวมคชจ.";
const OTHER_CELL = "F7";

export type LabelledRow = { row: number; label: string; value: number };

export type OutsourceMonth = {
  /** Resolved from the daily table's dates. */
  yearMonth: string;
  /** 1-based rows in the expense sheet this month spans: the row after the previous รวมคชจ. … this month's รวมคชจ.. */
  firstRow: number;
  lastRow: number;
  totalRow: number;
  cardFee: LabelledRow;
  cashTotal: number;
  cashPaid: LabelledRow[];
  monthly: LabelledRow[];
  /** รวมคชจ. as the file states it. */
  total: number;
  /** F7 of the month sheet, or the reason it was not located. */
  other: { sheet: string; value: number; tiedBy: "formula+name" | "formula" | "name" } | { missing: string };
};

export type OutsourceFile = {
  expenseSheet: string;
  months: OutsourceMonth[];
};

export function parseOutsource(buffer: ArrayBuffer): { file: OutsourceFile } | { error: string } {
  const wb = XLSX.read(buffer, { type: "array", cellFormula: true });
  return parseOutsourceWorkbook(wb);
}

/** Split out so tests can hand in a workbook built in memory. */
export function parseOutsourceWorkbook(wb: XLSX.WorkBook): { file: OutsourceFile } | { error: string } {
  const expenseSheets = wb.SheetNames.filter((n) => /^รับ-จ่าย\d+$/.test(n));
  if (expenseSheets.length !== 1) {
    return {
      error:
        expenseSheets.length === 0
          ? `ไม่พบแผ่นรายจ่าย (ชื่อขึ้นต้นด้วย "รับ-จ่าย" ตามด้วยตัวเลข) ในไฟล์ (มี: ${wb.SheetNames.join(", ")})`
          : `พบแผ่นรายจ่ายมากกว่าหนึ่งแผ่น: ${expenseSheets.join(", ")} — ต้องมีแผ่นเดียว`,
    };
  }
  const expenseSheet = expenseSheets[0]!;
  const ws = wb.Sheets[expenseSheet]!;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });

  const text = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
  const labelAt = (r: number) => text(grid[r]?.[2]);
  const amountAt = (r: number): number | null => {
    const v = grid[r]?.[5];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const isBlank = (r: number) => (grid[r] ?? []).slice(0, 9).every((v) => v == null || String(v).trim() === "");

  const totalRows: number[] = [];
  for (let i = 0; i < grid.length; i++) if (text(grid[i]?.[0]) === TOTAL_LABEL) totalRows.push(i);
  if (totalRows.length === 0) return { error: `ไม่พบแถว "${TOTAL_LABEL}" ในคอลัมน์ A ของแผ่น ${expenseSheet}` };

  // Month sheets, by name pattern: Thai abbreviation, optional dot, digits.
  const monthSheets = wb.SheetNames
    .filter((n) => n !== expenseSheet)
    .map((n) => ({ n, m: /^([ก-๙]+)\.?(\d{2,4})$/.exec(n) }))
    .filter((x): x is { n: string; m: RegExpExecArray } => x.m !== null && (MONTH_SHEET_ABBREV as readonly string[]).includes(x.m[1]!))
    .map(({ n, m }) => {
      const idx = (MONTH_SHEET_ABBREV as readonly string[]).indexOf(m[1]!);
      const raw = Number(m[2]);
      const be = raw < 100 ? 2500 + raw : raw;
      return { name: n, yearMonth: `${be - 543}-${String(idx + 1).padStart(2, "0")}` };
    });
  // Which expense-sheet row each month sheet's F7 formula points at.
  const f7RefRow = (sheetName: string): number | null => {
    const cell = wb.Sheets[sheetName]?.[OTHER_CELL] as XLSX.CellObject | undefined;
    const f = cell?.f;
    if (!f) return null;
    // A pattern built from a plain string, not a template literal — see the
    // note in pos-parse.ts about escape sequences.
    const re = new RegExp("'?" + expenseSheet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "'?!\\$?F\\$?(\\d+)");
    const m = re.exec(f);
    return m ? Number(m[1]) : null;
  };

  const months: OutsourceMonth[] = [];
  // A month runs from the row after the previous month's รวมคชจ. to its own
  // รวมคชจ.. Starting it right after the previous รวม row instead would fold
  // the previous month's whole summary block into this month's range — and
  // the F7 formula tie then matched two sheets to one month on the
  // 70-series fixture.
  let prevEnd = -1;
  for (let k = 0; k < totalRows.length; k++) {
    const t = totalRows[k]!;
    const start = prevEnd + 1;
    // Upper bound for scanning this month's summary: the row before the next รวม.
    const scanEnd = k + 1 < totalRows.length ? totalRows[k + 1]! - 1 : grid.length - 1; // 0-based inclusive
    const end = scanEnd;
    const where = `แถว ${start + 1}–${end + 1}`;

    // ── The month, from the date column ───────────────────────────────────
    const seen = new Set<string>();
    let dateRows = 0;
    for (let i = start; i < t; i++) {
      const a = grid[i]?.[0];
      if (typeof a !== "number" || a < 1000) continue;
      const { y, m } = serialToYMD(a);
      seen.add(`${resolveStoredYear(y)}-${String(m).padStart(2, "0")}`);
      dateRows++;
    }
    if (dateRows === 0) return { error: `${where}: ไม่พบวันที่ในคอลัมน์ A ของตารางรายวัน จึงระบุเดือนไม่ได้` };
    if (seen.size !== 1) return { error: `${where}: วันที่ในตารางรายวันอยู่คนละเดือน (${[...seen].join(", ")}) — ต้องเป็นเดือนเดียว` };
    const yearMonth = [...seen][0]!;

    // ── Card fee: column C of the row after รวม ───────────────────────────
    const cardRaw = grid[t + 1]?.[2];
    if (typeof cardRaw !== "number" || !Number.isFinite(cardRaw)) return { error: `${yearMonth}: ไม่พบค่าธรรมเนียมบัตรที่ช่อง C แถว ${t + 2} (แถวถัดจาก รวม)` };
    const cardFee: LabelledRow = { row: t + 2, label: "ค่าธรรมเนียมบัตร", value: cardRaw };

    // ── Cash-paid block: from หักจ่ายสด to the first blank row ────────────
    let h = t + 1;
    while (h <= end && labelAt(h) !== CASH_HEADER) h++;
    if (h > end) return { error: `${yearMonth}: ไม่พบ "${CASH_HEADER}" ใต้แถว รวม (แถว ${t + 1})` };
    const cashTotal = amountAt(h);
    if (cashTotal === null) return { error: `${yearMonth}: "${CASH_HEADER}" แถว ${h + 1} ไม่มีตัวเลขในช่อง F` };
    const cashPaid: LabelledRow[] = [];
    let r = h + 1;
    while (r <= end && !isBlank(r)) {
      const v = amountAt(r);
      cashPaid.push({ row: r + 1, label: labelAt(r), value: v ?? 0 });
      r++;
    }
    if (r > end) return { error: `${yearMonth}: ไม่พบแถวว่างที่ปิดท้ายรายการจ่ายสด (หลัง "${CASH_HEADER}" แถว ${h + 1})` };

    // ── The monthly block: after the blank row, up to รวมคชจ. ────────────
    const monthly: LabelledRow[] = [];
    r++;
    let endRow: number | null = null;
    while (r <= end) {
      const lab = labelAt(r);
      if (lab === END_LABEL) { endRow = r; break; }
      if (isBlank(r)) break;
      const v = amountAt(r);
      if (lab === "") return { error: `${yearMonth}: แถว ${r + 1} ในกลุ่มรายจ่ายรายเดือนไม่มีชื่อรายการในช่อง C` };
      if (v === null) return { error: `${yearMonth}: "${lab}" แถว ${r + 1} ในกลุ่มรายจ่ายรายเดือนไม่มีตัวเลขในช่อง F` };
      monthly.push({ row: r + 1, label: lab, value: v });
      r++;
    }
    if (endRow === null) return { error: `${yearMonth}: ไม่พบ "${END_LABEL}" ปิดท้ายกลุ่มรายจ่ายรายเดือน (เริ่มแถว ${monthly[0]?.row ?? "?"})` };
    const total = amountAt(endRow);
    if (total === null) return { error: `${yearMonth}: "${END_LABEL}" แถว ${endRow + 1} ไม่มีตัวเลขในช่อง F` };

    prevEnd = endRow;

    // ── other: the month sheet's F7 ───────────────────────────────────────
    // Tied by the F7 formula pointing into this month's rows (structural,
    // year-free), and by the sheet's name; they must agree when both exist.
    const byFormula = monthSheets.filter((s) => { const ref = f7RefRow(s.name); return ref !== null && ref >= start + 1 && ref <= endRow + 1; });
    const byName = monthSheets.filter((s) => s.yearMonth === yearMonth);
    let other: OutsourceMonth["other"];
    if (byFormula.length > 1) other = { missing: `แผ่นเดือนหลายแผ่นอ้างสูตร F7 มายังแถวของเดือนนี้: ${byFormula.map((s) => s.name).join(", ")}` };
    else if (byName.length > 1) other = { missing: `พบแผ่นเดือนซ้ำสำหรับ ${yearMonth}: ${byName.map((s) => s.name).join(", ")}` };
    else if (byFormula.length === 1 && byName.length === 1 && byFormula[0]!.name !== byName[0]!.name)
      other = { missing: `สูตร F7 ของแผ่น ${byFormula[0]!.name} ชี้มาที่เดือนนี้ แต่ชื่อแผ่นที่ตรงกับ ${yearMonth} คือ ${byName[0]!.name} — ไม่ตรงกัน` };
    else {
      const pick = byFormula[0] ?? byName[0];
      if (!pick) other = { missing: `ไม่พบแผ่นเดือนของ ${yearMonth} (ไม่มีแผ่นที่ชื่อตรง และไม่มีแผ่นที่สูตร F7 ชี้มาแถว ${start + 1}–${end + 1})` };
      else {
        const cell = wb.Sheets[pick.name]?.[OTHER_CELL] as XLSX.CellObject | undefined;
        const v = cell?.v;
        if (typeof v !== "number" || !Number.isFinite(v)) other = { missing: `แผ่น ${pick.name} ช่อง ${OTHER_CELL} ไม่มีตัวเลข` };
        else other = { sheet: pick.name, value: v, tiedBy: byFormula[0] && byName[0] ? "formula+name" : byFormula[0] ? "formula" : "name" };
      }
    }

    months.push({ yearMonth, firstRow: start + 1, lastRow: endRow + 1, totalRow: t + 1, cardFee, cashTotal, cashPaid, monthly, total, other });
  }

  const dup = months.map((m) => m.yearMonth).filter((ym, i, a) => a.indexOf(ym) !== i);
  if (dup.length > 0) return { error: `เดือน ${[...new Set(dup)].join(", ")} ปรากฏมากกว่าหนึ่งครั้งในแผ่น ${expenseSheet}` };
  return { file: { expenseSheet, months } };
}

export type OutsourceEntry = {
  coa_code: string;
  amount: number;
  /** Source rows: label and value as written. Two labels can share a code (June's ค่าทำบัญชี+ ค่าสอบบัญชี). */
  rows: LabelledRow[];
  /** The same label in the cash-paid block — a different figure, already in the app as daily entries. */
  cashTwin: LabelledRow | null;
  /** The app's own daily entries on this code this month, for information only. Never subtracted. */
  appDaily: number;
};

export type OutsourceBlock =
  | { kind: "unmapped"; rows: LabelledRow[]; total: number }
  | {
      /** รวมคชจ. ≠ หักจ่ายสด + Σ(monthly block). Some row is not being seen. */
      kind: "identity";
      total: number;
      cashTotal: number;
      monthlySum: number;
      diff: number;
    }
  | { kind: "other-missing"; reason: string };

export type OutsourceProjection = {
  yearMonth: string;
  /** True when budget69 owns this month's expenses: entries are empty and only `other` is written. */
  budget69Owned: boolean;
  entries: OutsourceEntry[];
  /** In the file, deliberately not written, with why. */
  notImported: {
    label: string;
    row: number;
    value: number;
    reason: string;
    /** For ค่าประกันสังคม: the app's daily 230+231, and whether it disagrees with the file. */
    appDaily?: number;
    mismatch?: boolean;
  }[];
  other: number | null;
  /** Σ(monthly block excluding SKIP) + card fee, as the file states it. */
  blockTotal: number;
  writtenTotal: number;
  /** Everything the file states this month cost, for the preview's context line. */
  total: number;
  cashTotal: number;
};

/**
 * Figures are written IN FULL. The file's own arithmetic makes the monthly
 * block distinct from the cash-paid block, and the app's daily entries are
 * the cash-paid side — subtracting them would write 61,720 for a line the
 * accountant states as 71,080. The daily sum is carried for display only.
 *
 * Named and accepted: ค่าภ.ง.ด.1 (฿10–20) sits in the cash-paid block and
 * reaches 952 as a daily entry, so 952 ends ฿10 over the file's ภงด.3,53.
 */
export function projectOutsourceMonth(
  month: OutsourceMonth,
  appDailyByCode: ReadonlyMap<string, number>,
  budget69Owned: boolean,
): { projection: OutsourceProjection; blocks: OutsourceBlock[] } {
  const blocks: OutsourceBlock[] = [];

  // THE STOP: the identity, before anything is mapped.
  const monthlySum = round2(month.monthly.reduce((s, x) => s + x.value, 0));
  const diff = round2(month.total - (month.cashTotal + monthlySum));
  if (Math.abs(diff) > TOLERANCE) blocks.push({ kind: "identity", total: month.total, cashTotal: month.cashTotal, monthlySum, diff });

  const byCode = new Map<string, LabelledRow[]>();
  const unmapped: LabelledRow[] = [];
  const notImported: OutsourceProjection["notImported"] = [];
  for (const row of month.monthly) {
    if (row.value === 0) continue;
    const code = OUTSOURCE_LABEL_MAP[row.label];
    if (code === undefined) { unmapped.push(row); continue; }
    if (code === "SKIP") {
      notImported.push({ label: row.label, row: row.row, value: row.value, reason: row.label === REIMBURSEMENT_LABEL ? "ระบบตัดยอดขายร้านกาแฟออกจากรายได้แล้ว การบันทึกเงินคืนเป็นรายจ่ายจะนับซ้ำ" : "ไม่นำเข้า" });
      continue;
    }
    byCode.set(code, [...(byCode.get(code) ?? []), row]);
  }
  if (month.cardFee.value !== 0) byCode.set(CARD_FEE_CODE, [...(byCode.get(CARD_FEE_CODE) ?? []), month.cardFee]);
  if (unmapped.length > 0) blocks.push({ kind: "unmapped", rows: unmapped, total: round2(unmapped.reduce((s, u) => s + u.value, 0)) });

  // ค่าประกันสังคม: in the cash-paid block, already a daily entry (Aug 2569:
  // 231 = 36,360, exactly the file). A check row, never written.
  const ss = month.cashPaid.find((x) => x.label === SOCIAL_SECURITY_LABEL);
  if (ss) {
    const appDaily = round2(SOCIAL_SECURITY_CODES.reduce((s, c) => s + (appDailyByCode.get(c) ?? 0), 0));
    notImported.push({ label: ss.label, row: ss.row, value: ss.value, reason: "อยู่ในรายการจ่ายสด ซึ่งบันทึกรายวันในระบบแล้ว (230/231)", appDaily, mismatch: Math.abs(appDaily - ss.value) > TOLERANCE });
  }

  const entries: OutsourceEntry[] = [];
  let blockTotal = 0;
  for (const [code, rows] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const amount = round2(rows.reduce((s, x) => s + x.value, 0));
    blockTotal += amount;
    const label = rows[0]!.label;
    const cashTwin = rows[0] === month.cardFee ? null : (month.cashPaid.find((x) => x.label === label) ?? null);
    entries.push({ coa_code: code, amount, rows, cashTwin, appDaily: round2(appDailyByCode.get(code) ?? 0) });
  }

  const other = "value" in month.other ? month.other.value : null;
  if (other === null) blocks.push({ kind: "other-missing", reason: (month.other as { missing: string }).missing });

  const written = budget69Owned ? [] : entries;
  return {
    projection: {
      yearMonth: month.yearMonth,
      budget69Owned,
      entries: written,
      notImported,
      other,
      blockTotal: round2(blockTotal),
      writtenTotal: round2(written.reduce((s, e) => s + e.amount, 0)),
      total: month.total,
      cashTotal: month.cashTotal,
    },
    blocks,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
