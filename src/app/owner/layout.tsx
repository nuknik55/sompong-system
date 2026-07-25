import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getPendingCount } from "@/lib/pending-data";
import { AppHeader } from "@/components/app-header";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  // staff have no access here; hr routes to /owner/hr/* (guarded by hr layout)
  if (profile.role === "staff") redirect("/staff");
  const pendingCount = profile.role === "admin" ? await getPendingCount() : 0;
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppHeader profile={profile} pendingCount={pendingCount} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
