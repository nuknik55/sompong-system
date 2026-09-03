// NO "server-only" here, deliberately. Every export below is a pure function
// over an ArrayBuffer — no I/O, no env, no Supabase. The marker used to be on
// this file and was inherited rather than earned, which meant the browser could
// not parse a POS export even though nothing stopped it from doing so.
//
// It is imported from BOTH sides now: server actions, and pos-price-import.tsx
// in the browser. The client side loads it with a dynamic import() so SheetJS
// (~800 KB minified) stays out of the shared bundle — it is only needed on one
// admin-only tab. Do not add a static client-side import of this module.
import * as XLSX from "xlsx";

// The POS "ใบรับสินค้าตรง" report is exported as an HTML table saved with a
// .xls extension. Each material's rows are forward-filled (code/name appear
// once, then blank on follow-up receipts), and the file also contains
// "Group :"/"Dept :" header rows and subtotal rows mixed in. Both of those
// always have an empty DocumentNumber, which is how we tell them apart from
// real receipt lines.

const THAI_MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

const THAI_MONTHS: Record<string, number> = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
};

/** "01 มีนาคม 2569" -> sortable number 25690301 (Buddhist year, no need to convert to CE). */
function parseThaiDateSortKey(text: string): number | null {
  const match = text.trim().match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = THAI_MONTHS[monthName];
  if (!month) return null;
  return Number(year) * 10000 + month * 100 + Number(day);
}

// Column layout of the receipt report. Verified against a real export
// (NewMaterialTransferReceive_11072026133502.xls) whose header row reads:
//   0 MaterialCode  1 MaterialName  2 DocumentNumber  3 InvoiceReference
//   4 DocumentDate  5 VendorName    6 UnitName        7 LastCost(Exc.Vat)
//   8 Cost          9 PricePerUnit  10 Qty            11 Discount
//   12 TotalCost(Exc.Vat)  13 VAT   14 TotalCost(Inc.Vat)  15 Remark
const COL = {
  materialCode: 0,
  materialName: 1,
  documentNumber: 2,
  documentDate: 4,
  vendorName: 5,
  unitName: 6,
  qty: 10,
  totalCostExcVat: 12,
  totalCostIncVat: 14,
} as const;

/**
 * Which cost basis unit costs are derived from. Deliberately one named
 * switch rather than an inline field pick: whether VAT belongs in food cost
 * depends on whether it's reclaimable for the business, which is an open
 * business question. Flipping this to "exc" is the whole change.
 */
const COST_BASIS: "inc" | "exc" = "inc";

/** The delivery's cost on the configured basis — see COST_BASIS. */
function deliveryCost(d: { totalCostIncVat: number; totalCostExcVat: number }): number {
  return COST_BASIS === "inc" ? d.totalCostIncVat : d.totalCostExcVat;
}

export type DatePrecision = "day" | "month";

/** One receipt line: a single delivery of one material on one document. */
export type PosDelivery = {
  /** Unique per receipt line; with materialCode this is the idempotency key. */
  documentNumber: string;
  /** Sortable Buddhist-calendar key, e.g. 25690711. */
  dateKey: number;
  /** Raw Thai date string exactly as it appeared in the file. */
  dateLabel: string;
  vendorName: string;
  unitName: string;
  qty: number;
  totalCostIncVat: number;
  totalCostExcVat: number;
  /** deliveryCost(this) / qty — qty is guaranteed > 0 (see the parse filter). */
  unitCost: number;
  /**
   * "day"   — dateKey/dateLabel came from the report's DocumentDate cell.
   * "month" — that cell was empty and only the month is known, recovered
   *           from the document number. The DAY IS A PLACEHOLDER of 1, not
   *           an estimate. See recoverPeriodFromDocumentNumber.
   */
  datePrecision: DatePrecision;
};

/** Every delivery the report contains for one material, in file order. */
export type PosMaterialDeliveries = {
  materialCode: string;
  materialName: string;
  deliveries: PosDelivery[];
};

// ── Pack-size parsing, for proposing a yield_qty when a unit changes ────────
// Purchase-unit labels in this system encode their pack size often enough to
// be worth reading: "แกล(4500g)", "ถุง(1000g)", "ถุง(2โล)", "ห่อ(1000g)".
// A proposal is only ever a starting point shown to a human — see
// proposeYieldQty's contract.

