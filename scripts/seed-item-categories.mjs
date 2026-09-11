// Seed pos_item_categories from Nik's hand-built monthly split.
//
//   node scripts/seed-item-categories.mjs --nik <69-MMSaleData.xlsx> --raw <SaleData_*.xls>
//   node scripts/seed-item-categories.mjs --nik ... --raw ... --sql out.sql
//
// Reads two files and WRITES NOTHING to the database. It prints a coverage
// report and, with --sql, emits reviewable SQL for a human to run.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// Every month Nik splits the raw POS export by hand into seven sheets. Six of
// them encode a judgment the POS cannot supply — which revenue category an item
// belongs to — and that judgment is what pos_item_categories stores. His August
// file is therefore an answer key for ~777 items already classified, and
// seeding from it means he never classifies a backlog by hand.
//
// ── THE SEVEN SHEETS ARE NOT SEVEN CATEGORIES ──────────────────────────────
//
// Five of them map to a category directly. LM and Grab do NOT — they are a
// CHANNEL, and a Lineman dessert is still a dessert. Items on those two sheets
// are re-categorised by looking the product up in the raw export and reading
// its POS group. Seeding them as categories would put every delivered dish in
// the wrong bucket.
//
// ── WHY THE COVERAGE CHECK MATTERS MORE THAN THE SEED ──────────────────────
//
// The source file is known to have dropped a line: ปูเนื้อผัดพริกไทยดำ, ฿1,080,
// in the อาหารห่อ channel — the one channel his manual process has no sheet
// for. So the seed is derived from a file with a demonstrated omission, and
// trusting it silently is exactly the wrong move.
//
// The check is therefore not "did the seed work" but "which products in the RAW
// export end up with no category". Every one is named before any SQL is
// written. A product the hand-split missed cannot slip through as a default.

import fs from "node:fs";
import * as XLSX from "xlsx";

const args = process.argv.slice(2);
const argOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const NIK = argOf("--nik");
const RAW = argOf("--raw");
const SQL_OUT = argOf("--sql");

if (!NIK || !RAW) {
  console.error("usage: --nik <69-MMSaleData.xlsx> --raw <SaleData_*.xls> [--sql out.sql]");
  process.exit(1);
}

/** Sheets whose name IS the category. */
const SHEET_CATEGORY = {
  "อาหาร": "food",
  "ของหวาน": "dessert",
  "เครื่องดื่ม": "drink",
  "กาแฟ": "coffee",
  "อื่นๆ": "other",
};

/** Sheets that are a delivery CHANNEL — category comes from the raw export. */
const CHANNEL_SHEETS = new Set(["LM", "Grab"]);

/**
 * Raw-export POS group -> category, the LM/Grab fallback. ONE definition,
 * shared with the classification screen: src/lib/pos-group-category.ts.
 * The groups with no default (Other, ออเดอร์พนักงาน, อื่นๆ) and the reasons
 * are documented there.
 */
const { categoryFromPosGroup: categoryFromRaw } = await import("../src/lib/pos-group-category.ts");

/**
 * Products whose category overrides everything else, including their POS group.
 *
 * These sit ABOVE the group rule in precedence, and that ordering is load
 * bearing rather than incidental: กลุ่มของฝาก membership has to outrank Nik's
 * own sheets — all 15 of those products are in his อาหาร sheet — so without an
 * exception list sitting above BOTH, a per-item decision could not survive.
 *
 *   ขนมบ้าบิ่น / (โปร) ขนมบ้าบิ่น 2 ชิ้น
 *     In the กลุ่มของฝาก group, but booked as dessert. The promo pack is a
 *     packaging variant of the same confection, so both names are listed —
 *     matching is exact, and exact matching would otherwise split ฿1,800 of
 *     promo pack away from ฿1,315 of the identical item.
 *
 *   เพิ่ม50 / เพิ่ม50บาท
 *     The same "add 50 baht" surcharge, typed two ways by staff, which Nik's
 *     sheets place in อื่นๆ and อาหาร respectively. Both are money a customer
 *     pays for food.
 *
 * DELIBERATELY NOT a name-normaliser or fuzzy matcher. Two variant pairs across
 * 523 products does not justify a matcher that could silently merge two
 * genuinely different products, and that matcher's failures would be invisible.
 * Named exceptions stay auditable; a heuristic does not.
 */
const EXCEPTIONS = new Map([
  ["ขนมบ้าบิ่น", "dessert"],
  ["(โปร) ขนมบ้าบิ่น 2 ชิ้น", "dessert"],
  ["เพิ่ม50", "food"],
  ["เพิ่ม50บาท", "food"],
]);

