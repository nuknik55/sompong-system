/**
 * THE way a date is shown on screen (Nik, 2026-09-23): Thai short style,
 * day/month/Buddhist-era year, "18/9/2569" — the style the booking list
 * already used. Every date DISPLAYED on a screen goes through here, so the
 * SOP list no longer shows "2026-07-13" while the bookings show "18/9/2569".
 *
 * Not for: stored values (always ISO), native <input type="date"> (the
 * browser draws those), the printed documents and the Excel exports, which
 * keep their own formats.
 *
 * Two kinds of input, read differently, on purpose:
 * - A calendar date, "YYYY-MM-DD" (event_date, entry_date): the day as
 *   written. No time zone is involved, so none is applied.
 * - A timestamp (created_at, "2026-09-17T18:30:00Z", or a Date): the day and
 *   time in Bangkok, named by zone, so a UTC server and a Bangkok phone show
 *   the same thing (see bangkok-date.ts for the defect that rule exists for).
 */

const DAYS_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

type DateInput = string | Date | null | undefined;
type Parts = { y: number; m: number; d: number; dow: number; hh: number; mi: number };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** An ISO timestamp: a date, then a time. No other text is read as one. */
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

const BANGKOK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsOf(v: DateInput): Parts | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    const m = v.match(DATE_ONLY);
    if (m) {
      const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      // Day of week in UTC arithmetic: the same answer in every runtime.
      const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
      return { y, m: mo, d, dow, hh: 0, mi: 0 };
    }
  }
  // Only ISO text is a date here. The POS report's own period text
  // ("มิถุนายน 2569", "12 สิงหาคม 2567") once went through new Date() and came
  // out as "1/1/3112"; text that is not ISO is shown as it came.
  if (typeof v === "string" && !ISO_STAMP.test(v)) return null;
  const at = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(at.getTime())) return null;
  const p: Record<string, number> = {};
  for (const { type, value } of BANGKOK.formatToParts(at)) {
    if (type === "year" || type === "month" || type === "day" || type === "hour" || type === "minute") p[type] = Number(value);
  }
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  // Some ICU builds print midnight as 24 even in a 24-hour cycle (log-time.ts
  // met it): the date is right, only the hour needs folding.
  return { y: p.year, m: p.month, d: p.day, dow, hh: p.hour === 24 ? 0 : p.hour, mi: p.minute };
}

/** What an empty or unreadable value shows. */
const NONE = "–";

/** "18/9/2569". */
export function thaiDate(v: DateInput): string {
  const p = partsOf(v);
  if (!p) return v == null || v === "" ? NONE : String(v);
  return `${p.d}/${p.m}/${p.y + 543}`;
}

/** "ศ 18/9/2569": with the day of the week, as the booking list shows it. */
export function thaiDateWithDay(v: DateInput): string {
  const p = partsOf(v);
  if (!p) return v == null || v === "" ? NONE : String(v);
  return `${DAYS_SHORT[p.dow]} ${p.d}/${p.m}/${p.y + 543}`;
}

/** "18/9/2569 14:05", in Bangkok time: for a timestamp whose time matters. */
export function thaiDateTime(v: DateInput): string {
  const p = partsOf(v);
  if (!p) return v == null || v === "" ? NONE : String(v);
  return `${p.d}/${p.m}/${p.y + 543} ${String(p.hh).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/** "18/9": the day and month alone, where the year is already on the screen (a week's column heads). */
export function thaiDayMonth(v: DateInput): string {
  const p = partsOf(v);
  if (!p) return v == null || v === "" ? NONE : String(v);
  return `${p.d}/${p.m}`;
}
