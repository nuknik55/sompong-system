/** Run with: npm test — the id a create approval gives the row it makes (item 27). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalRowId } from "./approval-id.ts";

const CHANGE = "5547ed5e-4b6c-48b9-a3d0-aed5f3c2da01";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("the same change always gives the same row id, so a retry finds its own row", () => {
  assert.equal(approvalRowId(CHANGE, "prep"), approvalRowId(CHANGE, "prep"));
});

test("the row id is never the change id itself, which a caller can choose", () => {
  assert.notEqual(approvalRowId(CHANGE, "menu"), CHANGE);
  assert.notEqual(approvalRowId(CHANGE, "prep"), CHANGE);
});

test("different changes, and a menu versus a prep, give different ids", () => {
  const other = "de7f8275-1aa5-4848-ac65-a3e6143df8b1";
  assert.notEqual(approvalRowId(CHANGE, "prep"), approvalRowId(other, "prep"));
  assert.notEqual(approvalRowId(CHANGE, "menu"), approvalRowId(CHANGE, "prep"));
});

test("the id is shaped like a UUID, lower-case, so Postgres accepts it", () => {
  for (const kind of ["menu", "prep"] as const) {
    for (const id of [CHANGE, "00000000-0000-0000-0000-000000000000", "anything"]) {
      assert.match(approvalRowId(id, kind), UUID);
    }
  }
});
