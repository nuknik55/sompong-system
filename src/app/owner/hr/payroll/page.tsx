export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getPayrollPeriods, getPayrollEntries } from "../actions";
import { PayrollClient } from "./PayrollClient";

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const periods = await getPayrollPeriods();
  const selectedPeriodId = sp.period ?? periods[0]?.id ?? null;
  const entries = selectedPeriodId ? await getPayrollEntries(selectedPeriodId) : [];

  return (
    <PayrollClient
      periods={periods}
      initialEntries={entries}
      selectedPeriodId={selectedPeriodId}
    />
  );
}
