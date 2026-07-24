import Link from "next/link";
import { requireHROrAdmin } from "@/lib/auth";

export default async function HRLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireHROrAdmin();
  const adminOnly = profile.role === "admin";

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 pb-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">ฝ่ายบุคคล</h1>
        <nav className="flex flex-wrap items-center gap-4 text-sm text-neutral-500">
          {!adminOnly && (
            <>
              <Link href="/owner/hr/employees" className="hover:text-neutral-800">พนักงาน</Link>
              <span className="text-neutral-200">|</span>
            </>
          )}
          <Link href="/owner/hr/leave" className="hover:text-neutral-800">ใบลา</Link>
          <span className="text-neutral-200">|</span>
          <Link href="/owner/hr/attendance" className="hover:text-neutral-800">บันทึกเวลา</Link>
          {!adminOnly && (
            <>
              <span className="text-neutral-200">|</span>
              <Link href="/owner/hr/payroll" className="hover:text-neutral-800">เงินเดือน</Link>
              <span className="text-neutral-200">|</span>
              <Link href="/owner/hr/settings" className="hover:text-neutral-800">ตั้งค่า</Link>
            </>
          )}
        </nav>
      </div>
      {children}
    </div>
  );
}
