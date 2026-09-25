/**
 * แจ้งซ่อม: who may do what, as the screen shows it. The ENFORCEMENT is the
 * database: every write goes through a function in
 * catering_typed_dishes_per_head_and_maintenance_migration.sql (part C:
 * maint_create, maint_edit, maint_take, maint_done, maint_cancel) that checks
 * role, status and reporter itself and refuses everything else; direct
 * writes on maintenance_reports are closed. This module is the convenience
 * half, so the screen offers only what the database will accept; changing
 * it alone changes nothing about what is permitted.
 *
 * - A head is owner, admin or editor (the same three the functions name).
 * - Statuses run new → in_progress → done, with cancelled (instead of
 *   delete, Nik 2026-09-25) beside them. done and cancelled are closed.
 *
 * A plain module (no "server-only", no React): the server pages and the
 * client components both import it.
 */

export type MaintenanceStatus = "new" | "in_progress" | "done" | "cancelled";

export const MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = ["new", "in_progress", "done", "cancelled"];

export const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  new: "แจ้งแล้ว",
  in_progress: "กำลังซ่อม",
  done: "เสร็จแล้ว",
  cancelled: "ยกเลิก",
};

/** The badge's colours: the shared tones, cancelled grey and struck through (never red). */
export const STATUS_CLASS: Record<MaintenanceStatus, string> = {
  new: "bg-pending-soft text-pending-ink",
  in_progress: "bg-info-soft text-info",
  done: "bg-success-soft text-success-ink",
  cancelled: "bg-neutral-200 text-neutral-700 line-through",
};

/** maint_cancel refuses a longer note (the column's CHECK says the same). */
export const CANCEL_NOTE_MAX = 500;

/** Owner, admin, editor: the roles that take, finish and cancel any report. */
export function isMaintenanceHead(role: string): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

/** Open = new + in_progress: what the nav badge counts. Cancelled is not open. */
export function isOpen(status: MaintenanceStatus): boolean {
  return status === "new" || status === "in_progress";
}

/** maint_edit: the reporter, or a head, only while nobody has taken it. */
export function canEditReport(role: string, isReporter: boolean, status: MaintenanceStatus): boolean {
  return status === "new" && (isReporter || isMaintenanceHead(role));
}

/** maint_take: a head, new → in_progress. */
export function canTake(role: string, status: MaintenanceStatus): boolean {
  return isMaintenanceHead(role) && status === "new";
}

/** maint_done: a head, from new or in_progress. */
export function canMarkDone(role: string, status: MaintenanceStatus): boolean {
  return isMaintenanceHead(role) && isOpen(status);
}

/**
 * maint_cancel: the reporter while it is new; a head while it is new or in
 * progress; nobody once it is done or already cancelled.
 */
export function canCancel(role: string, isReporter: boolean, status: MaintenanceStatus): boolean {
  if (!isOpen(status)) return false;
  if (isMaintenanceHead(role)) return true;
  return isReporter && status === "new";
}
