// Validation for POS delivery rows arriving from the BROWSER.
//
// WHY THIS EXISTS. Parsing moved client-side to get under Vercel's 4.5 MB
// request-body limit. That removes a guarantee nobody had to think about
// before: the server's own parser used to define the shape of every row that
// reached the database.
//
// It is tempting to think applyPosImport is still safe because it recomputes
// costs from pos_receipt_deliveries rather than from the request. It is not.
// Recomputing from the table only helps if the TABLE is trustworthy, and under
// client parsing the table is filled from browser-supplied rows — so a
// recompute launders bad data rather than catching it. This module is the
// replacement guarantee, and it is required, not hardening.
//
// Deliberately NOT validated here: whether materialCode corresponds to a known
// ingredient. This table stores POS facts, and the material -> ingredient
// mapping is meant to stay editable (which is why the migration has no FK).
// Unmatched codes are exactly what the preview's "unmatched" list reports.

/** One delivery row as the browser sends it. */
export type PosDeliveryInput = {
  materialCode: string;
  materialName: string;
  documentNumber: string;
  /** "YYYY-MM-DD", already converted from the report's Buddhist era. */
  documentDate: string;
  /** "" is a genuine vendor identity in this data — never null, never rejected. */
  vendorName: string;
  unitName: string;
  qty: number;
  totalCostIncVat: number;
  totalCostExcVat: number;
  /**
   * "month" means documentDate's day is a placeholder of 1 (the report had
   * no DocumentDate; only the month was recoverable from the document
   * number). Absent is treated as "day".
   */
  datePrecision?: "day" | "month";
};

export const MAX_ROWS_PER_CHUNK = 2000;
export const MAX_ROWS_PER_BATCH = 60000;

/** Nothing in this dataset predates the POS rollout; a date before this is a parse bug. */
const EARLIEST_DATE = "2020-01-01";
const MAX_TEXT = 200;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function badText(v: unknown, field: string, { allowEmpty = false } = {}): string | null {
  if (typeof v !== "string") return `${field} ต้องเป็นข้อความ`;
  if (!allowEmpty && v.trim() === "") return `${field} ว่างไม่ได้`;
  if (v.length > MAX_TEXT) return `${field} ยาวเกิน ${MAX_TEXT} ตัวอักษร`;
  return null;
}

function badNumber(v: unknown, field: string, { min }: { min: number }): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return `${field} ต้องเป็นตัวเลข`;
  if (v < min) return `${field} ต้องไม่น้อยกว่า ${min}`;
  return null;
}

/**
 * Validates one row. Returns null when valid, or a Thai message naming the
 * field — the message reaches the admin, so it has to say what is wrong.
 *
 * `today` is injectable so the future-date rule is testable without freezing
 * the clock.
 */
export function validateDeliveryRow(row: unknown, today = new Date()): string | null {
  if (typeof row !== "object" || row === null) return "แถวข้อมูลไม่ถูกต้อง";
  const r = row as Record<string, unknown>;

  const textChecks =
    badText(r.materialCode, "รหัสวัตถุดิบ") ??
    badText(r.materialName, "ชื่อวัตถุดิบ") ??
    badText(r.documentNumber, "เลขที่เอกสาร") ??
    badText(r.unitName, "หน่วย") ??
    badText(r.vendorName, "ผู้จัดจำหน่าย", { allowEmpty: true });
  if (textChecks) return textChecks;

  if (typeof r.documentDate !== "string" || !DATE_RE.test(r.documentDate)) {
    return "วันที่เอกสารต้องอยู่ในรูปแบบ YYYY-MM-DD";
  }
  // Date-only comparison: string compare is correct for ISO dates and avoids
  // a timezone round-trip, which matters because the app runs in UTC and the
  // restaurant is UTC+7.
  const parsed = new Date(`${r.documentDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "วันที่เอกสารไม่ถูกต้อง";
  // Tomorrow, not today: an export produced late in the Bangkok evening can
  // legitimately carry a date the UTC server has not reached yet.
  const tomorrow = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  if (r.documentDate < EARLIEST_DATE) return `วันที่เอกสารเก่ากว่า ${EARLIEST_DATE}`;
  if (r.documentDate > tomorrow) return "วันที่เอกสารอยู่ในอนาคต";

  if (r.datePrecision !== undefined && r.datePrecision !== "day" && r.datePrecision !== "month") {
    return "ความละเอียดของวันที่ไม่ถูกต้อง";
  }
  // A month-precision row must carry the placeholder day, or something has
  // invented a date it does not have.
  if (r.datePrecision === "month" && !String(r.documentDate).endsWith("-01")) {
    return "แถวที่ทราบแค่เดือนต้องมีวันที่เป็นวันที่ 1";
  }

  // qty > 0: the parser already drops zero/negative quantities, so one here
  // means the payload did not come from the parser.
  const numberChecks =
    badNumber(r.qty, "จำนวน", { min: Number.MIN_VALUE }) ??
    // Zero cost genuinely occurs (free goods, corrections). Negative does not.
    badNumber(r.totalCostIncVat, "ราคารวม VAT", { min: 0 }) ??
    badNumber(r.totalCostExcVat, "ราคาไม่รวม VAT", { min: 0 });
  if (numberChecks) return numberChecks;

  return null;
}

export type ChunkValidation =
  | { ok: true; rows: PosDeliveryInput[] }
  | { ok: false; error: string };

/**
 * Validates a whole chunk. Rejects the ENTIRE chunk on the first bad row
 * rather than importing the good ones: a partially-applied chunk is harder to
 * reason about than a rejected one, and the client can simply resend.
 */
export function validateChunk(rows: unknown, today = new Date()): ChunkValidation {
  if (!Array.isArray(rows)) return { ok: false, error: "รูปแบบข้อมูลไม่ถูกต้อง" };
  if (rows.length === 0) return { ok: false, error: "ไม่มีข้อมูลในชุดนี้" };
  if (rows.length > MAX_ROWS_PER_CHUNK) {
    return { ok: false, error: `ชุดข้อมูลใหญ่เกินไป (${rows.length} แถว, สูงสุด ${MAX_ROWS_PER_CHUNK})` };
  }
  for (let i = 0; i < rows.length; i++) {
    const problem = validateDeliveryRow(rows[i], today);
    if (problem) return { ok: false, error: `แถวที่ ${i + 1}: ${problem}` };
  }
  return { ok: true, rows: rows as PosDeliveryInput[] };
}
