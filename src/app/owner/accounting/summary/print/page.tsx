export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getMonthlySummary, getMonthlyRevenue } from "../../actions";
import { PLPrintClient } from "./PLPrintClient";

export default async function PLPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireAdmin();

  const { month: rawMonth } = await searchParams;
  const today = new Date().toISOString().slice(0, 7);
  const yearMonth = rawMonth?.match(/^\d{4}-\d{2}$/) ? rawMonth : today;

  const [summary, revenueRows] = await Promise.all([
    getMonthlySummary(yearMonth),
    getMonthlyRevenue(yearMonth),
  ]);

  const revenueMap = Object.fromEntries(revenueRows.map((r) => [r.revenue_type, r.amount]));

  return (
    <PLPrintClient
      yearMonth={yearMonth}
      summary={summary}
      revenueMap={revenueMap}
    />
  );
}
