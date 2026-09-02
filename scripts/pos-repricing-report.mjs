// Step 2 of the (b)+(c) design: model the proposed dominant-vendor pricing rule
// against every material and report what it WOULD do.
//
//   node scripts/pos-repricing-report.mjs [--out FILE] [--window 90]
//
// READ-ONLY BY CONSTRUCTION. It issues GETs only and writes a Markdown file.
// No proposed price is written to the database, to an ingredient, or anywhere
// else — this is a report for a human to read and challenge before any of it
// is wired into the import path.

import fs from "node:fs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const OUT = arg("--out", "POS_REPRICING_REPORT.md");
const WINDOW_DAYS = Number(arg("--window", "90"));
const JSON_OUT = arg("--json", null);

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

/** Non-food POS materials that must never be priced as ingredients. */
const NON_FOOD_MATERIALS = new Set(["ค่าขนส่งวัตถุดิบ", "วัตถุดิบอื่นๆ", "วัตถุดิบทดลอง", "กลุ่มอื่นๆ"]);
/** Top-two vendors within this fraction of each other -> dominance is unsettled. */
const VENDOR_AMBIGUITY = 0.10;
/** Adjacent unit costs differing by this factor or more are separate clusters. */
const GAP_FACTOR = 2;
const MIN_POOL = 3;

async function page(path) {
  let out = [], from = 0;
  for (;;) {
    const r = await fetch(`${U}/rest/v1/${path}`, { headers: { ...H, Range: `${from}-${from + 999}` } });
    const b = await r.json();
    if (!Array.isArray(b)) throw new Error(JSON.stringify(b));
    out = out.concat(b);
    if (b.length < 1000) return out;
    from += 1000;
  }
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

/** Split sorted-by-cost rows at any >=GAP_FACTOR jump; keep the cluster holding the most recent delivery. */
function gapFilter(rows) {
  if (rows.length < 2) return { kept: rows, dropped: 0 };
  const sorted = [...rows].sort((a, b) => a.unitCost - b.unitCost);
  const clusters = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].unitCost, cur = sorted[i].unitCost;
    if (prev > 0 && cur / prev >= GAP_FACTOR) clusters.push([sorted[i]]);
    else clusters[clusters.length - 1].push(sorted[i]);
  }
  if (clusters.length === 1) return { kept: rows, dropped: 0 };
  // Keep the LARGEST cluster, not the one holding the newest delivery.
  // "Newest" inverts when the newest delivery IS the outlier: ข้าวคั่ว has
  // 25/25/25/50 and the 50 is the most recent, so newest-wins discarded the
  // stable majority and priced from the single outlier. Largest-wins gets
  // both cases right, and it is the correct property for a median rule —
  // a genuine step change should move the price only once it is the norm.
  const bySize = [...clusters].sort((a, b) => b.length - a.length);
  const newest = rows.reduce((m, r) => (r.document_date > m.document_date ? r : m), rows[0]);
  const keep = bySize[0].length === (bySize[1]?.length ?? -1)
    ? (clusters.find((c) => c.includes(newest)) ?? bySize[0])
    : bySize[0];
  return { kept: keep, dropped: rows.length - keep.length };
}

// ── load ────────────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const winStart = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);

const deliveries = await page(`pos_receipt_deliveries?select=material_code,material_name,document_date,document_number,vendor_name,unit_name,qty,total_cost_inc_vat&document_date=gte.${winStart}&order=material_code,document_date`);
const ingredients = await page("ingredients?select=id,name,purchase_cost,purchase_unit_label&is_prep=eq.false");
const aliases = await page("pos_price_aliases?select=pos_ingredient_name,ingredient_id");

const byName = new Map(ingredients.map((i) => [i.name.trim(), i]));
const byId = new Map(ingredients.map((i) => [i.id, i]));
const aliasMap = new Map();
for (const a of aliases) {
  const k = a.pos_ingredient_name.trim();
  aliasMap.set(k, (aliasMap.get(k) ?? []).concat(a.ingredient_id));
}

// ── group by material ───────────────────────────────────────────────────────
const mats = new Map();
for (const d of deliveries) {
  const qty = Number(d.qty), cost = Number(d.total_cost_inc_vat);
  if (!(qty > 0)) continue;
  let e = mats.get(d.material_code);
  if (!e) { e = { code: d.material_code, name: d.material_name, rows: [] }; mats.set(d.material_code, e); }
  e.rows.push({ ...d, qty, cost, unitCost: cost / qty });
}

