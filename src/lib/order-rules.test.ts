/** Run with: npm test — the screen's half of the supply-order rules (item 35). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUSES, STATUS_LABEL, STATUS_CLASS, canApprove, canCancel, canEditLines, canOrder, canReceive, canReturn,
  canSend, canSetHeadQty, isOpenStatus, isOrderHead, type OrderStatus,
} from "./order-rules.ts";

const ROLES = ["owner", "admin", "editor", "staff", "hr", "sales"] as const;
const view = (role: string, status: OrderStatus, isCreator = false) => ({ role, status, isCreator });

test("every status has a label and a badge class", () => {
  for (const s of ORDER_STATUSES) {
    assert.ok(STATUS_LABEL[s]);
    assert.ok(STATUS_CLASS[s]);
  }
  assert.equal(STATUS_LABEL.cancelled, "ยกเลิก");
  assert.match(STATUS_CLASS.cancelled, /line-through/);
  assert.equal(isOpenStatus("sent"), true);
  assert.equal(isOpenStatus("received"), false);
  assert.equal(isOpenStatus("cancelled"), false);
});

test("decision 1 and 9: heads are editor, admin, owner; hr and sales cannot order", () => {
  assert.deepEqual(ROLES.filter(isOrderHead), ["owner", "admin", "editor"]);
  assert.deepEqual(ROLES.filter(canOrder), ["owner", "admin", "editor", "staff"]);
});

test("decision 6: the creator edits lines while waiting and after a return, never after approval", () => {
  assert.equal(canEditLines(view("staff", "submitted", true)), true);
  assert.equal(canEditLines(view("staff", "returned", true)), true);
  assert.equal(canEditLines(view("staff", "reviewed", true)), false);
  assert.equal(canEditLines(view("staff", "submitted", false)), false);
  // decision 14: each person edits only their own — no admin override
  assert.equal(canEditLines(view("admin", "returned", false)), false);
  assert.equal(canEditLines(view("hr", "submitted", true)), false);
});

test("decision 3: a head changes quantities only before approving", () => {
  assert.equal(canSetHeadQty(view("editor", "submitted")), true);
  assert.equal(canSetHeadQty(view("editor", "reviewed")), false);
  assert.equal(canSetHeadQty(view("staff", "submitted")), false);
});

test("decisions 2, 4, 7: any head approves or returns, own orders included, until sent", () => {
  assert.equal(canApprove(view("editor", "submitted", true)), true);
  assert.equal(canApprove(view("owner", "submitted")), true);
  assert.equal(canApprove(view("staff", "submitted", true)), false);
  assert.equal(canApprove(view("editor", "reviewed")), false);
  assert.equal(canReturn(view("editor", "submitted")), true);
  assert.equal(canReturn(view("editor", "reviewed")), true);
  assert.equal(canReturn(view("editor", "sent")), false);
  assert.equal(canReturn(view("admin", "returned")), false);
});

test("decision 5 and 8: owner and admin mark sent; anyone who may order receives", () => {
  assert.equal(canSend(view("admin", "reviewed")), true);
  assert.equal(canSend(view("editor", "reviewed")), false);
  assert.equal(canSend(view("admin", "submitted")), false);
  assert.equal(canReceive(view("staff", "sent")), true);
  assert.equal(canReceive(view("hr", "sent")), false);
  assert.equal(canReceive(view("sales", "sent")), false);
  assert.equal(canReceive(view("staff", "reviewed")), false);
});

test("decision 10: who may cancel, and when", () => {
  assert.equal(canCancel(view("staff", "submitted", true)), true);
  assert.equal(canCancel(view("staff", "submitted", false)), false);
  assert.equal(canCancel(view("staff", "reviewed", true)), false);
  assert.equal(canCancel(view("editor", "submitted")), true);
  assert.equal(canCancel(view("editor", "returned")), true);
  assert.equal(canCancel(view("editor", "reviewed")), true);
  assert.equal(canCancel(view("editor", "sent")), false);
  assert.equal(canCancel(view("admin", "sent")), true);
  assert.equal(canCancel(view("owner", "sent")), true);
  assert.equal(canCancel(view("admin", "received")), false);
  assert.equal(canCancel(view("owner", "cancelled")), false);
  assert.equal(canCancel(view("sales", "submitted", true)), false);
});
