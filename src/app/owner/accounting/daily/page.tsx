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
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">บันทึกรายจ่ายรายวัน</h1>
        <nav className="flex gap-2 text-sm">
          <a
            href="/owner/accounting"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50"
          >
            บัญชีรายจ่าย
          </a>
          <span className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white">
            บันทึกรายวัน
          </span>
          <a
            href={`/owner/accounting/summary?month=${yearMonth}`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50"
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
