import { toTimeInput } from "./booking-form";

// The printed documents' date and time words. Moved out of shared-utils.tsx
// on 2026-09-24, verbatim, so the event-details sheet can print the
// quotation's header without importing shared-utils, which imports
// event-menu.ts and its cost figures. shared-utils.tsx re-exports all of it.
// Pure; no cost in its imports.

export const MONTHS_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const DAYS_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

/** "ศ 18 กันยายน 2569": the printed documents' long date only (quotation,
 *  function sheets); a screen shows thDate. */
export function thFullDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dow = new Date(d + "T00:00:00").getDay();
  return `${DAYS_SHORT[dow]} ${day} ${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 2500) + 543}`;
}

export function timeRange(start: string | null, end: string | null): string {
  const s = toTimeInput(start);
  const e = toTimeInput(end);
  if (s && e) return `${s}–${e}`;
  return s || e || "–";
}