/** Recognised mass units → grams. */
const MASS_UNITS: Record<string, number> = {
  กรัม: 1, ก: 1, g: 1, gram: 1, grams: 1,
  ขีด: 100,
  โล: 1000, กิโล: 1000, กิโลกรัม: 1000, กก: 1000, kg: 1000,
};

/** Recognised volume units → millilitres. */
const VOLUME_UNITS: Record<string, number> = {
  มล: 1, ml: 1, ซีซี: 1, cc: 1,
  ลิตร: 1000, ล: 1000, l: 1000, litre: 1000, liter: 1000,
};

/** Strips punctuation/spaces so "กก." and "กก" compare equal. */
function normalizeUnitToken(token: string): string {
  return token.trim().replace(/[.\s]/g, "").toLowerCase();
}

/** The unit's dimension and its factor to that dimension's base unit, or null. */
function unitDimension(token: string): { dim: "mass" | "volume"; factor: number } | null {
  const t = normalizeUnitToken(token);
  if (t in MASS_UNITS) return { dim: "mass", factor: MASS_UNITS[t] };
  if (t in VOLUME_UNITS) return { dim: "volume", factor: VOLUME_UNITS[t] };
  return null;
}

export type YieldProposal = {
  /** Suggested yield_qty: usable usage-units obtained from receiveQty purchase units. */
  qty: number;
  /** Human-readable derivation, shown next to the input so the arithmetic is visible. */
  basis: string;
};

/**
 * Proposes a yield_qty from a purchase-unit label, when — and only when — the
 * label states a pack size in a unit of the same dimension as the ingredient's
 * usage unit.
 *
 * Deliberately conservative, returning null rather than guessing:
 *   "แกล(4500g)"  + usage กรัม → 4500        (the ซอสพริก case)
 *   "ถุง(2โล)"    + usage กรัม → 2000
 *   "โล"          + usage กรัม → 1000        (bare unit, no pack size)
 *   "ลัง(25ถุง)"  + usage กรัม → null        (25 bags of unknown size)
 *   "แกลลอน4500"  + usage กรัม → null        (4500 of what?)
 *   "หวี" / "ตัว" + usage กรัม → null        (not a mass at all)
 *
 * The result is a theoretical pack size, NOT a trimmed yield: for anything
 * with waste (fish, vegetables) the real yield_qty is lower. Callers must
 * present this as an editable starting point, never apply it silently.
 */
export function proposeYieldQty(
  purchaseUnitLabel: string | null,
  usageUnit: string | null,
  receiveQty: number,
): YieldProposal | null {
  if (!purchaseUnitLabel || !usageUnit) return null;
  const usage = unitDimension(usageUnit);
  if (!usage) return null;

  const label = purchaseUnitLabel.trim();
  // Prefer a parenthesised pack size, e.g. "แกล(4500g)" → "4500g".
  const inParens = label.match(/[(（]([^)）]*)[)）]/);
  const candidate = inParens ? inParens[1] : label;

  // "<number><unit>" — the unit token is required, so a bare "แกลลอน4500"
  // (4500 of an unstated unit) is refused rather than guessed at.
  const withNumber = candidate.match(/(\d+(?:[.,]\d+)?)\s*([^\d\s()（）]+)/);
  let perPurchaseUnit: number | null = null;
  let derivation = "";

  if (withNumber) {
    const packQty = Number(withNumber[1].replace(",", ""));
    const packUnit = unitDimension(withNumber[2]);
    if (Number.isFinite(packQty) && packQty > 0 && packUnit && packUnit.dim === usage.dim) {
      perPurchaseUnit = (packQty * packUnit.factor) / usage.factor;
      derivation = `${packQty} ${withNumber[2].trim()} ต่อ 1 ${label}`;
    }
  } else {
    // No pack size stated — but the label may itself be a mass/volume unit
    // ("โล"), which converts directly.
    const bare = unitDimension(candidate);
    if (bare && bare.dim === usage.dim) {
      perPurchaseUnit = bare.factor / usage.factor;
      derivation = `1 ${label}`;
    }
  }

  if (perPurchaseUnit == null || !Number.isFinite(perPurchaseUnit) || perPurchaseUnit <= 0) return null;

  const qty = perPurchaseUnit * (receiveQty > 0 ? receiveQty : 1);
  const scaled = receiveQty > 1 ? ` × จำนวนรับ ${receiveQty}` : "";
  return { qty, basis: `${derivation}${scaled} = ${qty} ${usageUnit}` };
}

