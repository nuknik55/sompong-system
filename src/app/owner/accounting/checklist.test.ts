/** Run with: npm test — the checklist's derivation, on evidence shaped like production's. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveChecklist, nextMonth, previousMonth, type ChecklistEvidence } from "./checklist.ts";

const AUG_TODAY: ChecklistEvidence = {
  deliveries: { newestDocumentDate: "2026-09-02", newestImportedAt: "2026-09-03T04:41:26Z" },
  salesImport: { yearMonth: "2026-08", period: "สิงหาคม 2569", importedAt: "2026-09-05T12:37:54Z" },
  revenueImportedAt: "2026-09-09T13:29:06Z",
  outsource: null,
  budget69ImportedAt: null,
};

const state = (ev: ChecklistEvidence, ym = "2026-08") => Object.fromEntries(deriveChecklist(ev, ym).steps.map((s) => [s.key, s.state]));

test("month arithmetic crosses the year", () => {
  assert.equal(previousMonth("2026-01"), "2025-12");
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(nextMonth("2026-08"), "2026-09");
});

test("August 2569 as it stood on 2026-09-10: four done, the accountant's file open, panel expanded is NOT needed (one open → collapsed)", () => {
  const c = deriveChecklist(AUG_TODAY, "2026-08");
  assert.deepEqual(state(AUG_TODAY), { prices: "done", sales: "done", classify: "done", revenue: "done", monthly: "open" });
  assert.equal(c.openCount, 1);
  assert.equal(c.allDone, false);
  assert.equal(c.collapsed, true);
  assert.equal(c.steps.find((s) => s.key === "monthly")!.ownerOnly, true);
});

test("all five done → allDone, and the outsource tick names an other-only import", () => {
  const c = deriveChecklist({ ...AUG_TODAY, outsource: { importedAt: "2026-09-10T11:30:00Z", expensesWritten: true } }, "2026-08");
  assert.equal(c.allDone, true);
  const j = deriveChecklist({ ...AUG_TODAY, outsource: { importedAt: "2026-09-10T11:30:00Z", expensesWritten: false } }, "2026-08");
  assert.match(j.steps.find((s) => s.key === "monthly")!.detail, /เฉพาะรายได้อื่นๆ/);
});

test("prices: the deliveries record must reach past the end of the month; an upload inside the month is open, with its date", () => {
  assert.equal(state({ ...AUG_TODAY, deliveries: { newestDocumentDate: "2026-08-31", newestImportedAt: null } }).prices, "open");
  assert.equal(state({ ...AUG_TODAY, deliveries: { newestDocumentDate: "2026-09-01", newestImportedAt: null } }).prices, "done");
  assert.equal(state({ ...AUG_TODAY, deliveries: { newestDocumentDate: null, newestImportedAt: null } }).prices, "open");
});

test("sales: a later 'last' row is partial (a date, not a tick, not a failure); no row is open; an earlier row is open", () => {
  assert.equal(state({ ...AUG_TODAY, salesImport: { yearMonth: "2026-09", period: "กันยายน 2569", importedAt: null } }).sales, "partial");
  assert.equal(state({ ...AUG_TODAY, salesImport: null }).sales, "open");
  assert.equal(state({ ...AUG_TODAY, salesImport: { yearMonth: "2026-07", period: "กรกฎาคม 2569", importedAt: null } }).sales, "open");
  assert.equal(state({ ...AUG_TODAY, salesImport: { yearMonth: null, period: "??", importedAt: null } }).sales, "open", "unparseable period is open, never a tick");
});

test("classification is implied by the revenue import, in both directions", () => {
  assert.equal(state(AUG_TODAY).classify, "done");
  assert.equal(state({ ...AUG_TODAY, revenueImportedAt: null }).classify, "open");
});

test("monthly: budget69 alone is partial — expenses in, other not; July 2569 reads that way until the file is run for other", () => {
  const jul: ChecklistEvidence = { ...AUG_TODAY, revenueImportedAt: null, budget69ImportedAt: "2026-09-10T06:19:37Z" };
  const c = deriveChecklist(jul, "2026-07");
  assert.equal(c.steps.find((s) => s.key === "monthly")!.state, "partial");
  assert.equal(c.collapsed, false, "three open (classify, revenue, monthly-partial) → expanded");
});
