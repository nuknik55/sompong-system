import { redirect } from "next/navigation";
import { requireHROrAdmin } from "@/lib/auth";

export default async function HRPage() {
  const profile = await requireHROrAdmin();
  if (profile.role === "admin") {
    redirect("/owner/hr/leave");
  }
  redirect("/owner/hr/employees");
}
