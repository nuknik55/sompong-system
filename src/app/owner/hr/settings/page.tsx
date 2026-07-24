export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getDepartments, getLeaveTypes, getHolidays, getOtRules } from "../actions";
import { HRSettingsClient } from "./HRSettingsClient";

export default async function HRSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const year = sp.year ? parseInt(sp.year) : new Date().getFullYear();

  const [departments, leaveTypes, holidays, otRules] = await Promise.all([
    getDepartments(),
    getLeaveTypes(),
    getHolidays(year),
    getOtRules(),
  ]);

  return (
    <HRSettingsClient
      initialDepartments={departments}
      initialLeaveTypes={leaveTypes}
      initialHolidays={holidays}
      initialOtRules={otRules}
      calendarYear={year}
    />
  );
}
