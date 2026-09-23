export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getRecentEntries, getStartOfMonthChecklist } from "./actions";
import { bangkokYearMonth } from "@/lib/bangkok-date";
import { AccountingEntryClient } from "./AccountingEntryClient";
import { ToolRow } from "./tool-row";
import { ChecklistPanel } from "./ChecklistPanel";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await requireAdmin();

  const { month: rawMonth } = await searchParams;
  const yearMonth = rawMonth?.match(/^\d{4}-\d{2}$/) ? rawMonth : bangkokYearMonth();

  const [{ entries }, checklist] = await Promise.all([getRecentEntries(yearMonth), getStartOfMonthChecklist()]);

  return (
    <PageShell>
      <PageHeader title="ดูทั้งเดือน" />

      <ToolRow role={profile.role} yearMonth={yearMonth} />

      {/* The month that just closed, until every step is satisfied. */}
      <ChecklistPanel checklist={checklist} role={profile.role} />

      <AccountingEntryClient
        initialEntries={entries}
        yearMonth={yearMonth}
      />
    </PageShell>
  );
}
