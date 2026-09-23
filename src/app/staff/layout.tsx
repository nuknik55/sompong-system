import { requireProfile } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { canManageMaintenance, getOpenRepairCount } from "@/lib/maintenance-data";
import { getReviewQueueCount } from "@/lib/inventory-data";
import { isOrderHead } from "@/lib/order-rules";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const openRepairCount = canManageMaintenance(profile.role) ? await getOpenRepairCount() : 0;
  const orderReviewCount = isOrderHead(profile.role) ? await getReviewQueueCount() : 0;
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppHeader profile={profile} openRepairCount={openRepairCount} orderReviewCount={orderReviewCount} />
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
