export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getCateringTransferCostRates } from "../actions";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { TransferCostSettingsClient } from "./TransferCostSettingsClient";

export default async function CateringCostSettingsPage() {
  await requireAdmin();
  const rates = await getCateringTransferCostRates();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <CateringSubNav isAdmin={true} />

      <div>
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">ต้นทุนภายใน</h1>
        <p className="mt-0.5 text-xs text-neutral-400">
          ต้นทุนภายในสำหรับคำนวณกำไร — ไม่แสดงต่อลูกค้า และพนักงานขาย (sales) ไม่มีสิทธิ์เข้าถึงข้อมูลนี้
        </p>
      </div>

      <TransferCostSettingsClient initialRates={rates} />
    </div>
  );
}
