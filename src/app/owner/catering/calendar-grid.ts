// Pure date-grid math shared between the calendar page's server-side event
// fetch (actions.ts) and CalendarClient's rendering — kept in one place so
// the fetched date range and the rendered grid can never drift apart. The
// grid used to show muted leading/trailing days from adjacent months while
// the fetch stayed scoped to exactly the viewed month, so those days could
// never show event markers no matter what the client did with them — this
// module is what makes the fetch range and the render grid agree by
// construction instead of by coincidence.
//
// No "use client"/"use server" — plain Date/string math, safe to import
// from both a server action and a client component. Deliberately has no
// dependency on actions.ts, to avoid any risk of a circular import with
// shared-utils.tsx (which already imports types from actions.ts).

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export type CalendarCell = {
  day: number;
  year: number;
  month: number;
  inMonth: boolean;
  /** "YYYY-MM-DD" — the cell's real calendar date, whether or not it
   *  belongs to the viewed month. */
  dateStr: string;
};

/** Every cell in the month's grid, in order — leading muted days from the
 *  previous month, the viewed month's own days, trailing muted days from
 *  the next month. CalendarClient chunks this into weeks of 7 to render;
 *  calendarGridRange() below derives the fetch bounds from the same array,
 *  so the two can never disagree about what the grid actually shows. */
export function buildCalendarGrid(year: number, month: number): CalendarCell[] {
  const firstDow = new Date(year, month - 1, 1).getDay();
  const total = daysInMonth(year, month);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevTotal = daysInMonth(prevYear, prevMonth);
  const leading: CalendarCell[] = Array.from({ length: firstDow }, (_, i) => {
    const day = prevTotal - firstDow + 1 + i;
    return { day, year: prevYear, month: prevMonth, inMonth: false, dateStr: `${prevYear}-${pad(prevMonth)}-${pad(day)}` };
  });

  const current: CalendarCell[] = Array.from({ length: total }, (_, i) => {
    const day = i + 1;
    return { day, year, month, inMonth: true, dateStr: `${year}-${pad(month)}-${pad(day)}` };
  });

  const withLeading = [...leading, ...current];
  const trailingCount = (7 - (withLeading.length % 7)) % 7;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const trailing: CalendarCell[] = Array.from({ length: trailingCount }, (_, i) => {
    const day = i + 1;
    return { day, year: nextYear, month: nextMonth, inMonth: false, dateStr: `${nextYear}-${pad(nextMonth)}-${pad(day)}` };
  });

  return [...withLeading, ...trailing];
}

/** Inclusive [start, end] date bounds covering every cell buildCalendarGrid
 *  returns — the fetch needs to cover at least this much, or some cell's
 *  events can never be found regardless of what the client does. */
export function calendarGridRange(year: number, month: number): { start: string; end: string } {
  const cells = buildCalendarGrid(year, month);
  return { start: cells[0].dateStr, end: cells[cells.length - 1].dateStr };
}
