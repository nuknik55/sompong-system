export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getWeeklyTransferData } from "../actions";
import { TransferSlipClient } from "./TransferSlipClient";

function prevTuesday(from?: string): string {
  const d = from ? new Date(from) : new Date();
  const day = d.getDay(); // 0=Sun,1=Mon,...2=Tue
  const diff = day === 2 ? 0 : day < 2 ? day + 5 : day - 2;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
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
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href="/owner/accounting" className="text-sm text-neutral-400 hover:text-neutral-700">← บัญชี</a>
          <span className="text-neutral-300 text-sm">/</span>
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">ใบโอนเงิน</h1>
        </div>
      </div>

      <TransferSlipClient tuesday={tuesday} rows={rows} days={days} unlinkedCount={unlinkedCount} />
    </div>
  );
}
