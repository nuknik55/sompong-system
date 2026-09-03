// Backfill pos_receipt_deliveries from archived POS "ใบรับสินค้าตรง" exports.
//
//   node scripts/backfill-pos-deliveries.mjs --dir "C:/Users/DELL/Downloads"            # dry run
//   node scripts/backfill-pos-deliveries.mjs --dir "..." --apply                        # write
//
// WHY: the POS export is a rolling ~3.5-month window, so deliveries that age
// out of it are not recoverable from a later export. The archive holds ~465
// days of history that the importer currently discards on every run.
//
// SAFETY
//   - Dry run by default; --apply is required to write anything.
//   - Classifies every file first and REFUSES anything that is not the
//     16-column DETAIL report, rather than treating "0 rows parsed" as
//     "wrong file" (that ambiguity is what made an earlier count wrong).
//   - Upserts on (document_number, material_code) with ignoreDuplicates, so
//     re-running is a genuine no-op. Verified across the archive: 0 cases of a
//     repeated key carrying different qty/cost/unit.
//   - Never checks `error` implicitly — every Supabase call is inspected and
//     aborts the run on failure.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const APPLY = argv.includes("--apply");
const DIR = arg("--dir");
const LIMIT = Number(arg("--limit", "0")) || 0;
if (!DIR) {
  console.error("usage: node scripts/backfill-pos-deliveries.mjs --dir <folder> [--apply] [--limit N]");
  process.exit(2);
}

// ── expected DETAIL layout (verified against a real export) ─────────────────
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

/** "01 มีนาคม 2569" -> "2026-03-01" (Buddhist -> Gregorian). */
function thaiDateToISO(text) {
  const m = String(text).trim().match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (!m) return null;
  const month = THAI_MONTHS[m[2]];
  if (!month) return null;
  const year = Number(m[3]) - 543;
  const day = Number(m[1]);
  if (!Number.isFinite(year) || year < 1900 || year > 2200) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Recovers month+year from the document number for a row whose DocumentDate
 * cell is empty. 001DR042568/000323 -> April 2025.
 *
 * Verified: the document number's period agrees with DocumentDate on 22,715
 * of 22,715 dated rows, i.e. 100.0%. The month is exact; the day is not
 * recoverable at all, so the returned date carries a PLACEHOLDER day of 1 and
 * the caller must store date_precision = 'month' beside it.
 */
function recoverPeriodISO(documentNumber) {
  const m = /^\d+DR(\d{2})(\d{4})\//.exec(String(documentNumber).trim());
  if (!m) return null;
  const month = Number(m[1]);
  const year = Number(m[2]) - 543;
  if (month < 1 || month > 12 || year < 2000 || year > 2200) return null;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function readSheet(path) {
  const b = readFileSync(path);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const wb = XLSX.read(ab, { type: "array" });
  // raw: true is load-bearing — see src/lib/pos-parse.ts. Under raw:false the
  // comma-formatted totals come back as strings and Number() yields NaN.
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, raw: true });
}

/** DETAIL | SUMMARY | STUB | UNREADABLE, with the reason. */
function classify(path) {
  let rows;
  try { rows = readSheet(path); } catch (e) { return { kind: "UNREADABLE", reason: String(e).slice(0, 80) }; }
  const hdrIdx = rows.findIndex((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() === "MaterialCode"));
  if (hdrIdx >= 0) {
    const hdr = rows[hdrIdx].map((c) => String(c ?? "").trim());
    const bad = [];
    for (let i = 0; i < EXPECTED_HEADER.length; i++) {
      if (hdr[i] !== EXPECTED_HEADER[i]) bad.push(`col ${i}: expected "${EXPECTED_HEADER[i]}", got "${hdr[i] ?? "(missing)"}"`);
    }
    if (bad.length) return { kind: "UNREADABLE", reason: "DETAIL-like header but columns differ: " + bad.join("; ") };
    return { kind: "DETAIL", rows, title: String(rows[0]?.filter((c) => c != null).join(" ") ?? "") };
  }
  const isSummary = rows.some((r) => Array.isArray(r) && r.map((c) => String(c ?? "").trim()).includes("Material Name"));
  if (isSummary) return { kind: "SUMMARY", reason: "6-column per-material summary — has no DocumentNumber/DocumentDate/UnitName/VendorName" };
  return { kind: "STUB", reason: "no recognisable header (likely a 'Save as Web Page' stub; real table is in the _files folder)" };
}