export type PosReceiptSummary = {
  materialCode: string;
  materialName: string;
  latestDateLabel: string;
  unitName: string;
  mixedUnits: boolean; // the latest date had more than one UnitName — unsafe to trust
  qty: number;
  totalCostIncVat: number;
  unitCost: number; // totalCostIncVat / qty, for the latest date only
};

/**
 * Parses the report into every delivery it contains, grouped by material and
 * kept in file order (which summarizeLatestDelivery's fold depends on).
 *
 * Rows are dropped here exactly as before: header/subtotal rows (no
 * DocumentNumber), rows before any MaterialCode has been seen, and rows with
 * an unparseable date or qty <= 0.
 *
 * The report is a rolling window (its own title row states the range — the
 * verified sample covers 01 เมษายน – 11 กรกฎาคม 2569 only), so deliveries
 * older than that are not recoverable from a later export. That's why this
 * returns everything rather than only what one aggregation happens to need.
 */
/**
 * Recovers the month of a delivery whose DocumentDate cell is empty.
 *
 * The document number encodes the period:
 *
 *     001DR042568/000323
 *          ||||||
 *          ++++++-- month 04, Buddhist year 2568  ->  April 2025
 *
 * Verified against every dated row in the table: the document number's month
 * and year agree with DocumentDate on 22,715 of 22,715 rows — 100.0%. So the
 * month is exact. The day is not recoverable at all: 3,312 of 3,322 dateless
 * raw rows have a genuinely empty cell, with nothing to parse.
 *
 * Returns the FIRST of the month as a placeholder day. Callers must carry
 * datePrecision: "month" alongside it so nothing downstream mistakes the 1st
 * for a real date.
 */
export function recoverPeriodFromDocumentNumber(
  documentNumber: string,
): { dateKey: number; dateLabel: string; iso: string } | null {
  const m = /^\d+DR(\d{2})(\d{4})\//.exec(documentNumber.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const buddhistYear = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const year = buddhistYear - 543;
  if (year < 2000 || year > 2200) return null;
  const mm = String(month).padStart(2, "0");
  return {
    dateKey: buddhistYear * 10000 + month * 100 + 1,
    dateLabel: `${THAI_MONTH_NAMES[month - 1]} ${buddhistYear} (ทราบแค่เดือน)`,
    iso: `${year}-${mm}-01`,
  };
}

export function parsePosReceiptDeliveries(buffer: ArrayBuffer): PosMaterialDeliveries[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // raw: true is SheetJS's default and is load-bearing here — do not set
  // raw: false. The source is an HTML table, and ~1,259 of its rows carry
  // comma-formatted totals ("4,302.00"). Under raw: true SheetJS coerces
  // those to real numbers; under raw: false they come back as strings and
  // Number("4,302.00") is NaN, which the `|| 0` below would silently turn
  // into a zero cost or a dropped row.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });

  const byMaterial = new Map<string, PosMaterialDeliveries>();

  let currentCode: string | null = null;
  let currentName: string | null = null;

  for (const row of rows) {
    const materialCode = row[COL.materialCode] != null ? String(row[COL.materialCode]).trim() : "";
    const materialName = row[COL.materialName] != null ? String(row[COL.materialName]).trim() : "";
    const documentNumber = row[COL.documentNumber];
    const documentDateRaw = row[COL.documentDate];

    // Code/name appear once per material, then blank on follow-up receipts.
    if (materialCode) {
      currentCode = materialCode;
      currentName = materialName;
    }

    // Header rows ("Group :"/"Dept :") and subtotal rows both have no DocumentNumber.
    if (documentNumber == null || String(documentNumber).trim() === "") continue;
    if (!currentCode) continue;

    const exactKey = documentDateRaw ? parseThaiDateSortKey(String(documentDateRaw)) : null;
    // A dateless row used to be dropped outright — 1,647 deliveries, of which
    // 435 are real food once the non-food buckets are excluded. They exist
    // nowhere else: the POS export is a rolling window, so anything not
    // captured now ages out of the source permanently.
    const recovered = exactKey == null ? recoverPeriodFromDocumentNumber(String(documentNumber).trim()) : null;
    const dateKey = exactKey ?? recovered?.dateKey ?? null;
    const datePrecision: DatePrecision = exactKey != null ? "day" : "month";
    const qty = Number(row[COL.qty]) || 0;
    const totalCostIncVat = Number(row[COL.totalCostIncVat]) || 0;
    const totalCostExcVat = Number(row[COL.totalCostExcVat]) || 0;
    const unitName = row[COL.unitName] != null ? String(row[COL.unitName]).trim() : "";
    const vendorName = row[COL.vendorName] != null ? String(row[COL.vendorName]).trim() : "";
    if (dateKey == null || qty <= 0) continue;

    let material = byMaterial.get(currentCode);
    if (!material) {
      material = { materialCode: currentCode, materialName: currentName ?? currentCode, deliveries: [] };
      byMaterial.set(currentCode, material);
    }
    material.deliveries.push({
      documentNumber: String(documentNumber).trim(),
      dateKey,
      dateLabel: exactKey != null ? String(documentDateRaw) : recovered!.dateLabel,
      vendorName,
      unitName,
      qty,
      totalCostIncVat,
      totalCostExcVat,
      unitCost: deliveryCost({ totalCostIncVat, totalCostExcVat }) / qty,
      datePrecision,
    });
  }

  return Array.from(byMaterial.values());
}

