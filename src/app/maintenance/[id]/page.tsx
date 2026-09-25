import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getMaintenanceReport } from "@/lib/maintenance-data";
import { MaintenanceDetailClient } from "@/app/maintenance/[id]/MaintenanceDetailClient";
import { PageShell } from "@/components/ui/page";

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, report] = await Promise.all([requireProfile(), getMaintenanceReport(id)]);
  if (!report) notFound();

  const isReporter = report.reporterId === profile.id;

  return (
    // The page header (← รายการแจ้งซ่อม, the report, its status) is in
    // MaintenanceDetailClient, beside the actions it drives.
    <PageShell>
      <MaintenanceDetailClient report={report} role={profile.role} isReporter={isReporter} />
    </PageShell>
  );
}
