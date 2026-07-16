export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getCoa, getEntriesByDate } from "../actions";
import { DailyEntryClient } from "./DailyEntryClient";

export default async function DailyEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const profile = await requireAdmin();

  const { date: rawDate } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = rawDate?.match(/^\d{4}-\d{2}-\d{2}$/) ? rawDate : today;

  const [coa, entries] = await Promise.all([getCoa(), getEntriesByDate(date)]);

  const yearMonth = date.slice(0, 7);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      {/* Nav */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">บันทึกรายจ่ายรายวัน</h1>
        <nav className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 text-sm">
          <span className="rounded-lg bg-white px-4 py-1.5 font-medium text-neutral-900 shadow-sm">
            บันทึกรายวัน
          </span>
          <a
            href={`/owner/accounting?month=${yearMonth}`}
            className="rounded-lg px-4 py-1.5 text-neutral-500 hover:text-neutral-800"
            title="ดูรายการทั้งหมดของเดือน"
          >
            ดูทั้งเดือน
          </a>
          <a
            href={`/owner/accounting/summary?month=${yearMonth}`}
            className="rounded-lg px-4 py-1.5 text-neutral-500 hover:text-neutral-800"
            title="สรุปต้นทุนเทียบงบประมาณ"
          >
            สรุปรายเดือน
          </a>
        </nav>
      </div>

      <DailyEntryClient
        key={date}
        coa={coa}
        initialEntries={entries}
        date={date}
        isOwner={profile.role === "owner"}
      />
    </div>
  );
}
