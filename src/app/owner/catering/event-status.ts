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

export const STATUS_COLOR: Record<string, string> = {
  inquiry:          "text-neutral-600 bg-neutral-50 border-neutral-200",
  awaiting_deposit: "text-amber-700 bg-amber-50 border-amber-200",
  deposit_paid:     "text-blue-700 bg-blue-50 border-blue-200",
  confirmed:        "text-green-700 bg-green-50 border-green-200",
  done:             "text-neutral-500 bg-neutral-100 border-neutral-300",
  cancelled:        "text-red-700 bg-red-50 border-red-200",
};

/** True for a value that catering_events.status actually accepts — the
 *  column's CHECK constraint enforces this too, this just lets a caller
 *  fail with a readable message instead of a raw Postgres error. */
export function isValidCateringStatus(status: string): boolean {
  return STATUS_OPTIONS.some((o) => o.value === status);
}
