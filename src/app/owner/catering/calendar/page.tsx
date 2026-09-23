export const dynamic = "force-dynamic";

import { requireSales, isAdminOrAbove } from "@/lib/auth";
import { getCateringEventsForCalendar } from "../actions";
import { CalendarClient } from "./CalendarClient";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { PageHeader, PageShell } from "@/components/ui/page";

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

  const events = await getCateringEventsForCalendar(year, month);

  return (
    <PageShell>
      <CateringSubNav isAdmin={isAdminOrAbove(profile.role)} />

      <PageHeader title="ปฏิทินการจอง" />
      <CalendarClient initialEvents={events} year={year} month={month} />
    </PageShell>
  );
}
