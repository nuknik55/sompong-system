export const dynamic = "force-dynamic";

import { requireHR } from "@/lib/auth";
import { getEmployees } from "../../actions";
import { ReorderClient } from "./ReorderClient";

export default async function ReorderPage() {
  await requireHR();
  const employees = await getEmployees();
  return <ReorderClient initialEmployees={employees.filter((e) => e.is_active)} />;
}
