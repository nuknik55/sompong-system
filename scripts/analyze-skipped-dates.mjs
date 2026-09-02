// Investigation only — reads the POS exports and the deliveries table, writes
// nothing. Answers whether date recovery must precede the dominant-vendor work.
//
//   node scripts/analyze-skipped-dates.mjs --dir <folder>
//
// The backfill dropped rows whose DocumentDate would not parse. Those rows
// still carry MaterialCode, VendorName, UnitName, Qty and cost — only the date
// is missing — so their effect on vendor dominance and on the same-unit median
// can be assessed without recovering a single date.

import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import * as XLSX from "xlsx";

const argv = process.argv.slice(2);
const DIR = argv[argv.indexOf("--dir") + 1];
if (!DIR || DIR.startsWith("--")) {
  console.error("usage: node scripts/analyze-skipped-dates.mjs --dir <folder>");
  process.exit(2);
}

const EXPECTED_HEADER = [
  "MaterialCode", "MaterialName", "DocumentNumber", "InvoiceReference", "DocumentDate",
  "VendorName", "UnitName", "LastCost(Exc.Vat)", "Cost", "PricePerUnit", "Qty", "Discount",
  "TotalCost(Exc.Vat)", "VAT", "TotalCost(Inc.Vat)", "Remark",
];
const COL = {
  materialCode: 0, materialName: 1, documentNumber: 2, documentDate: 4,
  vendorName: 5, unitName: 6, qty: 10, totalCostExcVat: 12, totalCostIncVat: 14,
};
const THAI_MONTHS = {
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6,
  กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12,
};
function thaiDateToISO(text) {
  const m = String(text).trim().match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (!m) return null;
  const month = THAI_MONTHS[m[2]];
  if (!month) return null;
  const year = Number(m[3]) - 543;
  if (!Number.isFinite(year) || year < 1900 || year > 2200) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
}
function readSheet(path) {
  const b = readFileSync(path);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const wb = XLSX.read(ab, { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
}
function isDetail(rows) {
  const i = rows.findIndex((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() === "MaterialCode"));
  if (i < 0) return false;
  const hdr = rows[i].map((c) => String(c ?? "").trim());
  return EXPECTED_HEADER.every((h, k) => hdr[k] === h);
}

// ── collect skipped + landed, deduped on the same key the table uses ────────
const skipped = new Map(); // docNumber|code -> row
const landed = new Map();
const rawDateSamples = new Map(); // what the unparseable cell actually held

for (const f of readdirSync(DIR).filter((x) => /^NewMaterialTransferReceive_.*\.xls$/i.test(x))) {
  let rows;
  try { rows = readSheet(join(DIR, f)); } catch { continue; }
  if (!isDetail(rows)) continue;

  let code = null, name = null;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const mc = row[COL.materialCode] != null ? String(row[COL.materialCode]).trim() : "";
    if (mc) { code = mc; name = row[COL.materialName] != null ? String(row[COL.materialName]).trim() : ""; }
    const doc = row[COL.documentNumber];
    if (doc == null || String(doc).trim() === "") continue;
    if (!code) continue;

    const rec = {
      code, name: name || code,
      vendor: row[COL.vendorName] != null ? String(row[COL.vendorName]).trim() : "",
      unit: row[COL.unitName] != null ? String(row[COL.unitName]).trim() : "",
      qty: Number(row[COL.qty]) || 0,
      cost: Number(row[COL.totalCostIncVat]) || 0,
      file: basename(f),
    };
    const key = `${String(doc).trim()}|${code}`;
    const iso = row[COL.documentDate] ? thaiDateToISO(row[COL.documentDate]) : null;
    if (iso == null) {
      if (!skipped.has(key)) skipped.set(key, rec);
      const raw = row[COL.documentDate];
      const shape = raw == null ? "(null/empty)" : JSON.stringify(String(raw)).slice(0, 40);
      rawDateSamples.set(shape, (rawDateSamples.get(shape) ?? 0) + 1);
    } else if (rec.qty > 0) {
      if (!landed.has(key)) landed.set(key, { ...rec, date: iso });
    }
  }
}

const byMaterial = new Map();
const bump = (code, name, field) => {
  let e = byMaterial.get(code);
  if (!e) { e = { code, name, skipped: 0, landed: 0, skipVendors: new Map(), landVendors: new Map(), skipUnits: new Set(), landUnits: new Set() }; byMaterial.set(code, e); }
  e[field]++;
  return e;
};
for (const r of skipped.values()) {
  const e = bump(r.code, r.name, "skipped");
  e.skipVendors.set(r.vendor, (e.skipVendors.get(r.vendor) ?? 0) + 1);
  e.skipUnits.add(r.unit);
}
for (const r of landed.values()) {
  const e = bump(r.code, r.name, "landed");
  e.landVendors.set(r.vendor, (e.landVendors.get(r.vendor) ?? 0) + 1);
  e.landUnits.add(r.unit);
}

const totalSkip = skipped.size;
const top = [...byMaterial.values()].filter((e) => e.skipped > 0).sort((a, b) => b.skipped - a.skipped);
const dom = (m) => { let best = null, n = -1; for (const [v, c] of m) if (c > n) { n = c; best = v; } return best; };

console.log(`distinct skipped deliveries : ${totalSkip}`);
console.log(`distinct landed deliveries  : ${landed.size}`);
console.log(`materials with any skip     : ${top.length}\n`);

console.log("what the unparseable DocumentDate cell actually contained:");
for (const [shape, n] of [...rawDateSamples].sort((a, b) => b[1] - a[1]).slice(0, 6)) {
  console.log(`  ${String(n).padStart(5)}  ${shape}`);
}

console.log("\nTOP 15 MATERIALS BY SKIPPED ROWS");
console.log("  skip  land   skip%  domVendor(land) domVendor(skip)  sameVendor? unitOverlap?  material");
let cum = 0;
for (const e of top.slice(0, 15)) {
  cum += e.skipped;
  const pct = e.skipped + e.landed > 0 ? (e.skipped / (e.skipped + e.landed)) * 100 : 100;
  const dl = dom(e.landVendors) ?? "—";
  const ds = dom(e.skipVendors) ?? "—";
  const same = dl === ds ? "yes" : "NO";
  const overlap = [...e.skipUnits].some((u) => e.landUnits.has(u)) ? "yes" : "NO";
  console.log(
    `  ${String(e.skipped).padStart(4)}  ${String(e.landed).padStart(4)}  ${pct.toFixed(0).padStart(5)}%  ` +
    `${(dl || "(blank)").slice(0, 14).padEnd(15)} ${(ds || "(blank)").slice(0, 14).padEnd(16)} ${same.padEnd(11)} ${overlap.padEnd(13)} ${e.name}`,
  );
}
console.log(`\n  top 15 cover ${cum} of ${totalSkip} skipped rows (${((cum / totalSkip) * 100).toFixed(1)}%)`);

const risky = top.filter((e) => {
  const pct = e.skipped / (e.skipped + e.landed);
  const dl = dom(e.landVendors), ds = dom(e.skipVendors);
  return pct >= 0.34 || dl !== ds || e.landed === 0;
});
console.log(`\nMATERIALS WHERE SKIPPED ROWS COULD MOVE THE ANSWER: ${risky.length}`);
console.log("(>=34% of history missing, OR skipped rows from a different dominant vendor, OR no dated rows at all)");
for (const e of risky.slice(0, 20)) {
  const pct = (e.skipped / (e.skipped + e.landed)) * 100;
  console.log(
    `  ${e.name.padEnd(28).slice(0, 28)} skip ${String(e.skipped).padStart(4)} / land ${String(e.landed).padStart(4)} (${pct.toFixed(0)}%)  ` +
    `land="${dom(e.landVendors) ?? "—"}" skip="${dom(e.skipVendors) ?? "—"}"`,
  );
}
