import { requireProfile } from "@/lib/auth";
import Link from "next/link";
import { getMaintenanceReports } from "@/lib/maintenance-data";
import { MaintenanceListClient } from "@/app/maintenance/MaintenanceListClient";
import { buttonClass } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function MaintenancePage() {
  const [profile, reports] = await Promise.all([
    requireProfile(),
    getMaintenanceReports(),
  ]);

  const canManage = ["owner", "admin", "editor"].includes(profile.role);

  return (
    <PageShell>
      <PageHeader
        title="แจ้งซ่อมบำรุง"
        subtitle={<span>{reports.length} รายการทั้งหมด</span>}
        actions={
          <Link href="/maintenance/new" className={buttonClass("primary")}>
            + แจ้งซ่อม
          </Link>
        }
      />
      <MaintenanceListClient reports={reports} canManage={canManage} currentUserId={profile.id} />
    </PageShell>
  );
}
