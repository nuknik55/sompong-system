export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getCoa, getEntriesByDate, getSuppliers } from "../actions";
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

  const [coa, entries, suppliers] = await Promise.all([getCoa(), getEntriesByDate(date), getSuppliers()]);

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
        <div className="flex items-center gap-4 text-sm text-neutral-400">
          <a href={`/owner/accounting/summary?month=${yearMonth}`} className="hover:text-neutral-700">สรุปรายเดือน</a>
          <a href="/owner/accounting/transfer-slip" className="hover:text-neutral-700">ใบโอนเงิน</a>
          <a href="/owner/accounting/coa" className="hover:text-neutral-700">จัดการหมวด</a>
        </div>
      </div>

      <DailyEntryClient
        key={date}
        coa={coa}
        initialEntries={entries}
        date={date}
        isOwner={profile.role === "owner"}
        suppliers={suppliers}
      />
    </div>
  );
}
