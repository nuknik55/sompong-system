export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireSales, isAdminOrAbove } from "@/lib/auth";
import { getCateringEvents, getCateringCustomers, getStaffOptions } from "./actions";
import { CateringClient } from "./CateringClient";

export default async function CateringPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const profile = await requireSales();
  const sp = await searchParams;
  const today = new Date();
  const year = sp.year ? parseInt(sp.year) : today.getFullYear();
  const month = sp.month ? parseInt(sp.month) : today.getMonth() + 1;

  const [events, customers, staffOptions] = await Promise.all([
    getCateringEvents(year, month),
    getCateringCustomers(),
    getStaffOptions(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">จองงานจัดเลี้ยง</h1>
        {isAdminOrAbove(profile.role) && (
          <div className="flex items-center gap-4 text-sm text-neutral-500">
            <Link href="/owner/catering/set-menus" className="hover:text-neutral-800">จัดการชุดเมนู</Link>
            <span className="text-neutral-200">|</span>
            <Link href="/owner/catering/settings" className="hover:text-neutral-800">ตั้งค่าอัตราค่าบริการ</Link>
          </div>
        )}
      </div>

      <CateringClient
        initialEvents={events}
        customers={customers}
        staffOptions={staffOptions}
        year={year}
        month={month}
        defaultStaffId={profile.employee_id}
      />
    </div>
  );
}
