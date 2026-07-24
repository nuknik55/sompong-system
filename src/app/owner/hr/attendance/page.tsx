export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getEmployees, getAttendancePunches } from "../actions";
import { AttendanceClient } from "./AttendanceClient";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; year?: string; month?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const today = new Date();
  const year = sp.year ? parseInt(sp.year) : today.getFullYear();
  const month = sp.month ? parseInt(sp.month) : today.getMonth() + 1;

  const employees = await getEmployees();
  const employeeId = sp.employee ?? (employees.find((e) => e.is_active)?.id ?? "");

  const punches = employeeId ? await getAttendancePunches(employeeId, year, month) : [];

  return (
    <AttendanceClient
      employees={employees.filter((e) => e.is_active)}
      initialPunches={punches}
      selectedEmployeeId={employeeId}
      year={year}
      month={month}
    />
  );
}
