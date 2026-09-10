export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getRecentEntries, getStartOfMonthChecklist } from "./actions";
import { AccountingEntryClient } from "./AccountingEntryClient";
import { ToolRow } from "./tool-row";
import { ChecklistPanel } from "./ChecklistPanel";

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await requireAdmin();

  const { month: rawMonth } = await searchParams;
  const today = new Date();
  const yearMonth =
    rawMonth?.match(/^\d{4}-\d{2}$/) ? rawMonth : today.toISOString().slice(0, 7);

  const [{ entries, withheldCount }, checklist] = await Promise.all([getRecentEntries(yearMonth), getStartOfMonthChecklist()]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">ดูทั้งเดือน</h1>
      </div>

      <ToolRow role={profile.role} yearMonth={yearMonth} />

      {/* The month that just closed, until every step is satisfied. */}
      <ChecklistPanel checklist={checklist} role={profile.role} />

      <AccountingEntryClient
        initialEntries={entries}
        withheldCount={withheldCount}
        yearMonth={yearMonth}
      />
    </div>
  );
}
