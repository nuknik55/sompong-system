// Gate for the one duplicated formula in the prep-visibility work.
//
//   node scripts/verify-prep-unit-costs.mjs              # print what to run + the expectation
//   node scripts/verify-prep-unit-costs.mjs --from f.json # compare the function's real output
//
// WHY THIS EXISTS. public.prep_unit_costs() computes each prep recipe's cost
// per usage unit in SQL, so that a dish cost stays correct for someone who
// cannot see the prep's composition (RLS hides prep_recipe_items from them).
// resolveUnitCosts() in src/lib/costing.ts no longer computes prep nesting at
// all — it takes this function's answer — which means the nesting rule lives
// in exactly one place.
//
// WHAT IS STILL DUPLICATED, and therefore what this gate pins: rawUnitCost,
// five lines of money arithmetic that exist in BOTH languages because the SQL
// function needs raw ingredient costs to sum a prep, and TypeScript needs them
// for every non-prep ingredient. Nothing automatic can catch those two
// drifting apart. This can, and only when a person runs it.
//
// HOW IT COMPARES, now that TypeScript no longer has a prep implementation to
// compare against: it imports the REAL rawUnitCost from src/lib/costing.ts —
// the shipped function, not a retyped copy — and walks the prep nesting here,
// in this file, transcribed from the CTE in
// supabase/prep_recipe_access_migration.sql. That transcription is test code
// and is deliberately a second implementation: a differential test needs two
// sides, and the side that matters (rawUnitCost) is imported rather than
// rewritten.
//
// A NOTE ON THE 2026-09-15 BREAKAGE, because it is the reason this header is
// this long: the script previously called resolveUnitCosts(ingredients,
// prepRecipes, prepItems). That signature changed in e34a530 and the script
// was not updated. scripts/*.mjs is outside tsc, eslint and npm test, so four
// consecutive green gates said nothing about it, and it was only discovered
// when someone ran it. A gate that no automated check covers must be RUN to
// be known good — which is the whole point of its entry in supabase/README.md
// under "Gates a person runs".
//
// WHY IT CANNOT RUN UNATTENDED, and this is a property rather than a
// shortcoming: prep_unit_costs() returns zero rows unless current_role() is
// one of owner/admin/editor/staff. That guard is what keeps a sales session
// from reading cost. Both keys on a developer machine carry no `sub` claim,
// so auth.uid() is NULL and the function correctly refuses them. Measured,
// not assumed — service_role 200/0 rows, anon 200/0 rows, and a deliberately
// bogus function name 404, so the zeroes are the guard rather than a missing
// function. Reaching it from here would mean giving it a parameter or
// weakening the guard, and both destroy the property it exists for.
//
// Read-only throughout. Never prints a key.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const { rawUnitCost } = await import(pathToFileURL(path.join(APP, "src/lib/costing.ts")).href);

const envPath = path.join(APP, ".env.local");
if (!fs.existsSync(envPath)) { console.error("ABORT: .env.local not found at " + envPath); process.exit(2); }
const env = Object.fromEntries(
  fs.readFileSync(envPath, "utf8").split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }),
);
const U = env.NEXT_PUBLIC_SUPABASE_URL, K = env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) { console.error("ABORT: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing"); process.exit(2); }
const H = { apikey: K, Authorization: `Bearer ${K}` };

async function get(p) {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H });
  if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// The service-role key bypasses RLS, so these reads stay complete after the
// step-2 policies narrowed what a normal session may see. That is required:
// the expectation has to cover all 48, including recipes nobody holds.
const ingredients = await get("ingredients?select=id,name,is_prep,purchase_cost,receive_qty,yield_qty,prep_recipe_id&limit=5000");
const prepRecipes = await get("prep_recipes?select=id,name,batch_yield_qty&limit=5000");
const prepItems   = await get("prep_recipe_items?select=id,prep_recipe_id,ingredient_id,quantity&limit=5000");

