// Gate for the one duplicated formula in the prep-visibility work.
//
//   node scripts/verify-prep-unit-costs.mjs              # print what to run + the expectation
//   node scripts/verify-prep-unit-costs.mjs --from f.json # compare the function's real output
//
// WHY THIS EXISTS. public.prep_unit_costs() re-implements the prep nesting
// rule in SQL so that a dish cost stays correct for someone who cannot see the
// prep's composition. resolveUnitCosts() in src/lib/costing.ts keeps the raw
// side. rawUnitCost's five lines of money arithmetic therefore exist in both
// languages, and nothing automatic can catch them drifting apart. This does —
// and only when a person runs it. See supabase/README.md, "Gates a person
// runs". Run it after the migration, and after ANY change to either side.
//
// WHY IT CANNOT RUN UNATTENDED, and this is not a shortcoming to fix:
// prep_unit_costs() returns zero rows unless public.current_role() is one of
// owner/admin/editor/staff. That guard is what keeps a sales session from
// reading cost. Both keys this machine has — service_role and anon — carry no
// `sub` claim, so auth.uid() is NULL, current_role() is NULL, and the function
// correctly returns nothing to either. Measured, not assumed:
//
//     service_role  HTTP 200  rows=0
//     anon          HTTP 200  rows=0
//     bogus name    HTTP 404  (so the 200s above are the guard, not a
//                              missing function)
//
// Making the function reachable from here would mean giving it a parameter or
// weakening the guard, and both destroy the property the function exists for.
// So the function's own output has to come from a real session: someone runs
// the impersonation block this script prints, pastes the one JSON cell into a
// file, and runs --from. That is the whole manual step.
//
// Read-only throughout. Never prints a key.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const APP = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const { resolveUnitCosts } = await import(pathToFileURL(path.join(APP, "src/lib/costing.ts")).href);

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

// ── the TS side, from the REAL shipped resolver over live rows ─────────────
const ingredients = await get("ingredients?select=id,name,category,is_prep,purchase_cost,receive_qty,yield_qty,usage_unit,prep_recipe_id&limit=5000");
const prepRecipes = await get("prep_recipes?select=id,name,category,batch_yield_qty,batch_yield_unit&limit=5000");
const prepItems   = await get("prep_recipe_items?select=id,prep_recipe_id,ingredient_id,quantity&limit=5000");

const tsCosts = resolveUnitCosts(ingredients, prepRecipes, prepItems);
const ingIdByRecipe = new Map(
  ingredients.filter((i) => i.is_prep && i.prep_recipe_id).map((i) => [i.prep_recipe_id, i.id]),
);
const nameById = new Map(prepRecipes.map((p) => [p.id, p.name]));

/** prep_recipe_id -> cost|null, as the shipped TypeScript computes it. */
const expected = new Map();
for (const p of prepRecipes) {
  const ingId = ingIdByRecipe.get(p.id);
  expected.set(p.id, ingId ? (tsCosts.get(ingId) ?? null) : null);
}
const priced = [...expected.values()].filter((v) => v !== null).length;

// ── what the deployed side looks like from here (no user session) ─────────
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
  const grants = await get("prep_recipe_access?select=prep_recipe_id&limit=1000");

  console.log("── what this script can check from here ──────────────────────────");
  console.log(`prep recipes live            : ${prepRecipes.length}`);
  console.log(`  TS says priced             : ${priced}`);
  console.log(`  TS says unknown (null)     : ${prepRecipes.length - priced}`);
  console.log(`prep_recipe_access rows      : ${grants.length}  ${grants.length === 0 ? "(closed by default, nothing backfilled)" : "(GRANTS EXIST)"}`);
  console.log(`rpc as service_role          : HTTP ${sr.status}, rows=${sr.rows}  (expected 0 — no sub claim, guard holds)`);
  if (an) console.log(`rpc as anon                  : HTTP ${an.status}, rows=${an.rows}  (expected 0 — an unauthenticated caller must never read cost)`);
  console.log("");
  console.log("── what it CANNOT check from here ───────────────────────────────");
  console.log("The function's actual numbers, and the sales-session-zero case.");
  console.log("Both need a real user session. Run the block below in the SQL");
  console.log("editor, save the single JSON cell to a file, then re-run with");
  console.log("--from <file>. The comparison is then exact, all 48.");
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
  console.log(`Expected shape when it runs: ${prepRecipes.length} entries, ${priced} with a number, ${prepRecipes.length - priced} null.`);
  process.exit(0);
}

// ── --from: compare the function's real output, prep by prep ──────────────
const raw = JSON.parse(fs.readFileSync(fromFile, "utf8"));
const rows = Array.isArray(raw) ? raw : raw.json_agg ?? raw.rows ?? null;
if (!Array.isArray(rows)) { console.error("ABORT: expected a JSON array of [prep_recipe_id, unit_cost] pairs"); process.exit(2); }

const actual = new Map(rows.map((r) => [Array.isArray(r) ? r[0] : r.prep_recipe_id,
                                        (Array.isArray(r) ? r[1] : r.unit_cost) === null ? null : Number(Array.isArray(r) ? r[1] : r.unit_cost)]));

const TOL = 1e-9;
let agree = 0, bothNull = 0;
const problems = [];
for (const p of prepRecipes) {
  const want = expected.get(p.id);
  if (!actual.has(p.id)) { problems.push(`${p.name}: MISSING from the function's output`); continue; }
  const got = actual.get(p.id);
  if (want === null && got === null) { agree++; bothNull++; continue; }
  if (want === null || got === null) { problems.push(`${p.name}: ts=${want} sql=${got} (one side null)`); continue; }
  const rel = Math.abs(want - got) / Math.max(Math.abs(want), Math.abs(got), 1e-30);
  if (rel <= TOL) agree++;
  else problems.push(`${p.name}: ts=${want} sql=${got} (rel diff ${rel.toExponential(3)})`);
}
for (const id of actual.keys()) {
  if (!nameById.has(id)) problems.push(`${id}: function returned a prep that does not exist in prep_recipes`);
}

console.log(`compared : ${prepRecipes.length} preps against the deployed function`);
console.log(`agree    : ${agree}  (both-null: ${bothNull}, numeric: ${agree - bothNull})`);
console.log(`PROBLEMS : ${problems.length}`);
for (const p of problems) console.log("   " + p);
if (problems.length === 0) console.log("\nThe SQL cost channel and the TypeScript resolver agree on every prep.");
process.exit(problems.length === 0 ? 0 : 1);
