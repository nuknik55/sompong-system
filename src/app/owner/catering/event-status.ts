// Single source of truth for catering_events.status — its allowed values,
// Thai labels, and badge colors. Plain data, no JSX, no "use client"/
// "use server", same convention as conflict.ts / checklist.ts /
// calendar-grid.ts, so BOTH server code (actions.ts, a "use server" file
// that can only import plain-TS modules) and client code (shared-utils.tsx
// and everything downstream of it) can import from here.
//
// These used to live in shared-utils.tsx, which carries JSX components —
// so actions.ts couldn't import them and had to keep its own duplicate copy
// of the list for server-side validation. That's the same shape as the bug
// where shared.tsx's "use client" made plain formatters unreachable from a
// server component: constants trapped in a file the other side can't
// import. One definition here removes the possibility of the two drifting.
//
// Values mirror the CHECK constraint on catering_events.status in
// supabase/catering_migration.sql.
//
// Named event-status.ts, not status.ts, because ./status already resolves
// to the status/ route directory in this same folder.

export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "inquiry",          label: "สอบถาม" },
  { value: "awaiting_deposit", label: "รอมัดจำ" },
  { value: "deposit_paid",     label: "มัดจำแล้ว" },
  { value: "confirmed",        label: "คอนเฟิร์มแล้ว" },
  { value: "done",             label: "เสร็จสิ้น" },
  { value: "cancelled",        label: "ยกเลิก" },
];

export const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));

/**
 * Each status's badge in the shared look's colour roles (AGENTS.md, "The
 * app's look"), as Nik decided on 2026-09-23. Every screen shows a booking's
 * status through BookingStatusBadge, which reads this; there is no other
 * colour map for it.
 *   สอบถาม       navy (info tint)             #00365B on #E6EBEF  10.4:1
 *   รอมัดจำ       gold (pending tint)          #5C4300 on #F9F1D6   8.2:1
 *   มัดจำแล้ว     LIGHT green (success tint)   #2B6600 on #EBF2E6   6.1:1
 *   คอนเฟิร์มแล้ว  DARK green (solid primary)  white on #2F5A16     8.1:1
 *   เสร็จสิ้น      grey (neutral)               #404040 on #F5F5F5   9.5:1
 *   ยกเลิก       grey, struck through         #404040 on #F5F5F5   9.5:1
 * So progress reads light to dark green. ยกเลิก is NOT danger: red is kept
 * for deleting and for errors, and a cancelled booking is neither.
 */
export const STATUS_TONE: Record<string, "primary" | "primary-strong" | "pending" | "success" | "info" | "neutral" | "danger"> = {
  inquiry:          "info",
  awaiting_deposit: "pending",
  deposit_paid:     "success",
  confirmed:        "primary-strong",
  done:             "neutral",
  cancelled:        "neutral",
};

/** True for a value that catering_events.status actually accepts — the
 *  column's CHECK constraint enforces this too, this just lets a caller
 *  fail with a readable message instead of a raw Postgres error. */
export function isValidCateringStatus(status: string): boolean {
  return STATUS_OPTIONS.some((o) => o.value === status);
}