// ── the expectation: shipped rawUnitCost + the CTE's nesting, transcribed ──
const DEPTH_CAP = 10;
const ingById = new Map(ingredients.map((i) => [i.id, i]));
const prepById = new Map(prepRecipes.map((p) => [p.id, p]));
const itemsByPrep = new Map();
for (const it of prepItems) {
  if (!itemsByPrep.has(it.prep_recipe_id)) itemsByPrep.set(it.prep_recipe_id, []);
  itemsByPrep.get(it.prep_recipe_id).push(it);
}

const rawCost = new Map();
for (const i of ingredients) if (!i.is_prep) rawCost.set(i.id, rawUnitCost(i));

// expanded: one row per (prep, component) at every depth, carrying a multiplier
const expanded = [];
for (const p of prepRecipes) {
  const items = itemsByPrep.get(p.id) ?? [];
  const B = Number(p.batch_yield_qty);
  if (items.length === 0) expanded.push({ root: p.id, ing: null, factor: null, depth: 1 });
  else for (const it of items) {
    expanded.push({ root: p.id, ing: it.ingredient_id, factor: B > 0 ? Number(it.quantity) / B : null, depth: 1 });
  }
}
for (let idx = 0; idx < expanded.length; idx++) {
  const e = expanded[idx];
  if (e.depth >= DEPTH_CAP) continue;
  const ing = e.ing ? ingById.get(e.ing) : null;
  if (!ing || !ing.is_prep) continue;
  const p2 = ing.prep_recipe_id ? prepById.get(ing.prep_recipe_id) : null;
  if (!p2) continue;
  const items = itemsByPrep.get(p2.id) ?? [];
  const B2 = Number(p2.batch_yield_qty);
  if (items.length === 0) expanded.push({ root: e.root, ing: null, factor: null, depth: e.depth + 1 });
  else for (const it of items) {
    const f = B2 > 0 && e.factor !== null ? e.factor * (Number(it.quantity) / B2) : null;
    expanded.push({ root: e.root, ing: it.ingredient_id, factor: f, depth: e.depth + 1 });
  }
}

const agg = new Map(prepRecipes.map((p) => [p.id, { anyNull: false, sum: 0, rows: 0 }]));
for (const e of expanded) {
  const a = agg.get(e.root);
  const ing = e.ing ? ingById.get(e.ing) : null;
  let contribution;
  if (e.ing === null) contribution = null;                                             // prep with no items
  else if (ing && ing.is_prep && ing.prep_recipe_id && e.depth < DEPTH_CAP) contribution = 0; // internal node
  else if (ing && ing.is_prep) contribution = null;                                    // orphan prep / depth cap
  else {
    const rc = rawCost.has(e.ing) ? rawCost.get(e.ing) : null;
    contribution = e.factor === null || rc === null ? null : e.factor * rc;
  }
  a.rows++;
  if (contribution === null) a.anyNull = true; else a.sum += contribution;
}

/** prep_recipe_id -> cost|null, as the TypeScript side computes it. */
const expected = new Map();
for (const [id, a] of agg) expected.set(id, a.rows === 0 || a.anyNull ? null : a.sum);
const nameById = new Map(prepRecipes.map((p) => [p.id, p.name]));
const priced = [...expected.values()].filter((v) => v !== null).length;

// ── what this side can check from here (no user session) ──────────────────
async function rpcRowCount(key) {
  const r = await fetch(`${U}/rest/v1/rpc/prep_unit_costs`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}",
  });
  const t = await r.text();
  try { const j = JSON.parse(t); return { status: r.status, rows: Array.isArray(j) ? j.length : "n/a" }; }
  catch { return { status: r.status, rows: "n/a" }; }
}

const fromArg = process.argv.indexOf("--from");
const fromFile = fromArg >= 0 ? process.argv[fromArg + 1] : null;

