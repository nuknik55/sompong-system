export const dynamic = "force-dynamic";

import { requireSales, isAdminOrAbove } from "@/lib/auth";
import { getCateringEvents } from "../actions";
import { CalendarClient } from "./CalendarClient";
import { CateringSubNav } from "@/components/catering-sub-nav";

export default async function CateringCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const profile = await requireSales();
  const sp = await searchParams;
  const today = new Date();
  const year = sp.year ? parseInt(sp.year) : today.getFullYear();
  const month = sp.month ? parseInt(sp.month) : today.getMonth() + 1;

  const events = await getCateringEvents(year, month);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <CateringSubNav isAdmin={isAdminOrAbove(profile.role)} />

      <h1 className="font-kanit text-lg font-semibold text-neutral-900">ปฏิทินการจอง</h1>
      <CalendarClient initialEvents={events} year={year} month={month} />
    </div>
  );
}
