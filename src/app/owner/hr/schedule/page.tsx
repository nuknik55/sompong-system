export const dynamic = "force-dynamic";

import { requireHROrAdmin } from "@/lib/auth";
import { getEmployees, getDepartments, getHolidays, getScheduleWeek } from "../actions";
import { ScheduleClient } from "./ScheduleClient";

function getMondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; dept?: string }>;
}) {
  await requireHROrAdmin();
  const sp = await searchParams;

  const today = new Date().toISOString().slice(0, 10);
  const weekStart = sp.week ? getMondayOf(sp.week) : getMondayOf(today);
  const deptId = sp.dept ?? "";

  const year = parseInt(weekStart.slice(0, 4));

  const [employees, departments, notes, holidays, nextYearHolidays] = await Promise.all([
    getEmployees(),
    getDepartments(),
    getScheduleWeek(weekStart),
    getHolidays(year),
    getHolidays(year + 1),
  ]);

  return (
    <ScheduleClient
      employees={employees.filter((e) => e.is_active)}
      departments={departments.filter((d) => d.is_active)}
      notes={notes}
      holidays={[...holidays, ...nextYearHolidays].filter((h) => h.is_active)}
      weekStart={weekStart}
      deptId={deptId}
    />
  );
}
