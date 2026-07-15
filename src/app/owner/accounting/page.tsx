import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getCoa, getRecentEntries } from "./actions";
import { AccountingEntryClient } from "./AccountingEntryClient";

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await requireAdmin();
  if (!profile) redirect("/staff");

  const { month: rawMonth } = await searchParams;
  const today = new Date();
  const yearMonth =
    rawMonth?.match(/^\d{4}-\d{2}$/) ? rawMonth : today.toISOString().slice(0, 7);

  const [coa, entries] = await Promise.all([
    getCoa(),
    getRecentEntries(yearMonth),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">บัญชีรายจ่าย</h1>
        <nav className="flex gap-2 text-sm">
          <span className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white">บันทึก</span>
          <a href={`/owner/accounting/summary?month=${yearMonth}`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50">
            สรุปรายเดือน
          </a>
          <a href={`/owner/accounting/import`}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50">
            นำเข้าข้อมูล
          </a>
        </nav>
      </div>

      <AccountingEntryClient
        coa={coa}
        initialEntries={entries}
        yearMonth={yearMonth}
        isOwner={profile.role === "owner"}
      />
    </div>
  );
}