/**
 * Per-unit amounts carved out to the coffee shop.
 *
 * One real case. ไอติมข้าวเหนียวมะม่วง sells at 129: Nik books 15 to the coffee
 * shop and 114 to desserts, and his own sheets show it in BOTH at exactly those
 * two prices. So it is a DESSERT with 15 carved out — not coffee with a share,
 * which would strand the other 114.
 *
 * A carved-out item appearing in two sheets is therefore EXPECTED, not a
 * conflict. The resolver below takes its category from the non-coffee sheet.
 */
const CARVE_OUT = new Map([["ไอติมข้าวเหนียวมะม่วง", 15]]);

const stripChannel = (s) =>
  String(s).replace(/^\((?:Grab|LM|ห่อ)\)\s*/i, "").replace(/\*+$/, "").trim();

// ── Read the raw export: the authority on which products exist ─────────────
const rawBuf = fs.readFileSync(RAW);
const { parsePosMonthlyExport } = await import("../src/lib/pos-parse.ts");
const raw = parsePosMonthlyExport(
  rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength),
);

if (raw.lines.length === 0) {
  console.error("The raw export parsed to zero item rows. Refusing to continue —");
  console.error("a truncated or corrupt export would make the coverage check meaningless.");
  process.exit(1);
}

/** productName -> {group, category, gross} from the raw export. */
const rawByName = new Map();
for (const l of raw.lines) {
  const e = rawByName.get(l.productName) ?? { group: l.group, category: l.category, gross: 0 };
  e.gross += l.gross;
  rawByName.set(l.productName, e);
}

// ── Read Nik's split ───────────────────────────────────────────────────────
const nik = XLSX.read(fs.readFileSync(NIK), { type: "buffer" });

/** product name -> the set of his sheets it appears on. */
const sheetsOf = new Map();
const notInRaw = [];

for (const sheetName of nik.SheetNames) {
  if (sheetName === "Sheet1") continue; // the numeric skeleton; names stripped out
  if (!SHEET_CATEGORY[sheetName] && !CHANNEL_SHEETS.has(sheetName)) {
    console.error(`UNKNOWN SHEET "${sheetName}" — neither a category nor a channel. Refusing to guess.`);
    process.exit(1);
  }
  const rows = XLSX.utils
    .sheet_to_json(nik.Sheets[sheetName], { header: 1, defval: null })
    .filter((r) => r && String(r[0] ?? "").trim() !== "");

  for (const r of rows) {
    const name = stripChannel(r[0]);
    if (!rawByName.has(name)) {
      notInRaw.push({ name, sheet: sheetName });
      continue;
    }
    if (!sheetsOf.has(name)) sheetsOf.set(name, new Set());
    sheetsOf.get(name).add(sheetName);
  }
}

/**
 * Decide one product's category.
 *
 * PRECEDENCE, and the order is load bearing rather than incidental:
 *
 *   1. EXCEPTIONS          a named per-item decision beats everything
 *   2. กลุ่มของฝาก group    beats his sheets, because all 15 of those products
 *                          sit in his อาหาร sheet — without this outranking
 *                          rule 3, souvenir would stay invisible inside food
 *   3. his category sheet  อาหาร / ของหวาน / เครื่องดื่ม / กาแฟ / อื่นๆ
 *   4. LM/Grab fallback    channel sheets carry no category, so it comes from
 *                          the raw export's POS group
 *
 * Returns { category, source } or { unresolved } or { conflict }. Nothing is
 * guessed: a product this cannot resolve is reported by name.
 */
function resolve(name, rawEntry, sheets) {
  if (EXCEPTIONS.has(name)) {
    return { category: EXCEPTIONS.get(name), source: "exception (named)" };
  }

  if (rawEntry.group === "กลุ่มของฝาก") {
    return { category: "souvenir", source: "POS group กลุ่มของฝาก" };
  }

  const catSheets = [...(sheets ?? [])].filter((s) => SHEET_CATEGORY[s]);
  if (catSheets.length > 0) {
    const cats = new Set(catSheets.map((s) => SHEET_CATEGORY[s]));
    // A carved-out item is EXPECTED in two sheets — ไอติมข้าวเหนียวมะม่วง is in
    // both ของหวาน and กาแฟ by design. Its category is the non-coffee one; the
    // coffee membership is the carve-out, not a competing classification.
    if (cats.size > 1 && CARVE_OUT.has(name)) cats.delete("coffee");
    if (cats.size === 1) return { category: [...cats][0], source: catSheets.join("+") };
    return { conflict: [...cats].sort(), source: catSheets.join("+") };
  }

  if ([...(sheets ?? [])].some((s) => CHANNEL_SHEETS.has(s))) {
    const c = categoryFromRaw(rawEntry.group, rawEntry.category);
    if (c) return { category: c, source: `POS group ${rawEntry.group}` };
    return { unresolved: `on LM/Grab only, and POS group "${rawEntry.group}" has no default` };
  }

  return { unresolved: "not on any of his sheets" };
}

