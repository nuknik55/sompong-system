export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getEmployees, getDepartments } from "../actions";
import { EmployeesClient } from "./EmployeesClient";

export default async function EmployeesPage() {
  const profile = await requireAdmin();
  const [employees, departments] = await Promise.all([getEmployees(), getDepartments()]);
  return (
    <EmployeesClient
      initialEmployees={employees}
      departments={departments}
      isOwner={profile.role === "owner"}
    />
  );
}
