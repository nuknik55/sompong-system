import { requireProfile } from "@/lib/auth";
import { getOrderSessions, getStations, getTemplates } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import { InventoryListClient } from "./InventoryListClient";

export default async function InventoryListPage() {
  const [profile, allSessions, stations, templates] = await Promise.all([
    requireProfile(),
    getOrderSessions(),
    getStations(),
    getTemplates(),
  ]);

  const canReview = ["owner", "admin", "editor"].includes(profile.role);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate={canReview} canReview={canReview} />
      <InventoryListClient
        sessions={allSessions}
        currentUserId={profile.id}
        templates={templates}
      />
    </div>
  );
}