// ── the rule ────────────────────────────────────────────────────────────────
function priceFor(rows) {
  const vendorCounts = new Map();
  for (const r of rows) vendorCounts.set(r.vendor_name, (vendorCounts.get(r.vendor_name) ?? 0) + 1);
  const ranked = [...vendorCounts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    // Tiebreak: most recent delivery wins — "who we buy from now".
    const newest = (v) => rows.filter((r) => r.vendor_name === v).reduce((m, r) => (r.document_date > m ? r.document_date : m), "");
    return newest(b[0]).localeCompare(newest(a[0]));
  });
  const [domVendor, domCount] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  const tied = domCount === runnerUp;
  const unsettled = runnerUp > 0 && (domCount - runnerUp) / domCount <= VENDOR_AMBIGUITY;

  const domUnitOf = (rs) => {
    const u = new Map();
    for (const r of rs) u.set(r.unit_name, (u.get(r.unit_name) ?? 0) + 1);
    return [...u.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const vRows = rows.filter((r) => r.vendor_name === domVendor);
  const vUnit = domUnitOf(vRows);
  const unitsInVendor = new Set(vRows.map((r) => r.unit_name)).size;

  // The gap filter runs BEFORE each min-pool test on purpose. Applying it after
  // let a pool of 4 pass the guard and then be cut to 1 by the filter, so the
  // "median" was a single delivery — which is what the guard exists to prevent.
  const tryPool = (candidate, rule) => {
    if (candidate.length < MIN_POOL) return null;
    const { kept, dropped } = gapFilter(candidate);
    if (kept.length < MIN_POOL) return null;
    return { price: median(kept.map((r) => r.unitCost)), rule, poolSize: kept.length, dropped, poolUnit: candidate[0].unit_name };
  };

  const base = { domVendor, domCount, total: rows.length, tied, unsettled, unitsInVendor };

  // Step 1 — dominant vendor + its dominant unit
  const s1 = tryPool(vRows.filter((r) => r.unit_name === vUnit), "dominant-vendor");
  if (s1) return { ...base, ...s1 };

  // Step 2 — all vendors, dominant unit overall
  const aUnit = domUnitOf(rows);
  const s2 = tryPool(rows.filter((r) => r.unit_name === aUnit), "all-vendor");
  if (s2) return { ...base, ...s2 };

  // Step 3 — latest delivery (the current production rule)
  const maxD = rows.reduce((m, r) => (r.document_date > m ? r.document_date : m), "");
  const latest = rows.filter((r) => r.document_date === maxD);
  const q = latest.reduce((s, r) => s + r.qty, 0), c = latest.reduce((s, r) => s + r.cost, 0);
  return { ...base, price: q > 0 ? c / q : null, rule: "latest-delivery", poolSize: latest.length, dropped: 0, poolUnit: latest[0]?.unit_name ?? "" };
}

// ── evaluate ────────────────────────────────────────────────────────────────
const results = [], skippedNonFood = [], unmatched = [];
for (const m of mats.values()) {
  if (NON_FOOD_MATERIALS.has(m.name.trim())) { skippedNonFood.push({ name: m.name, n: m.rows.length }); continue; }
  const targets = [];
  const direct = byName.get(m.name.trim());
  if (direct) targets.push(direct);
  for (const id of aliasMap.get(m.name.trim()) ?? []) { const g = byId.get(id); if (g && !targets.includes(g)) targets.push(g); }
  if (targets.length === 0) { unmatched.push({ name: m.name, n: m.rows.length }); continue; }

  const p = priceFor(m.rows);
  if (p.price == null) continue;
  for (const ing of targets) {
    const cur = ing.purchase_cost == null ? null : Number(ing.purchase_cost);
    // The stored price is denominated in purchase_unit_label. If the POS pool's
    // unit differs, "current" and "proposed" are not the same measure and the %
    // change is meaningless — the live importer already blocks this case.
    const rawUnit = ing.purchase_unit_label?.trim() || null;
    const oldUnit = rawUnit === "-" ? null : rawUnit;
    const unitState = !oldUnit ? "unset" : oldUnit === (p.poolUnit ?? "").trim() ? "match" : "changed";
    const comparable = unitState === "match" || unitState === "unset";
    const pct = comparable && cur != null && cur > 0 ? ((p.price - cur) / cur) * 100 : null;
    results.push({ name: ing.name, posName: m.name, cur, proposed: p.price, pct, oldUnit, unitState, ...p });
  }
}
results.sort((a, b) => {
  if ((a.pct == null) !== (b.pct == null)) return a.pct == null ? 1 : -1;
  return Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0);
});

