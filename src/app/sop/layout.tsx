import { requireProfile } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";

export default async function SopLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader profile={profile} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
