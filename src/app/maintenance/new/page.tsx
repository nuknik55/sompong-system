import { requireProfile } from "@/lib/auth";
import { MaintenanceForm } from "@/app/maintenance/new/MaintenanceForm";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function NewMaintenancePage() {
  await requireProfile();
  return (
    <PageShell>
      <PageHeader back={{ href: "/maintenance", label: "รายการแจ้งซ่อม" }} title="แจ้งซ่อมบำรุง" />
      <div className="max-w-lg">
        <MaintenanceForm mode="create" />
      </div>
    </PageShell>
  );
}
