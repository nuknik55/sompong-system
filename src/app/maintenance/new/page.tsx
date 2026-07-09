import { requireProfile } from "@/lib/auth";
import { MaintenanceForm } from "@/app/maintenance/new/MaintenanceForm";

export default async function NewMaintenancePage() {
  await requireProfile();
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <a href="/maintenance" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← กลับ
        </a>
      </div>
      <h1 className="font-kanit mb-4 text-lg font-semibold text-neutral-900">แจ้งซ่อมบำรุง</h1>
      <MaintenanceForm />
    </div>
  );
}
