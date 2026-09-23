export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getCateringTransferCostRates } from "../actions";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { TransferCostSettingsClient } from "./TransferCostSettingsClient";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function CateringCostSettingsPage() {
  await requireAdmin();
  const rates = await getCateringTransferCostRates();

  return (
    <PageShell>
      <CateringSubNav isAdmin={true} />

      <PageHeader
        title="ต้นทุนภายใน"
        subtitle={<span className="text-xs">ต้นทุนภายในสำหรับคำนวณกำไร — ไม่แสดงต่อลูกค้า และพนักงานขาย (sales) ไม่มีสิทธิ์เข้าถึงข้อมูลนี้</span>}
      />

      <TransferCostSettingsClient rates={rates} />
    </PageShell>
  );
}
