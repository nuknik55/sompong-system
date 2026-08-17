import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getPendingCount } from "@/lib/pending-data";
import { AppHeader } from "@/components/app-header";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  // staff have no access here; hr routes to /owner/hr/* (guarded by hr layout)
  //
  // This check is deliberately NEGATIVE (block staff only) and must stay that
  // way: /owner is a shared shell whose sub-trees each carry their own guard
  // (requireAdmin, requireHR, requireSales, ...). Roles that only own one
  // sub-tree — hr at /owner/hr/*, sales at /owner/catering/* — have to pass
  // through here to reach it. Narrowing this to an allowlist would lock them
  // out of their own pages.
  if (profile.role === "staff") redirect("/staff");
  const pendingCount = profile.role === "admin" ? await getPendingCount() : 0;
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppHeader profile={profile} pendingCount={pendingCount} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