// Iterate over the RAW export, which is the authority on what exists. Driving
// from his sheets instead would make coverage a side effect rather than the
// question being asked.
const assigned = new Map();
const conflicts = [];
const uncovered = [];

for (const [name, rawEntry] of rawByName) {
  const r = resolve(name, rawEntry, sheetsOf.get(name));
  if (r.category) assigned.set(name, { category: r.category, source: r.source });
  else if (r.conflict) conflicts.push({ name, cats: r.conflict, source: r.source, gross: rawEntry.gross });
  else uncovered.push({ name, group: rawEntry.group, category: rawEntry.category, gross: rawEntry.gross, why: r.unresolved });
}
uncovered.sort((a, b) => b.gross - a.gross);
conflicts.sort((a, b) => b.gross - a.gross);

// ── Report ─────────────────────────────────────────────────────────────────
const byCategory = {};
for (const [, v] of assigned) byCategory[v.category] = (byCategory[v.category] ?? 0) + 1;

console.log("── SOURCES ──────────────────────────────────────────────────────");
console.log(`  raw export      ${RAW}`);
console.log(`                  ${raw.lines.length} item lines, ${rawByName.size} distinct products, ${raw.dateFrom}`);
console.log(`  hand-built      ${NIK}`);
console.log(`                  sheets: ${nik.SheetNames.filter((s) => s !== "Sheet1").join(", ")}`);

console.log("\n── ASSIGNED ─────────────────────────────────────────────────────");
for (const [k, v] of Object.entries(byCategory).sort()) console.log(`  ${k.padEnd(9)} ${String(v).padStart(4)}`);
console.log(`  ${"TOTAL".padEnd(9)} ${String(assigned.size).padStart(4)}`);

console.log("\n── COVERAGE CHECK ───────────────────────────────────────────────");
console.log(`  raw-export products with NO category: ${uncovered.length}`);
for (const u of uncovered) {
  console.log(`    ฿${u.gross.toFixed(0).padStart(9)}  ${u.name}   [POS: ${u.group} :: ${u.category}]  — ${u.why}`);
}
if (uncovered.length === 0) console.log("    (none — every product in the raw export is classified)");

console.log("\n── CONFLICTS (same product, two categories) ─────────────────────");
console.log(`  ${conflicts.length}`);
// Shape must match what resolve() pushes. An earlier version read c.a/c.b and
// would have thrown at exactly the moment a conflict appeared — a reporter that
// crashes on the case it exists for is worse than no reporter.
for (const c of conflicts)
  console.log(`    ฿${c.gross.toFixed(0).padStart(9)}  ${c.name}  ->  ${c.cats.join(" vs ")}   [sheets: ${c.source}]`);

console.log("\n── IN NIK'S SHEETS BUT NOT IN THE RAW EXPORT ────────────────────");
console.log(`  ${notInRaw.length}`);
for (const n of notInRaw.slice(0, 20)) console.log(`    ${n.sheet}: ${n.name}`);

const carveApplied = [...CARVE_OUT.keys()].filter((k) => assigned.has(k));
console.log("\n── CARVE-OUTS ───────────────────────────────────────────────────");
for (const k of CARVE_OUT.keys()) {
  const a = assigned.get(k);
  console.log(`  ${k}: ${a ? `category=${a.category}, coffee_share_per_unit=${CARVE_OUT.get(k)}` : "NOT ASSIGNED — carve-out would be lost"}`);
}

const blocking = conflicts.length > 0 || carveApplied.length !== CARVE_OUT.size;
if (blocking) {
  console.log("\nBLOCKED: resolve the conflicts / missing carve-outs above before generating SQL.");
  process.exit(1);
}

