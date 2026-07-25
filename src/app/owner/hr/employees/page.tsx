export const dynamic = "force-dynamic";

import { requireHR } from "@/lib/auth";
import { getEmployees, getDepartments, getCompDayBalances } from "../actions";
import { EmployeesClient } from "./EmployeesClient";

export default async function EmployeesPage() {
  const profile = await requireHR();
  const [employees, departments, balances] = await Promise.all([
    getEmployees(),
    getDepartments(),
    getCompDayBalances(),
  ]);
  return (
    <EmployeesClient
      initialEmployees={employees}
      departments={departments}
      balances={balances}
      isOwner={profile.role === "owner"}
    />
  );
}
