import { requireAdminOrEditor } from "@/lib/auth";
import { getPendingCount } from "@/lib/pending-data";
import { AppHeader } from "@/components/app-header";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAdminOrEditor();
  // Fetch pending badge count only for admin (editor/staff don't see the approve nav item)
  const pendingCount = profile.role === "admin" ? await getPendingCount() : 0;
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader profile={profile} pendingCount={pendingCount} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
