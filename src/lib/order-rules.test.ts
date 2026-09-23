/** Run with: npm test — the screen's half of the supply-order rules (item 35). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_STATUSES, STATUS_LABEL, STATUS_CLASS, canApprove, canCancel, canEditLines, canOrder, canReceive, canReturn,
  canSend, canSetHeadQty, countsFor, isOpenStatus, isOrderHead, NO_COUNTS, pendingHref, totalCount, type OrderStatus,
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

test("waiting for you: which counts each role has", () => {
  assert.deepEqual(countsFor("staff"), { mine: true, review: false, purchase: false, receive: true });
  assert.deepEqual(countsFor("editor"), { mine: false, review: true, purchase: false, receive: false });
  assert.deepEqual(countsFor("admin"), { mine: false, review: true, purchase: true, receive: false });
  assert.deepEqual(countsFor("owner"), { mine: false, review: true, purchase: true, receive: false });
  for (const r of ["hr", "sales"]) assert.deepEqual(countsFor(r), { mine: false, review: false, purchase: false, receive: false });
});

test("waiting for you: the sidebar opens the earliest step with work", () => {
  const c = (mine: number, review: number, purchase: number, receive: number) => ({ mine, review, purchase, receive });
  assert.equal(pendingHref(c(0, 0, 0, 0)), "/staff/inventory");
  assert.equal(pendingHref(c(1, 0, 0, 2)), "/staff/inventory");
  assert.equal(pendingHref(c(0, 0, 0, 2)), "/staff/inventory/receive-queue");
  assert.equal(pendingHref(c(0, 3, 1, 0)), "/staff/inventory/review");
  assert.equal(pendingHref(c(0, 0, 1, 0)), "/staff/inventory/purchase");
  assert.equal(totalCount(c(1, 2, 3, 4)), 10);
  assert.equal(totalCount(NO_COUNTS), 0);
});