// ── write ───────────────────────────────────────────────────────────────────
const RULE_TH = { "dominant-vendor": "ราคากลาง (ผู้ขายหลัก)", "all-vendor": "ราคากลาง (ทุกผู้ขาย)", "latest-delivery": "ล่าสุด (ข้อมูลน้อย)" };
const n2 = (x) => (x == null ? "—" : x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const big = results.filter((r) => r.pct != null && Math.abs(r.pct) > 20);
const byRule = (k) => results.filter((r) => r.rule === k).length;

const L = [];
L.push("# POS repricing — proposed vs current, all materials");
L.push("");
L.push("**Nothing here has been written anywhere.** This models the proposed");
L.push("dominant-vendor rule and reports what it *would* do, for review before any");
L.push("code touches the import path.");
L.push("");
L.push(`Generated ${today} · window ${WINDOW_DAYS} days (${winStart} → ${today}) · ${deliveries.length} deliveries · ${mats.size} POS materials`);
L.push("");
L.push("| | count |");
L.push("|---|---|");
L.push(`| ingredients priced by the rule | **${results.length}** |`);
L.push(`| **moving more than ±20%** | **${big.length}** |`);
L.push(`| moving more than ±50% | ${results.filter((r) => r.pct != null && Math.abs(r.pct) > 50).length} |`);
L.push(`| no current price (would be set for the first time) | ${results.filter((r) => r.cur == null).length} |`);
L.push(`| **unit MISMATCH — % change not meaningful** | **${results.filter((r) => r.unitState === "changed").length}** |`);
L.push(`| unit not recorded on the ingredient | ${results.filter((r) => r.unitState === "unset").length} |`);
L.push(`| priced by dominant-vendor median | ${byRule("dominant-vendor")} |`);
L.push(`| fell back to all-vendor median | ${byRule("all-vendor")} |`);
L.push(`| fell back to latest delivery (thin data) | ${byRule("latest-delivery")} |`);
L.push(`| dominant vendor **unsettled** (top two within ${VENDOR_AMBIGUITY * 100}%) | ${results.filter((r) => r.unsettled).length} |`);
L.push(`| outlier deliveries dropped by the ${GAP_FACTOR}× gap filter | ${results.reduce((s, r) => s + r.dropped, 0)} |`);
L.push(`| non-food materials excluded | ${skippedNonFood.length} |`);
L.push(`| POS materials with no ingredient row (unmatched) | ${unmatched.length} |`);
L.push("");
L.push("## Every priced ingredient, biggest move first");
L.push("");
L.push("`⚠` = dominant vendor unsettled · `≈` = vendors exactly tied · `↯` = outliers dropped · `units` = dominant vendor sells in more than one unit");
L.push("");
L.push("**หน่วยไม่ตรง** means the stored price and the POS price are in DIFFERENT units, so the two numbers are not comparable and no % is shown. The live importer already blocks these rows until the unit and yield are corrected together — they are not price changes.");
L.push("");
L.push("`?unit` means the ingredient has NO stored unit, so the POS unit is adopted. The % is shown because the stored price is almost certainly already in that unit — but it is unverified, so treat those percentages as indicative.");
L.push("");
L.push("| # | ingredient | current | unit (stored) | proposed | unit (POS) | change | rule | vendor | share | pool | flags |");
L.push("|---:|---|---:|---|---:|---|---:|---|---|---:|---:|---|");
results.forEach((r, i) => {
  const flags = [r.unsettled ? "⚠" : "", r.tied ? "≈" : "", r.dropped ? `↯${r.dropped}` : "", r.unitsInVendor > 1 ? "units" : "", r.unitState === "unset" ? "?unit" : ""].filter(Boolean).join(" ");
  const pct = r.pct != null ? `${r.pct >= 0 ? "+" : ""}${r.pct.toFixed(0)}%`
    : r.unitState === "changed" ? "**หน่วยไม่ตรง**" : r.cur == null ? "**ใหม่**" : "—";
  L.push(`| ${i + 1} | ${r.name} | ${n2(r.cur)} | ${r.oldUnit ?? "*(none)*"} | ${n2(r.proposed)} | ${r.poolUnit || "—"} | ${pct} | ${RULE_TH[r.rule]} | ${r.domVendor || "*(blank)*"} | ${((r.domCount / r.total) * 100).toFixed(0)}% | ${r.poolSize} | ${flags} |`);
});
L.push("");
L.push("## Excluded as non-food");
L.push("");
L.push("| material | deliveries in window |");
L.push("|---|---:|");
for (const s of skippedNonFood) L.push(`| ${s.name} | ${s.n} |`);
L.push("");
L.push(`## POS materials with no matching ingredient (${unmatched.length})`);
L.push("");
L.push("These are reported in the preview's *unmatched* list and are never priced.");
L.push("");
L.push("| material | deliveries in window |");
L.push("|---|---:|");
for (const s of unmatched.sort((a, b) => b.n - a.n)) L.push(`| ${s.name} | ${s.n} |`);
L.push("");

fs.writeFileSync(OUT, L.join("\n"));
// Sidecar for threshold analysis; not part of the human-readable deliverable.
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
console.log(`wrote ${OUT}`);
console.log(`  priced ${results.length} ingredients; ${big.length} move >20%`);
console.log(`  rules: dominant ${byRule("dominant-vendor")}, all-vendor ${byRule("all-vendor")}, latest ${byRule("latest-delivery")}`);
console.log(`  unsettled ${results.filter((r) => r.unsettled).length}, outliers dropped ${results.reduce((s, r) => s + r.dropped, 0)}`);
console.log(`  non-food excluded ${skippedNonFood.length}, unmatched ${unmatched.length}`);
