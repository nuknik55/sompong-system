import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getMaintenanceReport } from "@/lib/maintenance-data";
import { MaintenanceDetailClient } from "@/app/maintenance/[id]/MaintenanceDetailClient";

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, report] = await Promise.all([
    requireProfile(),
    getMaintenanceReport(id),
  ]);

  if (!report) notFound();

  const canManage = ["owner", "admin", "editor"].includes(profile.role);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="mb-4">
        <a href="/maintenance" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← รายการแจ้งซ่อม
        </a>
      </div>
      <MaintenanceDetailClient report={report} canManage={canManage} />
    </div>
  );
}