/**
 * Reduces each material to its single most recent delivery date: receipts on
 * that same latest date are summed together, and earlier dates are ignored
 * entirely.
 *
 * Averaging across days was avoided here because some days have the wrong
 * unit entered — a real limitation, since it also means one atypical
 * delivery becomes the standing cost until the next import. Replacing this
 * with a windowed weighted average is a later step and needs unit coherence
 * first; this function is the current behaviour, preserved verbatim.
 *
 * Folds in file order rather than by sorting, so materials whose rows are
 * not chronological reduce exactly as they did before.
 */
export function summarizeLatestDelivery(materials: PosMaterialDeliveries[]): PosReceiptSummary[] {
  return materials
    .map((m) => {
      let seen = false;
      let latestDateKey = 0;
      let latestDateLabel = "";
      let unitName = "";
      let mixedUnits = false;
      let qty = 0;
      let cost = 0;

      for (const d of m.deliveries) {
        if (!seen || d.dateKey > latestDateKey) {
          seen = true;
          latestDateKey = d.dateKey;
          latestDateLabel = d.dateLabel;
          unitName = d.unitName;
          mixedUnits = false;
          qty = d.qty;
          cost = deliveryCost(d);
        } else if (d.dateKey === latestDateKey) {
          if (d.unitName && unitName && d.unitName !== unitName) mixedUnits = true;
          qty += d.qty;
          cost += deliveryCost(d);
        }
      }

      return {
        materialCode: m.materialCode,
        materialName: m.materialName,
        latestDateLabel,
        unitName,
        mixedUnits,
        qty,
        totalCostIncVat: cost,
        unitCost: qty > 0 ? cost / qty : 0,
      };
    })
    .sort((a, b) => a.materialName.localeCompare(b.materialName, "th"));
}

/**
 * Parses the report and returns one summary row per material, using only its
 * most recent delivery date. Unchanged in behaviour — now composed from the
 * two functions above so the full delivery list is available to callers that
 * need it.
 */
export function parsePosReceiptReport(buffer: ArrayBuffer): PosReceiptSummary[] {
  return summarizeLatestDelivery(parsePosReceiptDeliveries(buffer));
}

// ---------------------------------------------------------------------------
// "รายงานการขายตามสินค้า" (sales-by-product report) — used to refresh each
// menu's qty sold for Menu Engineering. Unlike the receipt report, this one
// already gives one pre-aggregated total per product for the whole date
// range selected at export time, so there's no per-date logic needed here —
// just sum rows that share the same product name (a dish can appear under
// more than one POS group, e.g. a regular menu vs. a seasonal set menu).
// ---------------------------------------------------------------------------

export type PosSalesSummary = {
  productName: string;
  qtySold: number;
  netRevenue: number;
};

export type PosSalesReport = {
  rows: PosSalesSummary[];
  /** Raw Thai date string extracted from the report header, e.g. "01 กรกฎาคม 2569". Empty string if not found. */
  dateFrom: string;
  dateTo: string;
};

/**
 * Extract date range from the report title row (row 0 only).
 * Month-only: "(มิถุนายน 2569)"           → dateFrom="มิถุนายน 2569", dateTo=same
 * Single-day: "(12 สิงหาคม 2567)"         → dateFrom=dateTo
 * Range:      "(01 มกราคม 2568 - 26 กรกฎาคม 2569)" → dateFrom ≠ dateTo
 * Row 1 is the report-creation date and is intentionally ignored.
 */
