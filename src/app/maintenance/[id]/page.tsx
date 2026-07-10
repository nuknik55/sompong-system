import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getMaintenanceReport } from "@/lib/maintenance-data";
import { MaintenanceDetailClient } from "@/app/maintenance/[id]/MaintenanceDetailClient";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, report] = await Promise.all([requireProfile(), getMaintenanceReport(id)]);
  if (!report) notFound();

  const canManage = ["owner", "admin", "editor"].includes(profile.role);
  const isOwn = report.reporterId === profile.id;

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <Link href="/maintenance" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800">
        <ChevronLeft className="h-4 w-4" /> รายการแจ้งซ่อม
      </Link>
      <MaintenanceDetailClient report={report} canManage={canManage} isOwn={isOwn} />
    </div>
  );
}
