export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { RevenueImportClient } from "./RevenueImportClient";

export default async function RevenueImportPage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">นำเข้ารายได้จาก POS</h1>
        <Link href="/owner/accounting" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← กลับหน้าบัญชี
        </Link>
      </div>

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
    </div>
  );
}
