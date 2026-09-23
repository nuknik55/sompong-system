import { requireAdmin } from "@/lib/auth";
import { getPendingList } from "@/lib/pending-data";
import { ApproveClient } from "@/app/owner/approve/ApproveClient";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function ApprovePage() {
  await requireAdmin();
  const changes = await getPendingList();
  return (
    <PageShell>
      <PageHeader title="อนุมัติการเปลี่ยนแปลง" subtitle="รายการที่ Editor ส่งมาขออนุมัติ — ตรวจสอบแล้วอนุมัติหรือปฏิเสธ" />
      <ApproveClient changes={changes} />
    </PageShell>
  );
}
