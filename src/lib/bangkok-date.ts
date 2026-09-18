/**
 * Day and month strings, in the restaurant's own day.
 *
 * THE DEFECT THIS EXISTS FOR, twice now. `new Date().toISOString().slice(0, 7)`
 * is the UTC month and `.slice(0, 10)` is the UTC day, and Thailand is UTC+7:
 * between 00:00 and 07:00 in Bangkok, UTC is still yesterday. Vercel runs in
 * UTC, so for those seven hours every page that defaulted a day this way
 * opened on the wrong one — บันทึกรายวัน on yesterday's entries, the transfer
 * slip on the previous week, the schedule on last week. The month version of
 * this was fixed on 2026-09-18 (queue item 4's navigator); the day version is
 * the same shape and was fixed the next day.
 *
 * The other half of the same defect is ARITHMETIC: building a Date from local
 * components or from a zoneless string, moving it with setDate, and reading it
 * back with toISOString. Construction is local, the read is UTC, and the two
 * agree only where the offset is zero or positive — correct on Vercel and in
 * Bangkok, off by one west of Greenwich, which is what made the month
 * navigator skip a month in `npm run dev`. shiftDay and dayOfWeek below do it
 * in UTC throughout, so the answer does not depend on where the code runs.
 *
 * Every function here takes and returns "YYYY-MM-DD" (or "YYYY-MM"), never a
 * Date. A string cannot carry a zone by accident.
 */

/** Today in Bangkok, as "YYYY-MM-DD". The clock, read in the restaurant's zone by name. */
export function bangkokToday(): string {
  // en-CA formats as YYYY-MM-DD; the zone is named, not offset arithmetic, so
  // it stays right across any future change to the zone's rules.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

/** This month in Bangkok, as "YYYY-MM". */
export function bangkokYearMonth(): string {
  return bangkokToday().slice(0, 7);
}

/**
 * The day `n` days from `day` — n may be negative. Pure UTC arithmetic, so it
 * gives the same answer in every runtime, and Date.UTC rolls months and years
 * over for us (day 0 is the last of the previous month, day 32 the next).
 */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a "YYYY-MM-DD" day. */
export function dayOfWeek(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return 0;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * The most recent `weekday` on or before `day` — the start of the week under
 * whichever day that week begins on. The schedule's week starts on Monday (1)
 * and the transfer slip's on Tuesday (2), so the weekday is the caller's.
 */
export function startOfWeek(day: string, weekday: number): string {
  const back = (dayOfWeek(day) - weekday + 7) % 7;
  return shiftDay(day, -back);
}
