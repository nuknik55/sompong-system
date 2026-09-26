/**
 * Run with: npm test — who sees cost (Nik, 2026-09-26), and the screens and
 * actions that follow it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COST_FIELDS, seesCost, withoutCostFields } from "./cost-access.ts";

test("owner and admin always see cost; an editor only with the switch on; nobody else", () => {
  assert.equal(seesCost({ role: "owner" }), true);
  assert.equal(seesCost({ role: "admin", sees_cost: false }), true, "the switch is for editors; admin is never switched off");
  assert.equal(seesCost({ role: "editor", sees_cost: true }), true);
  assert.equal(seesCost({ role: "editor", sees_cost: false }), false);
  assert.equal(seesCost({ role: "editor" }), false, "off by default");
  for (const role of ["staff", "hr", "sales"]) assert.equal(seesCost({ role, sees_cost: true }), false, role + " never, even with a stray switch");
  assert.equal(seesCost(null), false);
  assert.equal(seesCost({ role: undefined }), false);
  assert.equal(seesCost({ role: "someday-a-new-role", sees_cost: true }), false, "an allowlist: a role added later sees nothing");
});

test("an ingredient write from someone who may not see cost carries no cost field", () => {
  const fields = { name: "กุ้ง", category: "ทะเล", purchase_cost: null, receive_qty: 1, yield_qty: null, usage_unit: "กรัม" };
  assert.deepEqual(withoutCostFields(fields), { name: "กุ้ง", category: "ทะเล", usage_unit: "กรัม" });
  assert.deepEqual([...COST_FIELDS].sort(), ["purchase_cost", "receive_qty", "yield_qty"]);
});

// The wiring, read from the shipped files (comments stripped).
const code = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("every screen that shows cost asks seesCost, not the role", () => {
  for (const f of ["../app/staff/page.tsx", "../app/staff/menu/[id]/page.tsx", "../app/staff/prep/[id]/page.tsx", "../app/owner/ingredients/page.tsx"]) {
    assert.match(code(f), /seesCost\(profile\)/, f);
  }
  assert.doesNotMatch(code("../app/staff/page.tsx"), /seesMargin = editAccess/, "the Star-to-Dog sort is margin");
});

test("the ingredient actions drop cost fields and the price history for someone who may not see cost", () => {
  const src = code("../app/owner/ingredients/actions.ts");
  for (const fn of ["updateIngredient", "createIngredient"]) {
    const start = src.indexOf(`export async function ${fn}(`);
    const body = src.slice(start, src.indexOf("\nexport async function ", start + 10));
    assert.match(body, /seesCost\(profile\) \? input : withoutCostFields\(input\)/, fn);
    assert.ok(body.indexOf("withoutCostFields(input)") < body.indexOf("savePendingChange"), fn + ": before the request is filed");
  }
  const start = src.indexOf("export async function getIngredientHistory(");
  const hist = src.slice(start);
  assert.ok(hist.indexOf("if (!seesCost(profile)) return [];") >= 0 && hist.indexOf("if (!seesCost(profile)) return [];") < hist.indexOf('from("ingredient_price_history")'), "before it reads");
});

test("the recipe editor hides every cost figure when told to, in edit mode too", () => {
  const src = code("../components/recipe-editor.tsx");
  const edit = src.slice(src.indexOf("const isPendingMode"));
  assert.match(edit, /\{showCosts && <th className="px-3 py-2 text-right">ต้นทุนบรรทัดนี้/);
  assert.match(edit, /\{showCosts && missing &&/);
  assert.match(edit, /\{showCosts && <td className="px-3 py-2 text-right tabular-nums">\{formatBaht\(lineCost\(item\)\)\}<\/td>\}/);
  assert.match(edit, /\{showCosts && \(\s*<CostSummary/);
});

test("an approval writes no price from a sender who cannot see prices now", () => {
  const src = code("../app/owner/approve/actions.ts");
  for (const c of ['case "ingredient_create": {', 'case "ingredient_edit": {']) {
    const body = src.slice(src.indexOf(c), src.indexOf("case ", src.indexOf(c) + c.length));
    assert.ok(body.includes("const fields = await requestFields(supabase, row.editor_id as string | null, p.fields);"), c);
    assert.ok(!body.includes("p.fields as Record"), c + ": the raw fields are never written");
  }
  const helper = src.slice(src.indexOf("async function requestFields("), src.indexOf("export async function approveChange("));
  assert.ok(helper.includes("return seesCost(who) ? fields : withoutCostFields(fields);"), "an unreadable sender (null) fails closed: seesCost(null) is false");
});
