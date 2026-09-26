export const dynamic = "force-dynamic";

import { requireHROrAdmin } from "@/lib/auth";
import { getEmployees, getDepartments, getHolidays, getScheduleWeek, getApprovedLeavesForWeek, getSwapDatesForWeek } from "../actions";
import { ScheduleClient } from "./ScheduleClient";
import { bangkokToday, startOfWeek } from "@/lib/bangkok-date";

function getMondayOf(dateStr: string): string {
  // "T00:00:00" with no zone is parsed in the RUNTIME's zone and read back in
  // UTC, so this returned the Monday before the right one west of Greenwich.
  // startOfWeek is UTC throughout (src/lib/bangkok-date.ts).
  return startOfWeek(dateStr, 1);
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; dept?: string }>;
}) {
  const profile = await requireHROrAdmin();
  // Every write on this screen is requireHR (owner, hr); admin reads it only.
  const canEdit = profile.role === "owner" || profile.role === "hr";
  const sp = await searchParams;

  const today = bangkokToday();
  const weekStart = sp.week ? getMondayOf(sp.week) : getMondayOf(today);
  const deptId = sp.dept ?? "";

  const year = parseInt(weekStart.slice(0, 4));

  const [employees, departments, notes, leaveDays, holidays, nextYearHolidays, swapDates] = await Promise.all([
    getEmployees(),
    getDepartments(),
    getScheduleWeek(weekStart),
    getApprovedLeavesForWeek(weekStart),
    getHolidays(year),
    getHolidays(year + 1),
    getSwapDatesForWeek(weekStart),
  ]);

  return (
    <ScheduleClient
      canEdit={canEdit}
      employees={employees.filter((e) => e.is_active)}
      departments={departments.filter((d) => d.is_active)}
      notes={notes}
      leaveDays={leaveDays}
      holidays={[...holidays, ...nextYearHolidays].filter((h) => h.is_active)}
      weekStart={weekStart}
      deptId={deptId}
      swapDates={swapDates}
    />
  );
}
