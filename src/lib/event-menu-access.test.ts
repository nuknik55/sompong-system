/**
 * Run with: npm test — the one rule for who may change a booking's own menu.
 * The first test is the decision as Nik made it; the second is the shape the
 * rule must keep (an allowlist), so a role added later gets nothing by default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eventMenuAccess } from "./event-menu-access.ts";

test("owner and admin edit, sales views, nobody else sees it (Nik, 2026-09-19)", () => {
  assert.equal(eventMenuAccess("owner"), "edit");
  assert.equal(eventMenuAccess("admin"), "edit");
  assert.equal(eventMenuAccess("sales"), "view");
  assert.equal(eventMenuAccess("editor"), "none");
  assert.equal(eventMenuAccess("staff"), "none");
  assert.equal(eventMenuAccess("hr"), "none");
});

test("an unknown, missing or future role gets nothing — an allowlist, not a denylist", () => {
  assert.equal(eventMenuAccess(null), "none");
  assert.equal(eventMenuAccess(undefined), "none");
  assert.equal(eventMenuAccess(""), "none");
  assert.equal(eventMenuAccess("accounting"), "none");
  assert.equal(eventMenuAccess("OWNER"), "none", "roles are exact strings, as profiles.role stores them");
});
