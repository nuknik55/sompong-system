/**
 * Run with: npm test — per-SOP "who can see" (Nik, 2026-09-26), the app's side.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sopRequestMenuId, sopVisibleTo } from "./sop-visibility.ts";

const open = { visibility: "all", viewerIds: [] as string[] };
const chosen = { visibility: "chosen", viewerIds: ["wetch"] };

test("owner and admin see every SOP; others an open one, or one they are chosen for", () => {
  assert.equal(sopVisibleTo(chosen, { id: "o", role: "owner" }), true);
  assert.equal(sopVisibleTo(chosen, { id: "a", role: "admin" }), true);
  assert.equal(sopVisibleTo(chosen, { id: "wetch", role: "editor" }), true);
  assert.equal(sopVisibleTo(chosen, { id: "ngan", role: "editor" }), false);
  assert.equal(sopVisibleTo(chosen, { id: "s", role: "staff" }), false);
  for (const role of ["editor", "staff", "hr", "sales"]) assert.equal(sopVisibleTo(open, { id: "x", role }), true, role);
});

test("no profile sees nothing; an unknown setting fails closed", () => {
  assert.equal(sopVisibleTo(open, { id: "x", role: null }), false);
  assert.equal(sopVisibleTo({ visibility: "someday", viewerIds: ["x"] }, { id: "x", role: "editor" }), false);
});

test("an SOP request names its menu in one place, or not at all", () => {
  assert.equal(sopRequestMenuId("sop_upsert", { sopData: { menuId: "m1" } }), "m1");
  assert.equal(sopRequestMenuId("sop_delete", { menuId: "m2" }), "m2");
  for (const bad of [{}, { sopData: null }, { sopData: { menuId: 5 } }, { sopData: { menuId: "" } }, { sopData: ["m1"] }]) {
    assert.equal(sopRequestMenuId("sop_upsert", bad as Record<string, unknown>), null, JSON.stringify(bad));
  }
  assert.equal(sopRequestMenuId("sop_delete", { menuId: ["m2"] } as Record<string, unknown>), null);
  assert.equal(sopRequestMenuId("recipe_edit", { menuId: "m3" }), null);
});

// The wiring, read from the shipped approval (comments stripped).
const code = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("an SOP request is approved only when its sender may see that SOP, and the id checked is the id written", () => {
  const src = code("../app/owner/approve/actions.ts");
  const guard = src.indexOf("const sopMenuId = sopRequestMenuId(");
  assert.ok(guard > 0, "the menu id is taken once");
  assert.ok(guard < src.indexOf("switch (row.change_type)"), "and checked before any write");
  assert.match(src, /if \(sopMenuId !== row\.target_id\)/, "it must be the request's own target");
  assert.match(src, /await sopRequestRefusal\(supabase, sopMenuId, row\.editor_id as string\)/);
  const upsert = src.slice(src.indexOf('case "sop_upsert": {'), src.indexOf('case "sop_delete": {'));
  const del = src.slice(src.indexOf('case "sop_delete": {'), src.indexOf("default:", src.indexOf('case "sop_delete": {')));
  assert.match(upsert, /menu_id: sopMenuId!/, "the upsert writes the checked id");
  assert.doesNotMatch(upsert, /menu_id: sopData\.menuId/);
  assert.match(del, /\.eq\("menu_id", sopMenuId!\)/, "the delete deletes the checked id");
});
