export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getAllCoa } from "../actions";
import { CoaManagerClient } from "./CoaManagerClient";

export default async function CoaPage() {
  await requireAdmin();
  const coa = await getAllCoa();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-kanit text-xl font-semibold text-neutral-900">จัดการหมวดบัญชี</h1>
          <p className="mt-0.5 text-sm text-neutral-500">เพิ่ม แก้ไข หรือลบหมวดบัญชี (COA)</p>
        </div>
        <nav className="flex gap-1 rounded-xl border border-neutral-200 bg-neutral-50 p-1 text-sm">
          <a href="/owner/accounting/daily" className="rounded-lg px-3 py-1.5 text-neutral-500 hover:text-neutral-800">บันทึกรายวัน</a>
          <a href="/owner/accounting" className="rounded-lg px-3 py-1.5 text-neutral-500 hover:text-neutral-800">ดูทั้งเดือน</a>
          <a href="/owner/accounting/summary" className="rounded-lg px-3 py-1.5 text-neutral-500 hover:text-neutral-800">สรุปรายเดือน</a>
          <a href="/owner/accounting/import" className="rounded-lg px-3 py-1.5 text-neutral-500 hover:text-neutral-800">นำเข้าข้อมูล</a>
          <span className="rounded-lg bg-white px-3 py-1.5 font-medium text-neutral-900 shadow-sm">จัดการหมวด</span>
        </nav>
      </div>

      <CoaManagerClient coa={coa} />
    </div>
  );
}
