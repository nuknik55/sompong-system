import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getMaintenanceReport } from "@/lib/maintenance-data";
import { MaintenanceForm } from "@/app/maintenance/new/MaintenanceForm";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

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
    <div className="mx-auto max-w-lg px-4 py-6">
      <Link href={`/maintenance/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800">
        <ChevronLeft className="h-4 w-4" /> ดูรายละเอียด
      </Link>
      <h1 className="font-kanit text-lg font-semibold text-neutral-900 mb-6">แก้ไขรายการแจ้งซ่อม</h1>
      <MaintenanceForm mode="edit" existing={report} />
    </div>
  );
}
