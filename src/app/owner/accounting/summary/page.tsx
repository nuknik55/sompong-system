export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMonthlySummary, getMonthlyRevenue } from "../actions";
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

  const [summary, revenueRows] = await Promise.all([
    getMonthlySummary(yearMonth),
    getMonthlyRevenue(yearMonth),
  ]);

  const revenueMap = Object.fromEntries(revenueRows.map((r) => [r.revenue_type, r.amount]));
  const totalRevenue = summary.totalRevenue;

  const [y, m] = yearMonth.split("-").map(Number);
  const prevMonth = new Date(y!, m! - 2, 1).toISOString().slice(0, 7);
  const nextMonth = new Date(y!, m!, 1).toISOString().slice(0, 7);
  const isCurrentMonth = yearMonth === today;

  const profit = totalRevenue - summary.totalExpense;
  const profitPct = totalRevenue > 0 ? (profit / totalRevenue) * 100 : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">สรุปรายเดือน</h1>
        <nav className="flex gap-2 text-sm">
          <a href={`/owner/accounting?month=${yearMonth}`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50">
            บันทึก
          </a>
          <span className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white">สรุปรายเดือน</span>
          <a href="/owner/accounting/import"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50">
            นำเข้าข้อมูล
          </a>
        </nav>
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
      <RevenueEntryClient yearMonth={yearMonth} initialRevenue={revenueMap as Record<string, number>} />

      {totalRevenue === 0 ? (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          ยังไม่ได้กรอกรายได้เดือนนี้ — กรอกก่อนเพื่อดู % ต้นทุน
        </p>
      ) : null}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="รายได้รวม" value={`${formatBaht(totalRevenue)} ฿`} />
        <KpiCard label="รายจ่ายรวม" value={`${formatBaht(summary.totalExpense)} ฿`} />
        <KpiCard
          label="% ต้นทุนรวม"
          value={totalRevenue > 0 ? `${((summary.totalExpense / totalRevenue) * 100).toFixed(1)}%` : "—"}
        />
        <KpiCard
          label="กำไร (ก่อนภาษี)"
          value={totalRevenue > 0 ? `${formatBaht(profit)} ฿` : "—"}
          highlight={profitPct !== null ? (profitPct < 10 ? "red" : profitPct < 15 ? "amber" : "green") : undefined}
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
              <td className="px-4 py-2 font-semibold text-neutral-900">รวมค่าใช้จ่ายทั้งหมด</td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatBaht(summary.totalExpense)}</td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">
                {totalRevenue > 0 ? `${((summary.totalExpense / totalRevenue) * 100).toFixed(1)}%` : "—"}
              </td>
              <td colSpan={2} />
            </tr>
            {totalRevenue > 0 && (
              <tr className="border-t border-neutral-200">
                <td className="px-4 py-2 font-semibold text-neutral-900">กำไร (ก่อนภาษี)</td>
                <td className={`px-4 py-2 text-right tabular-nums font-semibold ${profit < 0 ? "text-red-600" : "text-brand-green"}`}>
                  {formatBaht(profit)}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums font-semibold ${profit < 0 ? "text-red-600" : "text-brand-green"}`}>
                  {profitPct != null ? `${profitPct.toFixed(1)}%` : "—"}
                </td>
                <td colSpan={2} />
              </tr>
            )}
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