if (!fromFile) {
  const sr = await rpcRowCount(K);
  const an = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? await rpcRowCount(env.NEXT_PUBLIC_SUPABASE_ANON_KEY) : null;
  const grants = await get("prep_recipe_access?select=prep_recipe_id&limit=5000");

  console.log("── what this script can check from here ──────────────────────────");
  console.log(`prep recipes live            : ${prepRecipes.length}`);
  console.log(`  TypeScript says priced     : ${priced}`);
  console.log(`  TypeScript says unknown    : ${prepRecipes.length - priced}`);
  console.log(`prep_recipe_access rows      : ${grants.length}`);
  console.log(`rpc as service_role          : HTTP ${sr.status}, rows=${sr.rows}  (expected 0 — no sub claim, guard holds)`);
  if (an) console.log(`rpc as anon                  : HTTP ${an.status}, rows=${an.rows}  (expected 0 — an unauthenticated caller must never read cost)`);
  console.log("\nunknown-cost preps, by name (these must match on both sides):");
  for (const [id, v] of expected) if (v === null) console.log(`   ${nameById.get(id)}`);
  console.log("");
  console.log("── what it CANNOT check from here ───────────────────────────────");
  console.log("The function's actual numbers. Run the block below in the SQL");
  console.log("editor, save the single JSON cell to a file, then re-run with");
  console.log("--from <file>. The comparison is then exact, all " + prepRecipes.length + ".");
  console.log("");
  console.log("-- impersonates an admin; rolls back; returns ONE json cell");
  console.log("BEGIN;");
  console.log("  SELECT set_config('role', 'authenticated', true);");
  console.log("  SELECT set_config('request.jwt.claims',");
  console.log("    json_build_object('sub', (SELECT id::text FROM public.profiles");
  console.log("                               WHERE role = 'admin' ORDER BY full_name LIMIT 1))::text, true);");
  console.log("  SELECT json_agg(json_build_array(prep_recipe_id, unit_cost) ORDER BY prep_recipe_id)");
  console.log("    FROM public.prep_unit_costs();");
  console.log("ROLLBACK;");
  console.log("");
  console.log(`Expected shape: ${prepRecipes.length} entries, ${priced} with a number, ${prepRecipes.length - priced} null.`);
  process.exit(0);
}

// ── --from: compare the function's real output, prep by prep ──────────────
const raw = JSON.parse(fs.readFileSync(fromFile, "utf8"));
const rows = Array.isArray(raw) ? raw : raw.json_agg ?? raw.rows ?? null;
if (!Array.isArray(rows)) { console.error("ABORT: expected a JSON array of [prep_recipe_id, unit_cost] pairs"); process.exit(2); }

const actual = new Map(rows.map((r) => {
  const id = Array.isArray(r) ? r[0] : r.prep_recipe_id;
  const v = Array.isArray(r) ? r[1] : r.unit_cost;
  return [id, v === null ? null : Number(v)];
}));

const TOL = 1e-9;
let agree = 0, bothNull = 0, exact = 0;
const problems = [];
for (const p of prepRecipes) {
  const want = expected.get(p.id);
  if (!actual.has(p.id)) { problems.push(`${p.name}: MISSING from the function's output`); continue; }
  const got = actual.get(p.id);
  if (want === null && got === null) { agree++; bothNull++; continue; }
  if (want === null || got === null) { problems.push(`${p.name}: ts=${want} sql=${got} (one side null)`); continue; }
  const rel = Math.abs(want - got) / Math.max(Math.abs(want), Math.abs(got), 1e-30);
  if (rel <= TOL) { agree++; if (rel === 0) exact++; }
  else problems.push(`${p.name}: ts=${want} sql=${got} (rel diff ${rel.toExponential(3)})`);
}
for (const id of actual.keys()) {
  if (!nameById.has(id)) problems.push(`${id}: function returned a prep that does not exist in prep_recipes`);
}

console.log(`compared : ${prepRecipes.length} preps against the deployed function`);
console.log(`agree    : ${agree}  (both-null: ${bothNull}, numeric: ${agree - bothNull}, of which bit-for-bit: ${exact})`);
console.log(`PROBLEMS : ${problems.length}`);
for (const p of problems) console.log("   " + p);
if (problems.length === 0) console.log("\nThe SQL cost channel and the TypeScript arithmetic agree on every prep.");
process.exit(problems.length === 0 ? 0 : 1);
