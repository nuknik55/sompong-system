/**
 * Run with: npm test — the CapEx question fires where Nik scoped it and
 * nowhere else.
 *
 * The first test is the entry the rule exists for: the ฿29,853 vacuum sealer
 * booked to 810 Supply - ครัว, the only miscode of its kind in the database.
 * The rest are the 16 entries over ฿20,000 that are NOT assets — a check that
 * fires on all 17 is one the bookkeeper stops reading inside a week, which is
 * why an amount-only rule was refused when this was first investigated.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capexWarning, capexWarningText, isCapexQuestionGroup, resolveCapexThreshold,
  CAPEX_GROUPS, CAPEX_TARGET_GROUP, DEFAULT_CAPEX_THRESHOLD,
} from "./capex-hint.ts";

const T = DEFAULT_CAPEX_THRESHOLD;

test("THE ENTRY IT EXISTS FOR: a 29,853 vacuum sealer in Supply asks the question", () => {
  assert.equal(capexWarning({ amount: 29853, groupCode: "G800", threshold: T }), true);
});

test("the large entries that are not assets stay silent", () => {
  // Every one of these is a real shape from the 17 entries ≥ 20,000.
  assert.equal(capexWarning({ amount: 40000, groupCode: "G100", threshold: T }), false, "crab is food");
  assert.equal(capexWarning({ amount: 120000, groupCode: "G200", threshold: T }), false, "social security is payroll");
  assert.equal(capexWarning({ amount: 250000, groupCode: "G300", threshold: T }), false, "rent");
  assert.equal(capexWarning({ amount: 25000, groupCode: "G700", threshold: T }), false, "consulting fees");
  assert.equal(capexWarning({ amount: 30000, groupCode: "G950", threshold: T }), false, "tax");
  assert.equal(capexWarning({ amount: 80000, groupCode: CAPEX_TARGET_GROUP, threshold: T }), false, "already CapEx");
});

test("maintenance asks it too — the other group equipment is bought in", () => {
  assert.equal(capexWarning({ amount: 20000.01, groupCode: "G400", threshold: T }), true);
  assert.deepEqual([...CAPEX_GROUPS], ["G400", "G800"]);
  assert.equal(isCapexQuestionGroup("G400"), true);
  assert.equal(isCapexQuestionGroup("G800"), true);
  assert.equal(isCapexQuestionGroup("G100"), false);
  assert.equal(isCapexQuestionGroup(null), false);
  assert.equal(isCapexQuestionGroup(undefined), false);
});

test("the threshold is a boundary, not a range: exactly 20,000 is not over it", () => {
  assert.equal(capexWarning({ amount: 20000, groupCode: "G800", threshold: T }), false);
  assert.equal(capexWarning({ amount: 19999.99, groupCode: "G800", threshold: T }), false);
  assert.equal(capexWarning({ amount: 20000.01, groupCode: "G800", threshold: T }), true);
});

test("the owner's threshold is what decides, and 0 turns the question off", () => {
  assert.equal(capexWarning({ amount: 6000, groupCode: "G800", threshold: 5000 }), true);
  assert.equal(capexWarning({ amount: 6000, groupCode: "G800", threshold: 50000 }), false);
  assert.equal(capexWarning({ amount: 1_000_000, groupCode: "G800", threshold: 0 }), false);
  assert.equal(capexWarning({ amount: 1_000_000, groupCode: "G800", threshold: -1 }), false);
});

test("a credit never asks, and neither does a figure that is not a number", () => {
  // Returns and credits are entered as negative amounts, with no warning of
  // any kind (Nik, 2026-09-18).
  assert.equal(capexWarning({ amount: -29853, groupCode: "G800", threshold: T }), false);
  assert.equal(capexWarning({ amount: NaN, groupCode: "G800", threshold: T }), false);
  // Infinity is rejected with NaN rather than treated as "over": both mean
  // the amount field does not hold a number yet.
  assert.equal(capexWarning({ amount: Infinity, groupCode: "G800", threshold: T }), false);
  assert.equal(capexWarning({ amount: 30000, groupCode: "G800", threshold: NaN }), false);
});

test("the question names what is NOT an asset, so it can be acted on", () => {
  const text = capexWarningText(T);
  assert.match(text, /20,000/);
  assert.match(text, /CapEx/);
  assert.match(text, /ทรัพย์สินใหม่/);
  assert.match(text, /สิ้นเปลือง/);
  assert.match(capexWarningText(50000), /50,000/);
});

test("BEFORE THE MIGRATION RUNS: a missing column falls back to 20,000", () => {
  // What app_settings gives back while capex_threshold does not exist: the
  // SELECT fails, data is null, and the page reads data?.capex_threshold.
  assert.equal(resolveCapexThreshold(undefined), 20000, "the column is not there yet");
  assert.equal(resolveCapexThreshold(null), 20000, "no row came back");
  assert.equal(DEFAULT_CAPEX_THRESHOLD, 20000);
  // And once it exists, whatever shape it arrives in.
  assert.equal(resolveCapexThreshold(20000), 20000);
  assert.equal(resolveCapexThreshold("35000"), 35000, "PostgREST hands numerics back as strings");
  assert.equal(resolveCapexThreshold("35000.50"), 35000.5);
  assert.equal(resolveCapexThreshold(0), 0, "0 is the owner turning it off, not a missing value");
  assert.equal(resolveCapexThreshold(""), 20000);
  assert.equal(resolveCapexThreshold("nonsense"), 20000);
  assert.equal(resolveCapexThreshold(NaN), 20000);
  // The whole point: on the fallback the question still works.
  assert.equal(capexWarning({ amount: 29853, groupCode: "G800", threshold: resolveCapexThreshold(undefined) }), true);
  assert.equal(capexWarning({ amount: 19000, groupCode: "G800", threshold: resolveCapexThreshold(undefined) }), false);
});
