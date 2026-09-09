/**
 * Run with:  npm test
 *
 * These tests exist because of two live defects in DailyEntryClient, both the
 * same shape — "not cash" treated as "transfer":
 *
 *   printGroups:  if (e.payment_method === "cash") … else → transfer
 *   handleUpdate: const payMethod = cash > 0 ? "cash" : "transfer"
 *
 * Both were unreachable while payment_method could only be cash or transfer.
 * The POS import schema migration made `accrual` writable, so they are live.
 * Every test below fails against those two rules and passes against the
 * functions in payment-split.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDailyEditable,
  resolveEditPaymentMethod,
  splitByPaymentMethod,
} from "./payment-split.ts";

const entry = (payment_method: string, amount: number, label = "a") => ({
  payment_method,
  amount,
  label,
});

test("accrual is its own bucket and never lands in transfer", () => {
  const { groups, totals } = splitByPaymentMethod(
    [
      entry("cash", 100),
      entry("transfer", 200),
      entry("accrual", 102876.25),
    ],
    (e) => e.label,
  );
  assert.equal(totals.cash, 100);
  // The old rule returned 102,876.25 + 200 here. That is the defect: money
  // withheld before it arrived, presented as money to send.
  assert.equal(totals.transfer, 200);
  assert.equal(totals.accrual, 102876.25);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]!.buckets, { cash: 100, transfer: 200, accrual: 102876.25 });
});

test("the three GP and discount entries of a month total to the accrual bucket alone", () => {
  const { totals } = splitByPaymentMethod(
    [
      entry("accrual", 102876.25, "POS-DISCOUNT-2026-08"),
      entry("accrual", 34047.34, "POS-GP-LM-2026-08"),
      entry("accrual", 25430.1, "POS-GP-GRAB-2026-08"),
      entry("transfer", 5000, "ผักสี่มุมเมือง"),
    ],
    (e) => e.label,
  );
  assert.equal(Math.round(totals.accrual * 100) / 100, 162353.69);
  assert.equal(totals.transfer, 5000);
  assert.equal(totals.cash, 0);
});

test("an unrecognised method is counted in no bucket, but still in the group total", () => {
  const { groups, totals } = splitByPaymentMethod([entry("cheque", 700)], (e) => e.label);
  assert.deepEqual(totals, { cash: 0, transfer: 0, accrual: 0 });
  assert.equal(groups[0]!.total, 700);
  assert.deepEqual(groups[0]!.buckets, { cash: 0, transfer: 0, accrual: 0 });
});

test("entries group by the key, and a group's buckets sum to its total", () => {
  const { groups } = splitByPaymentMethod(
    [
      entry("cash", 100, "bill-1"),
      entry("transfer", 50, "bill-1"),
      entry("cash", 20, "bill-2"),
    ],
    (e) => e.label,
  );
  const one = groups.find((g) => g.label === "bill-1")!;
  assert.equal(one.buckets.cash + one.buckets.transfer + one.buckets.accrual, one.total);
  assert.equal(one.total, 150);
  assert.equal(groups.find((g) => g.label === "bill-2")!.total, 20);
});

test("only cash and transfer entries may be edited on the daily screen", () => {
  assert.equal(isDailyEditable({ payment_method: "cash" }), true);
  assert.equal(isDailyEditable({ payment_method: "transfer" }), true);
  // The dialog has no box that can express this one, and cannot even display
  // its amount — it would open blank and save as transfer.
  assert.equal(isDailyEditable({ payment_method: "accrual" }), false);
  assert.equal(isDailyEditable({ payment_method: "cheque" }), false);
});

test("editing resolves from whichever box was filled, and otherwise leaves the method alone", () => {
  assert.equal(resolveEditPaymentMethod(500, 0, "transfer"), "cash");
  assert.equal(resolveEditPaymentMethod(0, 500, "cash"), "transfer");
  // Both boxes empty: the old rule asserted "transfer" unconditionally, which
  // is exactly how an accrual entry joined the pay-out list.
  assert.equal(resolveEditPaymentMethod(0, 0, "accrual"), "accrual");
  assert.equal(resolveEditPaymentMethod(0, 0, "cash"), "cash");
});

test("cash wins when both boxes are filled — unchanged from the old rule", () => {
  assert.equal(resolveEditPaymentMethod(100, 100, "transfer"), "cash");
});
