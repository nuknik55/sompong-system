import { requireProfile } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { canManageMaintenance, getOpenRepairCount } from "@/lib/maintenance-data";

export default async function MaintenanceLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const openRepairCount = canManageMaintenance(profile.role) ? await getOpenRepairCount() : 0;
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppHeader profile={profile} openRepairCount={openRepairCount} />
      <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
