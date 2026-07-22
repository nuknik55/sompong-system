export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getRecentEntries } from "./actions";
import { AccountingEntryClient } from "./AccountingEntryClient";

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await requireAdmin();

  const { month: rawMonth } = await searchParams;
  const today = new Date();
  const yearMonth =
    rawMonth?.match(/^\d{4}-\d{2}$/) ? rawMonth : today.toISOString().slice(0, 7);

  const entries = await getRecentEntries(yearMonth);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">ดูทั้งเดือน</h1>
        <div className="flex items-center gap-4 text-sm text-neutral-500">
          <Link href="/owner/accounting/daily" className="hover:text-neutral-800">บันทึกรายวัน</Link>
          <span className="text-neutral-200">|</span>
          <Link href={`/owner/accounting/summary?month=${yearMonth}`} className="hover:text-neutral-800">สรุปรายเดือน</Link>
          <span className="text-neutral-200">|</span>
          <Link href="/owner/accounting/transfer-slip" className="hover:text-neutral-800">ใบโอนเงิน</Link>
          <span className="text-neutral-200">|</span>
          <Link href="/owner/accounting/suppliers" className="hover:text-neutral-800">ซัพพลายเออร์</Link>
          <span className="text-neutral-200">|</span>
          <Link href="/owner/accounting/import" className="hover:text-neutral-800">นำเข้าข้อมูล</Link>
          <span className="text-neutral-200">|</span>
          <Link href="/owner/accounting/coa" className="hover:text-neutral-800">จัดการหมวด</Link>
        </div>
      </div>

      <AccountingEntryClient
        initialEntries={entries}
        yearMonth={yearMonth}
        isOwner={profile.role === "owner"}
      />
    </div>
  );
}
