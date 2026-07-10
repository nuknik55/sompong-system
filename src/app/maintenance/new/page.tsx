import { requireProfile } from "@/lib/auth";
import { MaintenanceForm } from "@/app/maintenance/new/MaintenanceForm";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function NewMaintenancePage() {
  await requireProfile();
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <Link href="/maintenance" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800">
        <ChevronLeft className="h-4 w-4" /> รายการแจ้งซ่อม
      </Link>
      <h1 className="font-kanit text-lg font-semibold text-neutral-900 mb-6">แจ้งซ่อมบำรุง</h1>
      <MaintenanceForm mode="create" />
    </div>
  );
}