function extractDatesFromHeader(rows: unknown[][]): { dateFrom: string; dateTo: string } {
  if (rows.length === 0) return { dateFrom: "", dateTo: "" };
  const THAI_MONTH_NAMES = Object.keys(THAI_MONTHS);
  const months = THAI_MONTH_NAMES.join("|");
  const titleRow = rows[0].filter((c) => c != null).join(" ");

  // Try full date first: "DD MonthTH YYYY"
  const fullDatePattern = new RegExp(`(\\d{1,2})\\s+(${months})\\s+(\\d{4})`, "g");
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = fullDatePattern.exec(titleRow)) !== null) {
    found.push(`${m[1]} ${m[2]} ${m[3]}`);
  }
  if (found.length > 0) {
    return { dateFrom: found[0], dateTo: found[found.length - 1] };
  }

  // Fallback: month+year only "MonthTH YYYY"
  const monthOnlyPattern = new RegExp(`(${months})\\s+(\\d{4})`, "g");
  while ((m = monthOnlyPattern.exec(titleRow)) !== null) {
    found.push(`${m[1]} ${m[2]}`);
  }
  if (found.length > 0) {
    return { dateFrom: found[0], dateTo: found[found.length - 1] };
  }

  // Fallback: year only "(YYYY)"
  const yearOnly = titleRow.match(/\((\d{4})\)/);
  if (yearOnly) {
    return { dateFrom: yearOnly[1], dateTo: yearOnly[1] };
  }

  return { dateFrom: "", dateTo: "" };
}

export function parsePosSalesReport(buffer: ArrayBuffer): PosSalesReport {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

  const { dateFrom, dateTo } = extractDatesFromHeader(rows);

  const byProduct = new Map<string, { qtySold: number; netRevenue: number }>();

  for (const row of rows) {
    const rowLabel = row[0] != null ? String(row[0]).trim() : "";
    let productName = row[2] != null ? String(row[2]).trim() : "";
    if (!productName || productName === "ชื่อสินค้า" || rowLabel.startsWith("ยอดรวม")) continue; // header row / group header / subtotal / grand total rows

    // Same dish sold through a delivery channel or as a takeaway pack
    // (e.g. "(Grab)น้ำจิ้มซีฟู้ด", "(ห่อ)ข้าวผัดกุ้ง") counts toward the
    // base menu item, not as a separate product.
    productName = productName.replace(/^\((?:Grab|LM|ห่อ)\)\s*/i, "").trim();
    // "**" marks a dish chosen as part of a set menu (e.g. Family975) —
    // its price is bundled into the set's own line, but the qty still
    // counts toward how many times that dish was actually served.
    productName = productName.replace(/\*+$/, "").trim();

    const qty = Number(row[4]) || 0;
    const netRevenue = Number(row[9]) || 0;

    const existing = byProduct.get(productName);
    if (existing) {
      existing.qtySold += qty;
      existing.netRevenue += netRevenue;
    } else {
      byProduct.set(productName, { qtySold: qty, netRevenue });
    }
  }

  const salesRows = Array.from(byProduct.entries())
    .map(([productName, v]) => ({ productName, qtySold: v.qtySold, netRevenue: v.netRevenue }))
    .sort((a, b) => b.qtySold - a.qtySold);

  return { rows: salesRows, dateFrom, dateTo };
}

// ─── Round-tripping a delivery through the database ────────────────────────
// pos_receipt_deliveries stores document_date as a real DATE and deliberately
// does NOT persist dateKey or dateLabel — dateKey is an in-memory ordering
// detail, and dateLabel is the report's own Buddhist-era string. Both have to
// be regenerated when deliveries are read back out of the table to build a
// preview, and the label must match the file's format exactly or the UI text
// silently changes.


/** "2026-08-30" -> "30 สิงหาคม 2569". Inverse of the parser's date handling. */
export function isoToThaiDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const [, y, mm, dd] = m;
  const monthName = THAI_MONTH_NAMES[Number(mm) - 1] ?? mm;
  // Day is NOT zero-padded in the report ("01 เมษายน" is, but the parser only
  // reads the number, and the label is display-only), so keep the file's
  // two-digit form to match what previously reached the UI.
  return `${dd} ${monthName} ${Number(y) + 543}`;
}

/** "2026-08-30" -> 25690830, the same numeric ordering key the parser builds. */
export function isoToDateKey(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return 0;
  const [, y, mm, dd] = m;
  return (Number(y) + 543) * 10000 + Number(mm) * 100 + Number(dd);
}
