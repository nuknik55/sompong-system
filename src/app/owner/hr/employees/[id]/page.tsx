export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getEmployee, getDepartments, getLeaveRequests, getPayrollEntries, getPayrollPeriods } from "../../actions";
import { EmployeeDetailClient } from "./EmployeeDetailClient";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const [employee, departments, leaveRequests, periods] = await Promise.all([
    getEmployee(id),
    getDepartments(),
    getLeaveRequests({ employeeId: id }),
    getPayrollPeriods(),
  ]);

  if (!employee) notFound();

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
        periods={periods}
      />
    </div>
  );
}
