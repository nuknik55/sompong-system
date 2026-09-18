export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { bangkokToday } from "@/lib/bangkok-date";
import { getCapexThreshold } from "@/lib/data";
import { getCoa, getEntriesByDate, getSuppliers } from "../actions";
import { DailyEntryClient } from "./DailyEntryClient";
import { ToolRow } from "../tool-row";

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
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      {/* Nav */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href={`/owner/accounting?month=${yearMonth}`} className="text-sm text-neutral-400 hover:text-neutral-700">← ดูทั้งเดือน</a>
          <span className="text-neutral-300 text-sm">/</span>
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">บันทึกรายวัน</h1>
        </div>
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
    </div>
  );
}
