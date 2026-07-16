export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ImportClient } from "./ImportClient";

export default async function AccountingImportPage() {
  const profile = await requireAdmin();
  if (!profile) redirect("/staff");

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">นำเข้าข้อมูลย้อนหลัง</h1>
        <nav className="flex gap-2 text-sm">
          <a href="/owner/accounting"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50">
            บันทึก
          </a>
          <a href="/owner/accounting/summary"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-neutral-600 hover:bg-neutral-50">
            สรุปรายเดือน
          </a>
          <span className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white">นำเข้าข้อมูล</span>
        </nav>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>ข้อมูลย้อนหลัง:</strong> ระบบจะแมปหมวดบัญชีตาม COA ที่ตั้งไว้ — ตรวจสอบตารางด้านล่างก่อน import
      </div>

      <ImportClient />
    </div>
  );
}
