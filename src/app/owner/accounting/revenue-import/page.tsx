export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { RevenueImportClient } from "./RevenueImportClient";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function RevenueImportPage() {
  await requireAdmin();

  return (
    <PageShell>
      <PageHeader back={{ href: "/owner/accounting", label: "กลับหน้าบัญชี" }} title="นำเข้ารายได้จาก POS" />

      <div className="space-y-2 text-sm text-neutral-500">
        <p>
          อ่านไฟล์ยอดขายรายเดือนจาก POS แล้วบันทึกเป็นรายได้ 6 ประเภท พร้อมค่าส่วนลดและค่า GP ของ Grab/LineMan
          ทั้งหมดบันทึกพร้อมกันครั้งเดียว — ถ้าอย่างใดอย่างหนึ่งล้มเหลว จะไม่มีอะไรถูกบันทึกเลย
          เพราะรายได้ที่ไม่มีส่วนลดคู่กันจะทำให้กำไรดูสูงเกินจริง
        </p>
        <p>
          ยอด <strong>อื่นๆ (บัญชี)</strong> เป็นตัวเลขที่ฝ่ายบัญชีรวมมาให้ หน้านี้ไม่แตะต้อง
          และยอดร้านกาแฟไม่นับเป็นรายได้ของร้านอาหาร
        </p>
        <p>
          นำเข้าเดือนเดิมซ้ำได้ — ระบบจะลบของเดิมที่เคยนำเข้าแล้วเขียนใหม่ทั้งชุด ไม่เกิดรายการซ้ำ
        </p>
      </div>

      <RevenueImportClient />
    </PageShell>
  );
}
