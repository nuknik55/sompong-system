export const dynamic = "force-dynamic";

import { requireOwner } from "@/lib/auth";
import { getMonthlySummary, getMonthlyRevenue, getMonthlyCovers } from "../../actions";
import { bangkokYearMonth } from "@/lib/bangkok-date";
import { PLPrintClient } from "./PLPrintClient";

export default async function PLPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  // OWNER ONLY since 2026-09-17 (Nik): the printed P&L and its Excel file
  // carry the shop's profit. An admin is sent to /owner.
  await requireOwner();

  const { month: rawMonth } = await searchParams;
  const today = bangkokYearMonth();
  const yearMonth = rawMonth?.match(/^\d{4}-\d{2}$/) ? rawMonth : today;

  const [summary, revenueRows, covers] = await Promise.all([
    getMonthlySummary(yearMonth),
    getMonthlyRevenue(yearMonth),
    getMonthlyCovers(yearMonth),
  ]);

  const revenueMap = Object.fromEntries(revenueRows.map((r) => [r.revenue_type, r.amount]));

  return (
    <PLPrintClient
      yearMonth={yearMonth}
      summary={summary}
      revenueMap={revenueMap}
      covers={covers}
    />
  );
}