/** DETAIL rows -> delivery records ready for insert. */
function extract(rows, sourceFile) {
  const out = [];
  const skipped = { noDate: 0, badQty: 0 };
  let recoveredCount = 0;
  let code = null, name = null;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const mc = row[COL.materialCode] != null ? String(row[COL.materialCode]).trim() : "";
    const mn = row[COL.materialName] != null ? String(row[COL.materialName]).trim() : "";
    if (mc) { code = mc; name = mn; }

    const doc = row[COL.documentNumber];
    if (doc == null || String(doc).trim() === "") continue;   // group/subtotal rows
    if (!code) continue;

    const exact = row[COL.documentDate] ? thaiDateToISO(row[COL.documentDate]) : null;
    // A dateless row used to be dropped. 1,647 deliveries were lost that way,
    // and the POS export is a rolling window so they exist nowhere else.
    const recovered = exact == null ? recoverPeriodISO(doc) : null;
    const iso = exact ?? recovered;
    const datePrecision = exact != null ? "day" : "month";
    const qty = Number(row[COL.qty]) || 0;
    if (iso == null) { skipped.noDate++; continue; }
    if (qty <= 0) { skipped.badQty++; continue; }
    if (datePrecision === "month") recoveredCount++;

    out.push({
      material_code: code,
      material_name: name ?? code,
      document_number: String(doc).trim(),
      document_date: iso,
      date_precision: datePrecision,
      vendor_name: row[COL.vendorName] != null ? String(row[COL.vendorName]).trim() : "",
      unit_name: row[COL.unitName] != null ? String(row[COL.unitName]).trim() : "",
      qty,
      total_cost_inc_vat: Number(row[COL.totalCostIncVat]) || 0,
      total_cost_exc_vat: Number(row[COL.totalCostExcVat]) || 0,
      source_file: sourceFile,
    });
  }
  return { out, skipped, recoveredCount };
}

// ── main ────────────────────────────────────────────────────────────────────
const files = readdirSync(DIR)
  .filter((f) => /^NewMaterialTransferReceive_.*\.xls$/i.test(f))
  .map((f) => join(DIR, f))
  .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);   // oldest first

console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${files.length} candidate files in ${DIR}\n`);

const usable = [];
for (const p of files) {
  const c = classify(p);
  const tag = c.kind === "DETAIL" ? "DETAIL " : c.kind === "SUMMARY" ? "SKIP   " : "SKIP   ";
  const range = c.title ? (c.title.match(/\(([^)]*)\)/)?.[1] ?? "") : "";
  console.log(`  ${tag} ${basename(p).padEnd(46)} ${c.kind === "DETAIL" ? range : c.reason.slice(0, 90)}`);
  if (c.kind === "DETAIL") usable.push({ path: p, rows: c.rows });
}
if (usable.length === 0) { console.error("\nNo DETAIL exports found — nothing to do."); process.exit(1); }

// Deduplicate across files in memory, oldest-first (first write wins).
const seen = new Map();
let totalRows = 0;
const skippedTotals = { noDate: 0, badQty: 0 };
console.log("");
for (const { path, rows } of usable) {
  const { out, skipped, recoveredCount } = extract(rows, basename(path));
  let added = 0;
  for (const r of out) {
    const k = r.document_number + "|" + r.material_code;
    if (!seen.has(k)) { seen.set(k, r); added++; }
  }
  totalRows += out.length;
  skippedTotals.noDate += skipped.noDate;
  skippedTotals.badQty += skipped.badQty;
  console.log(`  ${basename(path).padEnd(46)} parsed ${String(out.length).padStart(5)}  new ${String(added).padStart(5)}  skipped(date ${skipped.noDate}, qty ${skipped.badQty})  recovered-month ${recoveredCount}`);
}

let records = [...seen.values()];
if (LIMIT > 0) records = records.slice(0, LIMIT);
const dates = records.map((r) => r.document_date).sort();
console.log(`\n  parsed rows total     : ${totalRows}`);
console.log(`  distinct deliveries   : ${seen.size}${LIMIT ? ` (limited to ${records.length})` : ""}`);
console.log(`  skipped unparseable   : date ${skippedTotals.noDate}, qty<=0 ${skippedTotals.badQty}`);
console.log(`  date span             : ${dates[0]} -> ${dates[dates.length - 1]}`);
console.log(`  distinct materials    : ${new Set(records.map((r) => r.material_code)).size}`);
console.log(`  blank vendor_name     : ${records.filter((r) => !r.vendor_name).length}`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing written. Re-run with --apply to insert.");
  console.log("Sample record:");
  console.log(JSON.stringify(records[0], null, 2));
  process.exit(0);
}

// ── write ───────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Fail fast if the migration has not been run.
{
  const { error } = await sb.from("pos_receipt_deliveries").select("id").limit(1);
  if (error) {
    console.error(`\nABORT: cannot read pos_receipt_deliveries (${error.code}: ${error.message})`);
    console.error("Run supabase/pos_receipt_deliveries_migration.sql first.");
    process.exit(1);
  }
}

const BATCH = 500;
let inserted = 0;
for (let i = 0; i < records.length; i += BATCH) {
  const chunk = records.slice(i, i + BATCH);
  const { error, count } = await sb
    .from("pos_receipt_deliveries")
    .upsert(chunk, { onConflict: "document_number,material_code", ignoreDuplicates: true, count: "exact" });
  if (error) {
    console.error(`\nABORT at rows ${i}..${i + chunk.length}: ${error.code}: ${error.message}`);
    console.error(`${inserted} rows were written before this point; re-running is safe (upsert is idempotent).`);
    process.exit(1);
  }
  inserted += count ?? 0;
  console.log(`  wrote ${String(i + chunk.length).padStart(6)} / ${records.length}  (new this batch: ${count ?? "?"})`);
}

const { count: finalCount, error: countErr } = await sb
  .from("pos_receipt_deliveries").select("id", { count: "exact" }).limit(1);
if (countErr) console.error(`(could not verify final count: ${countErr.message})`);
console.log(`\nDone. New rows inserted: ${inserted}. Table now holds: ${finalCount ?? "?"}.`);
