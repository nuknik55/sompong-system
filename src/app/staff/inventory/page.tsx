import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getOrderSessions, getStations, getAllStationTemplates } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import { FromTemplateButton } from "./FromTemplateButton";
import { InventoryListClient } from "./InventoryListClient";

export default async function InventoryListPage() {
  const [profile, allSessions, stations, allTemplates] = await Promise.all([
    requireProfile(),
    getOrderSessions(),
    getStations(),
    getAllStationTemplates().catch(() => ({} as Record<string, unknown[]>)),
  ]);

  const canReview = ["owner", "admin", "editor"].includes(profile.role);
  const canManageTemplate = canReview;
  const stationsWithTemplate = stations.filter((s) => (allTemplates[s.id]?.length ?? 0) > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate={canManageTemplate} canReview={canReview} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">งานของฉัน</h1>
          <p className="text-xs text-neutral-400 mt-0.5">ใบสั่งของที่ฉันสร้าง + รายการรอรับของ</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {stationsWithTemplate.length > 0 && (
            <FromTemplateButton stations={stationsWithTemplate} />
          )}
          <Link
            href="/staff/inventory/new"
            className="rounded-md px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "#2F5A16" }}
          >
            + เช็คของ / สั่งของ
          </Link>
        </div>
      </div>

      <InventoryListClient sessions={allSessions} currentUserId={profile.id} />
    </div>
  );
}
