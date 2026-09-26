/**
 * Run with: npm test — HR screens admin may open but not change, and the
 * phone-width fixes on printed documents (2026-09-26).
 *
 * Admin opens attendance, leave and the schedule (requireHROrAdmin), and
 * every write there is requireHR (owner, hr), which sends admin to /owner.
 * So the screens give admin no edit control at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("attendance, leave and the schedule: only owner and hr may edit", () => {
  for (const d of ["attendance", "leave", "schedule"]) {
    const page = code(`../app/owner/hr/${d}/page.tsx`);
    assert.match(page, /const profile = await requireHROrAdmin\(\);\n\s+const canEdit = profile\.role === "owner" \|\| profile\.role === "hr";/, d);
    assert.match(page, /canEdit=\{canEdit\}/, d);
  }
  const hr = code("../app/owner/hr/actions.ts");
  for (const fn of ["upsertAttendanceDaily", "deleteAttendanceDailyRecord", "upsertDaySwapRequest", "upsertLeaveRequest", "deleteLeaveRequest", "upsertScheduleNote"]) {
    const at = hr.indexOf(`export async function ${fn}(`);
    const guard = hr.indexOf("await require", at);
    assert.ok(at >= 0 && hr.startsWith("await requireHR();", guard), fn + " is requireHR, so admin cannot write it");
  }
});

test("the screens open no editor for admin", () => {
  const att = code("../app/owner/hr/attendance/AttendanceClient.tsx");
  assert.match(att, /function openEdit\(emp: Employee, day: number\) \{\n\s+if \(!canEdit\) return;/);
  assert.match(att, /function handleCellMouseDown\(emp: Employee, day: number\) \{\n\s+if \(!canEdit\) return;/);
  const sched = code("../app/owner/hr/schedule/ScheduleClient.tsx");
  assert.match(sched, /function openEdit\(emp: Employee, ds: string\) \{\n\s+if \(!canEdit\) return;/);
  const leave = code("../app/owner/hr/leave/LeaveClient.tsx");
  assert.match(leave, /\{canEdit \? \(\n\s+<button onClick=\{\(\) => setShowForm\(true\)\}/);
  assert.match(leave, /\{canEdit && <button onClick=\{\(\) => setConfirmDelete\(r\.id\)\}/);
});

// The CSS inside a page's <style> block, split into what is inside an
// "@media screen" block and what is not.
function screenOnly(src: string, selector: string) {
  const lines = src.split(/\r?\n/);
  let depth = 0;
  let screenAt = -1;
  const hits: boolean[] = [];
  for (const line of lines) {
    if (/@media screen/.test(line) && screenAt < 0) screenAt = depth;
    if (line.includes(selector) && /\{/.test(line) && !/className/.test(line)) hits.push(screenAt >= 0);
    for (const ch of line) {
      if (ch === "{") depth++;
      if (ch === "}") { depth--; if (screenAt >= 0 && depth === screenAt) screenAt = -1; }
    }
  }
  return hits;
}

test("the phone-width rules are screen only: the printed layouts do not change", () => {
  for (const f of ["../app/owner/accounting/daily/receipt/ReceiptClient.tsx", "../app/owner/catering/[id]/function-sheet/FunctionSheetClient.tsx", "../app/owner/catering/[id]/quote/QuoteClient.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.deepEqual(screenOnly(src, ".sig-row"), [true], f + ": one .sig-row rule, inside @media screen");
    assert.equal((src.match(/className="[^"]*sig-row/g) ?? []).length, 1, f + ": one signature row");
  }
  const sched = readFileSync(new URL("../app/owner/hr/schedule/print/page.tsx", import.meta.url), "utf8");
  assert.match(sched, /@media screen \{ \.table-scroll \{ overflow-x: auto; \} \}/);
  assert.equal(sched.split(".table-scroll").length - 1, 1, "the rule appears once, screen only");
});
