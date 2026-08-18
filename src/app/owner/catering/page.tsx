export const dynamic = "force-dynamic";

import { requireSales } from "@/lib/auth";
import { getCateringEvents, getCateringCustomers, getStaffOptions } from "./actions";
import { CateringClient } from "./CateringClient";

export default async function CateringPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  await requireSales();
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">จองงานจัดเลี้ยง</h1>
      </div>

      <CateringClient
        initialEvents={events}
        customers={customers}
        staffOptions={staffOptions}
        year={year}
        month={month}
      />
    </div>
  );
}
