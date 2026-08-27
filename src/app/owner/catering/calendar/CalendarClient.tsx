"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { CateringEvent } from "../actions";
import { MONTHS_TH, VENUE_LABEL, toTimeInput } from "../shared-utils";
import { buildCalendarGrid } from "../calendar-grid";
import type { CalendarCell } from "../calendar-grid";

const DAYS_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]; // Sun=0, matches Date.getDay()

// Keyed by venue for in_house events; "offsite" covers location_type=offsite
// (venue is always null there). Five distinct hues so the categories in the
// legend are easy to tell apart at a glance.
const LOCATION_DOT: Record<string, string> = {
  room_v1:    "bg-blue-500",
  room_v2:    "bg-purple-500",
  room_v1_v2: "bg-indigo-600",
  air_shared: "bg-neutral-400",
  offsite:    "bg-amber-500",
};
const LEGEND: { key: string; label: string }[] = [
  { key: "room_v1",    label: VENUE_LABEL.room_v1 },
  { key: "room_v2",    label: VENUE_LABEL.room_v2 },
  { key: "room_v1_v2", label: VENUE_LABEL.room_v1_v2 },
  { key: "air_shared", label: VENUE_LABEL.air_shared },
  { key: "offsite",    label: "นอกสถานที่" },
];

function locationKey(e: CateringEvent): string {
  return e.location_type === "offsite" ? "offsite" : (e.venue ?? "offsite");
}

export function CalendarClient({
  initialEvents,
  year,
  month,
}: {
  initialEvents: CateringEvent[];
  year: number;
  month: number;
}) {
  const router = useRouter();

  function goMonth(delta: number) {
    let y = year, m = month + delta;
    if (m > 12) { y++; m = 1; }
    if (m < 1)  { y--; m = 12; }
    router.push(`/owner/catering/calendar?year=${y}&month=${m}`);
  }

  // Keyed by full date, not bare day-of-month — the grid now fetches beyond
  // the viewed month (see getCateringEventsForCalendar in actions.ts), so a
  // bare day number would collide between e.g. this month's 3rd and next
  // month's 3rd.
  const byDate = new Map<string, CateringEvent[]>();
  for (const e of initialEvents) {
    if (!byDate.has(e.event_date)) byDate.set(e.event_date, []);
    byDate.get(e.event_date)!.push(e);
  }

  const allCells = buildCalendarGrid(year, month);
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < allCells.length; i += 7) weeks.push(allCells.slice(i, i + 7));

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">←</button>
          <span className="min-w-[150px] text-center text-sm font-medium">
            {MONTHS_TH[month - 1]} {year + 543}
          </span>
          <button onClick={() => goMonth(1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">→</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
          {LEGEND.map((l) => (
            <span key={l.key} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${LOCATION_DOT[l.key]}`} />
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <div className="grid grid-cols-7 divide-x divide-neutral-700 bg-neutral-800 text-xs text-neutral-100">
          {DAYS_SHORT.map((d) => (
            <div key={d} className="px-2 py-2 text-center font-medium">{d}</div>
          ))}
        </div>
        <div className="divide-y divide-neutral-100">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 divide-x divide-neutral-100">
              {week.map((cell, di) => {
                const isToday = cell.inMonth && cell.dateStr === todayStr;
                const dayEvents = byDate.get(cell.dateStr) ?? [];
                return (
                  <div key={di} className={`min-h-[110px] space-y-1 p-1.5 ${isToday ? "bg-blue-50/60" : !cell.inMonth ? "bg-neutral-50/50" : ""}`}>
                    <div className={`text-xs font-medium ${isToday ? "text-blue-700" : cell.inMonth ? "text-neutral-500" : "text-neutral-300"}`}>{cell.day}</div>
                    {dayEvents.map((e) => (
                      <Link
                        key={e.id}
                        href={`/owner/catering/${e.id}`}
                        title={e.customer_name ?? "-"}
                        className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-neutral-100"
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${LOCATION_DOT[locationKey(e)]}`} />
                        <span className="truncate text-neutral-700">{e.customer_name ?? "-"}</span>
                        {e.start_time && <span className="shrink-0 text-neutral-400 tabular-nums">{toTimeInput(e.start_time)}</span>}
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
