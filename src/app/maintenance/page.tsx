import { requireProfile } from "@/lib/auth";
import { getMaintenanceReports } from "@/lib/maintenance-data";
import { MaintenanceListClient } from "@/app/maintenance/MaintenanceListClient";

export default async function MaintenancePage() {
  const [profile, reports] = await Promise.all([
    requireProfile(),
    getMaintenanceReports(),
  ]);

  const canManage = ["owner", "admin", "editor"].includes(profile.role);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-kanit text-xl font-semibold text-neutral-900">แจ้งซ่อมบำรุง</h1>
          <p className="text-sm text-neutral-500">{reports.length} รายการทั้งหมด</p>
        </div>
        <a
          href="/maintenance/new"
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90"
          style={{ backgroundColor: "#2F5A16" }}
        >
          + แจ้งซ่อม
        </a>
      </div>
      <MaintenanceListClient reports={reports} canManage={canManage} />
    </div>
  );
}
