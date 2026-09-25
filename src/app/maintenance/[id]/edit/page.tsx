import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getMaintenanceReport } from "@/lib/maintenance-data";
import { canEditReport } from "@/lib/maintenance-rules";
import { MaintenanceForm } from "@/app/maintenance/new/MaintenanceForm";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function EditMaintenancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, report] = await Promise.all([requireProfile(), getMaintenanceReport(id)]);
  if (!report) notFound();

  // The screen's mirror of maint_edit: the reporter or a head, only while
  // the report is new. Anyone else, or a report past new, goes to the report.
  if (!canEditReport(profile.role, report.reporterId === profile.id, report.status)) {
    redirect(`/maintenance/${id}`);
  }

  return (
    <PageShell>
      <PageHeader back={{ href: `/maintenance/${id}`, label: "ดูรายละเอียด" }} title="แก้ไขรายการแจ้งซ่อม" />
      <div className="max-w-lg">
        <MaintenanceForm mode="edit" existing={report} />
      </div>
    </PageShell>
  );
}
