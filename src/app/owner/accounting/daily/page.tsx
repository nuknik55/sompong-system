export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { bangkokToday } from "@/lib/bangkok-date";
import { getCapexThreshold } from "@/lib/data";
import { getCoa, getEntriesByDate, getSuppliers } from "../actions";
import { DailyEntryClient } from "./DailyEntryClient";
import { ToolRow } from "../tool-row";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function DailyEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const profile = await requireAdmin();

  const { date: rawDate } = await searchParams;
  // The restaurant's day, not the UTC one: before 07:00 in Bangkok this page
  // opened on yesterday's entries (fixed 2026-09-19, the day version of the
  // month defect fixed the day before).
  const today = bangkokToday();
  const date = rawDate?.match(/^\d{4}-\d{2}-\d{2}$/) ? rawDate : today;

  const [coa, { entries }, suppliers, capexThreshold] = await Promise.all([
    getCoa(),
    getEntriesByDate(date),
    getSuppliers(),
    getCapexThreshold(),
  ]);

  const yearMonth = date.slice(0, 7);

  return (
    <PageShell>
      {/* Nav (not on the printed sheet) */}
      <div className="no-print">
        <PageHeader back={{ href: `/owner/accounting?month=${yearMonth}`, label: "ดูทั้งเดือน", reload: true }} title="บันทึกรายวัน" />
      </div>
      <ToolRow role={profile.role} yearMonth={yearMonth} current="daily" />

      <DailyEntryClient
        key={date}
        coa={coa}
        entries={entries}
        date={date}
        suppliers={suppliers}
        capexThreshold={capexThreshold}
      />
    </PageShell>
  );
}
