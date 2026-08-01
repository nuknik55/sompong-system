export const dynamic = "force-dynamic";

import { requireHROrAdmin } from "@/lib/auth";
import { getEmployees, getDepartments, getLeaveTypes, getHolidays, getAttendanceDailyMonth, getApprovedLeavesForMonth, getSwapDatesForMonth } from "../actions";
import { AttendanceClient } from "./AttendanceClient";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; dept?: string }>;
}) {
  await requireHROrAdmin();
  const sp = await searchParams;
  const today = new Date();
  const year = sp.year ? parseInt(sp.year) : today.getFullYear();
  const month = sp.month ? parseInt(sp.month) : today.getMonth() + 1;
  const deptId = sp.dept ?? "";

  const [employees, departments, records, leaveTypes, holidays, leaveDays, swapDates] = await Promise.all([
    getEmployees(),
    getDepartments(),
    getAttendanceDailyMonth(year, month),
    getLeaveTypes(),
    getHolidays(year),
    getApprovedLeavesForMonth(year, month),
    getSwapDatesForMonth(year, month),
  ]);

  return (
    <AttendanceClient
      key={`${year}-${month}`}
      employees={employees.filter((e) => e.is_active)}
      departments={departments.filter((d) => d.is_active)}
      initialRecords={records}
      leaveTypes={leaveTypes.filter((lt) => lt.is_active)}
      holidays={holidays.filter((h) => h.is_active)}
      leaveDays={leaveDays}
      swapDates={swapDates}
      year={year}
      month={month}
      deptId={deptId}
    />
  );
}
