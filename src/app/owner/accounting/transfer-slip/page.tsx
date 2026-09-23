export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { bangkokToday, startOfWeek } from "@/lib/bangkok-date";
import { getWeeklyTransferData } from "../actions";
import { TransferSlipClient } from "./TransferSlipClient";
import { PageHeader, PageShell } from "@/components/ui/page";

function prevTuesday(from?: string): string {
  // The Tuesday on or before the day, in Bangkok. It used to read the clock
  // as UTC and the weekday in the server's zone: before 07:00 on a Tuesday
  // the page opened on the week before.
  return startOfWeek(from ?? bangkokToday(), 2);
}

export default async function TransferSlipPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdmin();
  const { week: rawWeek } = await searchParams;
  const tuesday = rawWeek?.match(/^\d{4}-\d{2}-\d{2}$/) ? rawWeek : prevTuesday();

  const { rows, days, unlinkedCount } = await getWeeklyTransferData(tuesday);

  return (
    <PageShell>
      <div className="no-print">
        <PageHeader back={{ href: "/owner/accounting", label: "บัญชี", reload: true }} title="ใบโอนเงิน" />
      </div>

      <TransferSlipClient tuesday={tuesday} rows={rows} days={days} unlinkedCount={unlinkedCount} />
    </PageShell>
  );
}
