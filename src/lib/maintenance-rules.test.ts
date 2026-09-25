/** Run with: npm test — the screen's half of the แจ้งซ่อม rules (maint_* functions, part C of the migration). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANCEL_NOTE_MAX, MAINTENANCE_STATUSES, STATUS_CLASS, STATUS_LABEL, canCancel, canEditReport, canMarkDone, canTake,
  isMaintenanceHead, isOpen, type MaintenanceStatus,
} from "./maintenance-rules.ts";

const ROLES = ["owner", "admin", "editor", "staff", "hr", "sales"] as const;
const HEADS = new Set(["owner", "admin", "editor"]);

// The database's answers, written out by hand from maint_cancel / maint_edit /
// maint_take / maint_done rather than derived from the module under test.
// [head, non-head reporter, non-head non-reporter]
const CANCEL: Record<MaintenanceStatus, [boolean, boolean, boolean]> = {
  new: [true, true, false],
  in_progress: [true, false, false],
  done: [false, false, false],
  cancelled: [false, false, false],
};
const EDIT: Record<MaintenanceStatus, [boolean, boolean, boolean]> = {
  new: [true, true, false],
  in_progress: [false, false, false],
  done: [false, false, false],
  cancelled: [false, false, false],
};
const TAKE: Record<MaintenanceStatus, boolean> = { new: true, in_progress: false, done: false, cancelled: false };
const DONE: Record<MaintenanceStatus, boolean> = { new: true, in_progress: true, done: false, cancelled: false };

function expected(table: Record<MaintenanceStatus, [boolean, boolean, boolean]>, role: string, isReporter: boolean, s: MaintenanceStatus) {
  const [head, reporter, other] = table[s];
  if (HEADS.has(role)) return head;
  return isReporter ? reporter : other;
}

test("every status has a label and a badge class; cancelled is grey and struck through, never red", () => {
  assert.deepEqual([...MAINTENANCE_STATUSES], ["new", "in_progress", "done", "cancelled"]);
  for (const s of MAINTENANCE_STATUSES) {
    assert.ok(STATUS_LABEL[s]);
    assert.ok(STATUS_CLASS[s]);
  }
  assert.equal(STATUS_LABEL.new, "แจ้งแล้ว");
  assert.equal(STATUS_LABEL.in_progress, "กำลังซ่อม");
  assert.equal(STATUS_LABEL.done, "เสร็จแล้ว");
  assert.equal(STATUS_LABEL.cancelled, "ยกเลิก");
  assert.match(STATUS_CLASS.cancelled, /line-through/);
  assert.match(STATUS_CLASS.cancelled, /neutral/);
  assert.doesNotMatch(STATUS_CLASS.cancelled, /danger|red/);
  assert.equal(CANCEL_NOTE_MAX, 500);
});

test("heads are owner, admin, editor; open is new and in_progress only", () => {
  assert.deepEqual(ROLES.filter(isMaintenanceHead), ["owner", "admin", "editor"]);
  assert.deepEqual(MAINTENANCE_STATUSES.filter(isOpen), ["new", "in_progress"]);
  assert.equal(isOpen("cancelled"), false);
});

test("cancel: every role × status × reporter matches maint_cancel", () => {
  let n = 0;
  for (const role of ROLES) {
    for (const s of MAINTENANCE_STATUSES) {
      for (const isReporter of [true, false]) {
        assert.equal(canCancel(role, isReporter, s), expected(CANCEL, role, isReporter, s), `${role} ${s} reporter=${isReporter}`);
        n++;
      }
    }
  }
  assert.equal(n, 48);
});

test("cancel is refused on a done report, for everyone — the owner and the reporter included", () => {
  for (const role of ROLES) {
    assert.equal(canCancel(role, true, "done"), false, `${role} reporter on done`);
    assert.equal(canCancel(role, false, "done"), false, `${role} on done`);
  }
  assert.equal(canCancel("owner", false, "done"), false);
});

test("cancel: the reporter only while new; a head also once taken; nobody twice", () => {
  assert.equal(canCancel("staff", true, "new"), true);
  assert.equal(canCancel("sales", true, "new"), true);
  assert.equal(canCancel("staff", true, "in_progress"), false);
  assert.equal(canCancel("hr", false, "new"), false);
  assert.equal(canCancel("editor", false, "in_progress"), true);
  assert.equal(canCancel("editor", true, "cancelled"), false);
});

test("edit: every role × status × reporter matches maint_edit", () => {
  for (const role of ROLES) {
    for (const s of MAINTENANCE_STATUSES) {
      for (const isReporter of [true, false]) {
        assert.equal(canEditReport(role, isReporter, s), expected(EDIT, role, isReporter, s), `${role} ${s} reporter=${isReporter}`);
      }
    }
  }
});

test("take and done: every role × status matches maint_take and maint_done", () => {
  for (const role of ROLES) {
    for (const s of MAINTENANCE_STATUSES) {
      assert.equal(canTake(role, s), HEADS.has(role) && TAKE[s], `take ${role} ${s}`);
      assert.equal(canMarkDone(role, s), HEADS.has(role) && DONE[s], `done ${role} ${s}`);
    }
  }
  assert.equal(canTake("staff", "new"), false);
  assert.equal(canMarkDone("editor", "cancelled"), false);
  assert.equal(canMarkDone("owner", "done"), false);
});
