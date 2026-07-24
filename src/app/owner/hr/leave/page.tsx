export const dynamic = "force-dynamic";

import { requireHROrAdmin } from "@/lib/auth";
import { getLeaveRequests, getEmployees, getLeaveTypes } from "../actions";
import { LeaveClient } from "./LeaveClient";

export default async function LeavePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string; status?: string }>;
}) {
  await requireHROrAdmin();
  const sp = await searchParams;
  const year = sp.year ? parseInt(sp.year) : new Date().getFullYear();
  const month = sp.month ? parseInt(sp.month) : undefined;
  const status = sp.status ?? "all";

  const [requests, employees, leaveTypes] = await Promise.all([
    getLeaveRequests({ year, month, status }),
    getEmployees(),
    getLeaveTypes(),
  ]);

  return (
    <LeaveClient
      initialRequests={requests}
      employees={employees.filter((e) => e.is_active)}
      leaveTypes={leaveTypes.filter((lt) => lt.is_active)}
      defaultYear={year}
      defaultMonth={month}
      defaultStatus={status}
    />
  );
}
