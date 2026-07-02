import { requireProfile } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader profile={profile} />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
