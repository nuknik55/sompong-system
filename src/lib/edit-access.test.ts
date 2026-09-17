/** Run with: npm test — who may change a recipe or an SOP (queue item 34). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { editAccess } from "./edit-access.ts";

test("THE DEFECT: hr and sales only view, like staff", () => {
  for (const role of ["staff", "hr", "sales"]) assert.equal(editAccess(role), "view", role);
});

test("owner and admin save directly; an editor files a request", () => {
  assert.equal(editAccess("owner"), "direct");
  assert.equal(editAccess("admin"), "direct");
  assert.equal(editAccess("editor"), "request");
});

test("fails closed: no profile, or a role it does not know, only views", () => {
  for (const role of [null, undefined, "", "superuser", "Admin", "OWNER", "accounting"]) {
    assert.equal(editAccess(role), "view", String(role));
  }
});
