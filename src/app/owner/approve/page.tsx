import { requireAdmin } from "@/lib/auth";
import { getPendingList } from "@/lib/pending-data";
import { ApproveClient } from "@/app/owner/approve/ApproveClient";

export default async function ApprovePage() {
  await requireAdmin();
  const changes = await getPendingList();
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div>
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">อนุมัติการเปลี่ยนแปลง</h1>
        <p className="text-sm text-neutral-500">
          รายการที่ Editor ส่งมาขออนุมัติ — ตรวจสอบแล้วอนุมัติหรือปฏิเสธ
        </p>
      </div>
      <ApproveClient changes={changes} />
    </div>
  );
}
