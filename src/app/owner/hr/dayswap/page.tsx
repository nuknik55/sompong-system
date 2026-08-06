export const dynamic = "force-dynamic";

import { requireHR } from "@/lib/auth";
import { getEmployees, getDaySwapRequests, getCompDayBalances, getHolidays } from "../actions";
import { DaySwapClient } from "./DaySwapClient";

export default async function DaySwapPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireHR();
  const sp = await searchParams;
  const year = sp.year ? parseInt(sp.year) : new Date().getFullYear();

  const [employees, swaps, balances, holidays] = await Promise.all([
    getEmployees(),
    getDaySwapRequests(year),
    getCompDayBalances(),
    getHolidays(year),
  ]);

  return (
    <DaySwapClient
      employees={employees}
      initialSwaps={swaps}
      balances={balances}
      defaultYear={year}
      holidayOptions={holidays.filter((h) => h.is_active && h.pay_policy === "comp_day_only")}
    />
  );
}
