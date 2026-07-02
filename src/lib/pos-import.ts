import "server-only";
import * as XLSX from "xlsx";

// The POS "ใบรับสินค้าตรง" report is exported as an HTML table saved with a
// .xls extension. Each material's rows are forward-filled (code/name appear
// once, then blank on follow-up receipts), and the file also contains
// "Group :"/"Dept :" header rows and subtotal rows mixed in. Both of those
// always have an empty DocumentNumber, which is how we tell them apart from
// real receipt lines.

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
 * Parses the report and returns one summary row per material: the qty and
 * TotalCost(Inc.Vat) of its single most recent delivery date (receipts on
 * the same latest date are summed together; earlier dates are ignored
 * entirely — averaging across days is unsafe because some days have the
 * wrong unit entered).
 */
export function parsePosReceiptReport(buffer: ArrayBuffer): PosReceiptSummary[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

  // Per material: track the latest date seen so far, and accumulate qty/cost for that date.
  const byMaterial = new Map<
    string,
    {
      materialName: string;
      latestDateKey: number;
      latestDateLabel: string;
      unitName: string;
      mixedUnits: boolean;
      qty: number;
      totalCostIncVat: number;
    }
  >();

  let currentCode: string | null = null;
  let currentName: string | null = null;

  for (const row of rows) {
    const materialCode = row[0] != null ? String(row[0]).trim() : "";
    const materialName = row[1] != null ? String(row[1]).trim() : "";
    const documentNumber = row[2];
    const documentDateRaw = row[4];
    const unitNameRaw = row[6];
    const qtyRaw = row[10];
    const totalCostIncVatRaw = row[14];

    if (materialCode) {
      currentCode = materialCode;
      currentName = materialName;
    }

    // Header rows ("Group :"/"Dept :") and subtotal rows both have no DocumentNumber.
    if (documentNumber == null || String(documentNumber).trim() === "") continue;
    if (!currentCode) continue;

    const dateKey = documentDateRaw ? parseThaiDateSortKey(String(documentDateRaw)) : null;
    const qty = Number(qtyRaw) || 0;
    const totalCostIncVat = Number(totalCostIncVatRaw) || 0;
    const unitName = unitNameRaw != null ? String(unitNameRaw).trim() : "";
    if (dateKey == null || qty <= 0) continue;

    const existing = byMaterial.get(currentCode);
    if (!existing) {
      byMaterial.set(currentCode, {
        materialName: currentName ?? currentCode,
        latestDateKey: dateKey,
        latestDateLabel: String(documentDateRaw),
        unitName,
        mixedUnits: false,
        qty,
        totalCostIncVat,
      });
    } else if (dateKey > existing.latestDateKey) {
      existing.latestDateKey = dateKey;
      existing.latestDateLabel = String(documentDateRaw);
      existing.unitName = unitName;
      existing.mixedUnits = false;
      existing.qty = qty;
      existing.totalCostIncVat = totalCostIncVat;
    } else if (dateKey === existing.latestDateKey) {
      if (unitName && existing.unitName && unitName !== existing.unitName) existing.mixedUnits = true;
      existing.qty += qty;
      existing.totalCostIncVat += totalCostIncVat;
    }
  }

  return Array.from(byMaterial.entries())
    .map(([materialCode, v]) => ({
      materialCode,
      materialName: v.materialName,
      latestDateLabel: v.latestDateLabel,
      unitName: v.unitName,
      mixedUnits: v.mixedUnits,
      qty: v.qty,
      totalCostIncVat: v.totalCostIncVat,
      unitCost: v.qty > 0 ? v.totalCostIncVat / v.qty : 0,
    }))
    .sort((a, b) => a.materialName.localeCompare(b.materialName, "th"));
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

export function parsePosSalesReport(buffer: ArrayBuffer): PosSalesSummary[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

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

  return Array.from(byProduct.entries())
    .map(([productName, v]) => ({ productName, qtySold: v.qtySold, netRevenue: v.netRevenue }))
    .sort((a, b) => b.qtySold - a.qtySold);
}
