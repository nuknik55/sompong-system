export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMonthlySummary, getMonthlyRevenue, getPosImportedAt } from "../actions";
import { completenessNotices, profitJudgementAllowed } from "./completeness";
import { RevenueEntryClient } from "./RevenueEntryClient";

function formatBaht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctBar(pct: number, target: number | null) {
  const color = target == null ? "bg-neutral-300"
    : pct > target + 3 ? "bg-red-400"
    : pct > target ? "bg-amber-400"
    : "bg-brand-green";
  const width = Math.min(pct * 2, 100);
  return <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${width}%` }} />;
}

function getThaiMonth(yearMonth: string) {
  const MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${(y ?? 2568) + 543}`;
}

export default async function AccountingSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await requireAdmin();
  if (!profile) redirect("/staff");

  const { month: rawMonth } = await searchParams;
  const today = new Date().toISOString().slice(0, 7);
  const yearMonth = rawMonth?.match(/^\d{4}-\d{2}$/) ? rawMonth : today;

  const [summary, revenueRows, importedAt] = await Promise.all([
    getMonthlySummary(yearMonth),
    getMonthlyRevenue(yearMonth),
    getPosImportedAt(yearMonth),
  ]);

  const revenueMap = Object.fromEntries(revenueRows.map((r) => [r.revenue_type, r.amount]));
  const totalRevenue = summary.totalRevenue;

  const [y, m] = yearMonth.split("-").map(Number);
  const prevMonth = new Date(y!, m! - 2, 1).toISOString().slice(0, 7);
  const nextMonth = new Date(y!, m!, 1).toISOString().slice(0, 7);
  const isCurrentMonth = yearMonth === today;

  // Operating profit: CapEx and Tax are deliberately NOT subtracted, so that a
  // month containing a large capital purchase stays comparable with the month
  // before it. Both are displayed below the line instead. See
  // NON_OPERATING_GROUPS in ../actions.ts for the full reasoning.
  const operatingProfit = totalRevenue - summary.operatingExpense;
  const profitPct = totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : null;

  const notices = completenessNotices(summary);
  // On an incomplete month the profit figure still shows, but without its
  // red/amber/green verdict — July 2569's 78.2% renders green otherwise, which
  // reads as an excellent month rather than as half the costs.
  const profitHighlight =
    profitPct !== null && profitJudgementAllowed(summary)
      ? profitPct < 10
        ? "red"
        : profitPct < 15
          ? "amber"
          : "green"
      : undefined;
  const profitColor = !profitJudgementAllowed(summary)
    ? "text-neutral-900"
    : operatingProfit < 0
      ? "text-red-600"
      : "text-brand-green";

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href={`/owner/accounting?month=${yearMonth}`} className="text-sm text-neutral-400 hover:text-neutral-700">← ดูทั้งเดือน</a>
          <span className="text-neutral-300 text-sm">/</span>
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">สรุปรายเดือน</h1>
        </div>
        <div className="flex items-center gap-4 text-sm text-neutral-400">
          <a href={`/owner/accounting/daily`} className="hover:text-neutral-700">บันทึกรายวัน</a>
          <a href="/owner/accounting/coa" className="hover:text-neutral-700">จัดการหมวด</a>
          <a
            href={`/owner/accounting/summary/print?month=${yearMonth}`}
            className="rounded border border-neutral-300 px-2.5 py-1 text-neutral-700 hover:bg-neutral-50"
          >
            พิมพ์ / Export P&amp;L
          </a>
        </div>
      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-3">
        <a href={`/owner/accounting/summary?month=${prevMonth}`}
          className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">‹</a>
        <span className="font-medium text-neutral-800">{getThaiMonth(yearMonth)}</span>
        {!isCurrentMonth && (
          <a href={`/owner/accounting/summary?month=${nextMonth}`}
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">›</a>
        )}
      </div>

      {/* Revenue entry */}
      <RevenueEntryClient yearMonth={yearMonth} initialRevenue={revenueMap as Record<string, number>} importedAt={importedAt} />

      {totalRevenue === 0 ? (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          ยังไม่ได้กรอกรายได้เดือนนี้ — กรอกก่อนเพื่อดู % ต้นทุน
        </p>
      ) : null}

      {notices.map((n) => (
        <p key={n} className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {n}
        </p>
      ))}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="รายได้รวม" value={`${formatBaht(totalRevenue)} ฿`} />
        <KpiCard label="ค่าใช้จ่ายดำเนินงาน" value={`${formatBaht(summary.operatingExpense)} ฿`} />
        <KpiCard
          label="% ต้นทุนดำเนินงาน"
          value={totalRevenue > 0 ? `${((summary.operatingExpense / totalRevenue) * 100).toFixed(1)}%` : "—"}
        />
        <KpiCard
          label="กำไรจากการดำเนินงาน"
          value={totalRevenue > 0 ? `${formatBaht(operatingProfit)} ฿` : "—"}
          highlight={profitHighlight}
        />
      </div>

      {/* Cost Structure table */}
      <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
            <tr className="border-b border-neutral-200">
              <th className="px-4 py-2">หมวด</th>
              <th className="px-4 py-2 text-right">จำนวน (฿)</th>
              <th className="px-4 py-2 text-right w-20">% จริง</th>
              <th className="px-4 py-2 text-right w-20">% เป้า</th>
              <th className="px-4 py-2 w-24">แถบ</th>
            </tr>
          </thead>
          <tbody>
            {summary.groups.map((g) => (
              <>
                {/* Group header row */}
                <tr key={g.group_code} className="border-t border-neutral-200 bg-neutral-50">
                  <td className="px-4 py-2 font-medium text-neutral-800">{g.group_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium">
                    {g.total > 0 ? formatBaht(g.total) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {g.pct_of_revenue != null ? `${g.pct_of_revenue.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-400">
                    {g.target_pct != null ? `${g.target_pct}%` : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {g.pct_of_revenue != null && pctBar(g.pct_of_revenue, g.target_pct)}
                  </td>
                </tr>
                {/* Account detail rows */}
                {g.accounts.map((a) => (
                  <tr key={a.code} className="border-t border-neutral-100">
                    <td className="pl-8 pr-4 py-1.5 text-neutral-500">{a.name}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-neutral-600">
                      {formatBaht(a.total)}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-neutral-400 text-xs">
                      {a.pct_of_revenue != null ? `${a.pct_of_revenue.toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-1.5" />
                    <td className="px-4 py-1.5" />
                  </tr>
                ))}
              </>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-neutral-300 bg-neutral-50">
            <tr>
              <td className="px-4 py-2 font-semibold text-neutral-900">
                รวมค่าใช้จ่ายดำเนินงาน
                {summary.withheldAccounts > 0 && (
                  <span className="ml-2 text-xs font-normal text-neutral-500">มีบัญชีที่ไม่แสดง {summary.withheldAccounts} บัญชี — ยอดนี้ไม่รวม</span>
                )}
              </td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatBaht(summary.operatingExpense)}</td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">
                {totalRevenue > 0 ? `${((summary.operatingExpense / totalRevenue) * 100).toFixed(1)}%` : "—"}
              </td>
              <td colSpan={2} />
            </tr>
            {totalRevenue > 0 && (
              <tr className="border-t border-neutral-200">
                <td className="px-4 py-2 font-semibold text-neutral-900">กำไรจากการดำเนินงาน</td>
                {/* Same reasoning as the KPI card: on an incomplete month the
                    figure is shown but not coloured, because green on 78.2%
                    is a verdict the data cannot support. */}
                <td className={`px-4 py-2 text-right tabular-nums font-semibold ${profitColor}`}>
                  {formatBaht(operatingProfit)}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums font-semibold ${profitColor}`}>
                  {profitPct != null ? `${profitPct.toFixed(1)}%` : "—"}
                </td>
                <td colSpan={2} />
              </tr>
            )}
            {/* Below the line: shown, never subtracted. A capital purchase or a
                tax payment is not a trading result, and folding either into the
                profit line makes months incomparable. */}
            {summary.nonOperating.map((g) => (
              <tr key={g.group_code} className="border-t border-neutral-200 text-neutral-500">
                <td className="px-4 py-2">
                  {g.group_name}
                  <span className="ml-2 text-xs text-neutral-400">(ไม่หักจากกำไรดำเนินงาน)</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{formatBaht(g.total)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-neutral-400">
                  {totalRevenue > 0 ? `${((g.total / totalRevenue) * 100).toFixed(1)}%` : "—"}
                </td>
                <td colSpan={2} />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function KpiCard({ label, value, highlight }: { label: string; value: string; highlight?: "red" | "amber" | "green" }) {
  const color = highlight === "red" ? "text-red-600" : highlight === "amber" ? "text-amber-600" : highlight === "green" ? "text-brand-green" : "text-neutral-900";
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}
