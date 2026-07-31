export const dynamic = "force-dynamic";

import { requireHR } from "@/lib/auth";
import { getEmployees, getDepartments, getCompDayBalances, getProbationAlerts } from "../actions";
import { EmployeesClient } from "./EmployeesClient";

export default async function EmployeesPage() {
  const profile = await requireHR();
  const [employees, departments, balances, probationAlerts] = await Promise.all([
    getEmployees(),
    getDepartments(),
    getCompDayBalances(),
    getProbationAlerts(),
  ]);
  return (
    <EmployeesClient
      initialEmployees={employees}
      departments={departments}
      balances={balances}
      probationAlerts={probationAlerts}
      isOwner={profile.role === "owner"}
    />
  );
}