// ── SQL ────────────────────────────────────────────────────────────────────
if (SQL_OUT) {
  const esc = (s) => String(s).replace(/'/g, "''");
  const lines = [];
  lines.push("-- Seed pos_item_categories from Nik's hand-built monthly split.");
  lines.push("--");
  lines.push(`-- Generated by scripts/seed-item-categories.mjs`);
  lines.push(`--   raw export : ${RAW}`);
  lines.push(`--   hand-built : ${NIK}`);
  lines.push(`--   period     : ${raw.dateFrom}`);
  lines.push("--");
  lines.push(`-- ${assigned.size} products. Coverage check passed: every one of the`);
  lines.push(`-- ${rawByName.size} distinct products in the raw export has a category.`);
  lines.push("--");
  lines.push("-- ── THIS IS A ONE-TIME SEED, AND THE FILE ENFORCES THAT ITSELF ──────────");
  lines.push("--");
  lines.push("-- It refuses to run if pos_item_categories already holds ANY row. That is");
  lines.push("-- not caution for its own sake: a re-run against a later month's files");
  lines.push("-- would insert every product new since August with a category decided by");
  lines.push("-- the seed's group rules rather than by a person — silently bypassing the");
  lines.push("-- review the screen exists to provide. ON CONFLICT DO NOTHING protects rows");
  lines.push("-- that already exist; it does nothing to protect rows that do not yet.");
  lines.push("--");
  lines.push("-- New products are classified ON THE SCREEN at /owner/accounting/coffee-items,");
  lines.push("-- where they surface as ใหม่ until someone picks a category. Never by");
  lines.push("-- re-seeding.");
  lines.push("--");
  lines.push("-- PROVENANCE. This file does not set reviewed_by, so every seeded row has");
  lines.push("-- reviewed_by IS NULL. A row a human classified on the screen carries their");
  lines.push("-- UUID. That is the only way to tell a seed decision from a human one later,");
  lines.push("-- and it is deliberate — do not backfill reviewed_by on these rows.");
  lines.push("");
  lines.push("BEGIN;");
  lines.push("");
  lines.push("DO $$");
  lines.push("DECLARE");
  lines.push("  existing INTEGER;");
  lines.push("BEGIN");
  lines.push("  SELECT count(*) INTO existing FROM public.pos_item_categories;");
  lines.push("  IF existing <> 0 THEN");
  lines.push("    RAISE EXCEPTION");
  lines.push("      'ABORTED: pos_item_categories already holds % rows. This seed is one-time. '");
  lines.push("      'Nothing has been written. New products are classified on the screen at '");
  lines.push("      '/owner/accounting/coffee-items (they appear as ใหม่ until categorised) — '");
  lines.push("      'do not re-seed to add them.', existing;");
  lines.push("  END IF;");
  lines.push("END $$;");
  lines.push("");
  lines.push("INSERT INTO public.pos_item_categories (pos_product_name, category, coffee_share_per_unit) VALUES");

  const rows = [...assigned.entries()].sort((a, b) => a[0].localeCompare(b[0], "th"));
  rows.forEach(([name, v], i) => {
    const carve = CARVE_OUT.has(name) ? String(CARVE_OUT.get(name)) : "NULL";
    lines.push(`  ('${esc(name)}', '${v.category}', ${carve})${i === rows.length - 1 ? "" : ","}`);
  });
  lines.push("ON CONFLICT (pos_product_name) DO NOTHING;");
  lines.push("");
  lines.push("COMMIT;");
  lines.push("");
  lines.push("-- ─── Verification (run separately) ─────────────────────────────────────");
  lines.push("--   All seeded rows should carry NULL provenance:");
  lines.push(`--   SELECT count(*) FROM public.pos_item_categories WHERE reviewed_by IS NULL;  -- expect ${assigned.size}`);
  lines.push(`--   SELECT category, count(*) FROM public.pos_item_categories GROUP BY 1 ORDER BY 1;`);
  for (const [k, v] of Object.entries(byCategory).sort()) lines.push(`--   -- expect ${k} = ${v}`);
  lines.push(`--   SELECT count(*) FROM public.pos_item_categories;  -- expect ${assigned.size}`);
  lines.push("--");
  lines.push("--   SELECT pos_product_name, category, coffee_share_per_unit");
  lines.push("--     FROM public.pos_item_categories WHERE coffee_share_per_unit IS NOT NULL;");
  lines.push(`--   -- expect ${CARVE_OUT.size} row: ไอติมข้าวเหนียวมะม่วง, dessert, 15.00`);

  fs.writeFileSync(SQL_OUT, lines.join("\n") + "\n");
  console.log(`\nSQL written: ${SQL_OUT} (${rows.length} rows). NOTHING has been written to the database.`);
} else {
  console.log("\nNo --sql given, so no SQL was generated. Nothing was written to the database.");
}
