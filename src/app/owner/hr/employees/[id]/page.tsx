export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireHR } from "@/lib/auth";
import {
  getEmployee,
  getDepartments,
  getLeaveRequests,
  getEmployeePayrollHistory,
  getLeaveQuotas,
  getCompDayBalances,
  getDaySwapRequests,
  getAttendanceYearSummary,
} from "../../actions";
import { EmployeeDetailClient } from "./EmployeeDetailClient";

const TAB_KEYS = ["info", "summary", "leave", "payroll"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ year?: string; tab?: string }>;
}) {
  await requireHR();
  const { id } = await params;
  const sp = await searchParams;
  const year = sp.year ? parseInt(sp.year) : new Date().getFullYear();
  const initialTab: TabKey = TAB_KEYS.includes(sp.tab as TabKey) ? (sp.tab as TabKey) : "info";

  const [employee, departments, leaveRequests, payrollHistory, allQuotas, allBalances, daySwaps, attendanceSummary] =
    await Promise.all([
      getEmployee(id),
      getDepartments(),
      getLeaveRequests({ employeeId: id }),
      getEmployeePayrollHistory(id),
      getLeaveQuotas(year),
      getCompDayBalances(),
      getDaySwapRequests(year),
      getAttendanceYearSummary(id, year),
    ]);

  if (!employee) notFound();

  const quota = allQuotas.find((q) => q.employee_id === id) ?? null;
  const balance = allBalances.find((b) => b.employee_id === id) ?? null;
  const myDaySwaps = daySwaps.filter((d) => d.employee_id === id);

  return (
    <div>
      <div className="mb-4">
        <Link href="/owner/hr/employees" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← พนักงานทั้งหมด
        </Link>
      </div>
      <EmployeeDetailClient
        employee={employee}
        departments={departments}
        leaveRequests={leaveRequests}
        payrollHistory={payrollHistory}
        quota={quota}
        compBalance={balance}
        daySwaps={myDaySwaps}
        attendanceSummary={attendanceSummary}
        defaultYear={year}
        initialTab={initialTab}
      />
    </div>
  );
}
