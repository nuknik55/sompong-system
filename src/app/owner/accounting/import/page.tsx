export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Budget69ImportClient } from "./Budget69ImportClient";
import { OutsourceImportClient } from "./OutsourceImportClient";

/**
 * OWNER ONLY. Both imports on this page write 790 เงินเดือนเจ้าของร้าน, which
 * is_sensitive keeps from every non-owner read. An admin cannot be allowed to
 * write what they cannot see; requireOwner here and on every action, and
 * each RPC refuses a sensitive code from a non-owner as the second lock.
 *
 * TWO SOURCES, ONE PER MONTH — never both:
 *   - the outsourced accountant's file (69-08.xlsx …) from August 2569 on,
 *     and `other` for every month. import_outsource_month refuses expense
 *     entries for a month budget69 owns.
 *   - budget69.xlsx for Jan–Jul 2569, the months it already filled.
 *     applyBudget69Import refuses a month that has OUT- lumps.
 *
 * This route used to host the อู๋ daily-Excel importer for ม.ค.–มิ.ย. 69. It
 * was never run against production and Nik retired it. Same route, third
 * purpose.
 */
export default async function ImportPage() {
  await requireOwner();
  const bangkok = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  // budget69 defaults to the previous month, as before.
  const [y, m] = bangkok.slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">นำเข้ารายจ่ายรายเดือน</h1>
        <Link href="/owner/accounting" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← กลับหน้าบัญชี
        </Link>
      </div>

      <div className="space-y-2 text-sm text-neutral-500">
        <p>
          ระบบบันทึกรายวันไม่มีค่าใช้จ่ายที่จ่ายเป็นรายเดือน — เงินเดือน ค่าเช่า ค่าไฟ ค่าน้ำ ค่าทำบัญชี
          เงินเดือนเจ้าของ ค่าธรรมเนียมบัตร ภาษี — ราว 1 ล้านบาทต่อเดือน เพราะไม่มีใครจ่ายที่หน้าร้าน
          หน้านี้นำตัวเลขจาก<strong>ไฟล์บัญชี</strong> (69-08.xlsx และไฟล์ถัดไป) มาบันทึกเป็นก้อนเดือนละบรรทัดต่อบัญชี
          พร้อม <strong>รายได้อื่นๆ</strong> ซึ่งเป็นตัวเลขของฝ่ายบัญชี
        </p>
        <p>
          เดือนหนึ่งมีแหล่งเดียว: ม.ค.–ก.ค. 69 มาจาก budget69 แล้วและคงไว้ (ไฟล์บัญชีเติมได้เฉพาะรายได้อื่นๆ)
          ตั้งแต่ ส.ค. 69 มาจากไฟล์บัญชี ทุกบรรทัดลงวันที่ 1 ของเดือน เป็น &quot;ไม่ต้องจ่าย&quot; ไม่ผูกซัพพลายเออร์
          จึงไม่ขึ้นในใบโอนเงิน นำเข้าเดือนเดิมซ้ำได้ — ของเดิมถูกแทนที่ทั้งชุด
        </p>
      </div>

      <OutsourceImportClient />

      <details className="rounded-lg border border-neutral-200 bg-neutral-50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-neutral-700">
          budget69.xlsx — เฉพาะ ม.ค.–ก.ค. 69 (เดือนที่นำเข้าจาก budget69 แล้ว)
        </summary>
        <div className="space-y-3 border-t border-neutral-200 bg-white p-4">
          <p className="text-xs text-neutral-500">
            ใช้เมื่อต้องแก้เดือนที่ budget69 เป็นเจ้าของเท่านั้น ที่บันทึกคือส่วนที่ยังไม่ได้บันทึกรายวัน (ยอดชีต − ที่บันทึกแล้ว)
            เดือนที่บันทึกจากไฟล์บัญชีแล้วจะถูกปฏิเสธ
          </p>
          <Budget69ImportClient defaultYearMonth={prev} />
        </div>
      </details>
    </div>
  );
}
