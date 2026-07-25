import { requireHROrAdmin } from "@/lib/auth";
import { HRNav } from "./HRNav";

export default async function HRLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireHROrAdmin();
  const adminOnly = profile.role === "admin";

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 pb-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">ฝ่ายบุคคล</h1>
        <HRNav adminOnly={adminOnly} />
      </div>
      {children}
    </div>
  );
}
