export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireSales } from "@/lib/auth";
import { getCateringEvents } from "../actions";
import { CalendarClient } from "./CalendarClient";

export default async function CateringCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  await requireSales();
  const sp = await searchParams;
  const today = new Date();
  const year = sp.year ? parseInt(sp.year) : today.getFullYear();
  const month = sp.month ? parseInt(sp.month) : today.getMonth() + 1;

  const events = await getCateringEvents(year, month);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/owner/catering" className="text-sm text-neutral-400 hover:text-neutral-700">← จองงานจัดเลี้ยง</Link>
        <span className="text-sm text-neutral-300">/</span>
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">ปฏิทินการจอง</h1>
      </div>
      <CalendarClient initialEvents={events} year={year} month={month} />
    </div>
  );
}
