export const dynamic = "force-dynamic";

import { requireHR } from "@/lib/auth";
import { getEmployees, getDaySwapRequests, getCompDayBalances } from "../actions";
import { DaySwapClient } from "./DaySwapClient";

export default async function DaySwapPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireHR();
  const sp = await searchParams;
  const year = sp.year ? parseInt(sp.year) : new Date().getFullYear();

  const [employees, swaps, balances] = await Promise.all([
    getEmployees(),
    getDaySwapRequests(year),
    getCompDayBalances(),
  ]);

  return (
    <DaySwapClient
      employees={employees}
      initialSwaps={swaps}
      balances={balances}
      defaultYear={year}
    />
  );
}
