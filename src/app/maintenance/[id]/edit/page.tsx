import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getMaintenanceReport } from "@/lib/maintenance-data";
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

  const canManage = ["owner", "admin", "editor"].includes(profile.role);
  const isOwn = report.reporterId === profile.id;

  if (!isOwn && !canManage) redirect("/maintenance");
  if (report.status !== "new") redirect(`/maintenance/${id}`);

  return (
    <PageShell>
      <PageHeader back={{ href: `/maintenance/${id}`, label: "ดูรายละเอียด" }} title="แก้ไขรายการแจ้งซ่อม" />
      <div className="max-w-lg">
        <MaintenanceForm mode="edit" existing={report} />
      </div>
    </PageShell>
  );
}
