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
        <div className="flex items-center gap-3">
          <a href="/owner/accounting" className="text-sm text-neutral-400 hover:text-neutral-700">← ดูทั้งเดือน</a>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>ข้อมูลย้อนหลัง:</strong> ระบบจะแมปหมวดบัญชีตาม COA ที่ตั้งไว้ — ตรวจสอบตารางด้านล่างก่อน import
      </div>

      <ImportClient />
    </div>
  );
}
