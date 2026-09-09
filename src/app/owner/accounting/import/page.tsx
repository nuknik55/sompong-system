export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { Budget69ImportClient } from "./Budget69ImportClient";

/**
 * OWNER ONLY. This import writes 790 เงินเดือนเจ้าของร้าน, which is_sensitive
 * keeps from every non-owner read. An admin cannot be allowed to write what
 * they cannot see; requireOwner here and on both actions, and the RPC refuses
 * a sensitive code from a non-owner as the second lock.
 *
 * This route used to host the อู๋ daily-Excel importer for ม.ค.–มิ.ย. 69. It
 * was never run against production (expense_entries begins 2026-07-17) and
 * Nik retired it: อู๋'s file was unreliable and budget69 is the trusted
 * figure. Same route, new purpose.
 */
export default async function Budget69ImportPage() {
  await requireOwner();
  const bangkok = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  // Default to the previous month: the sheet's actual for a month exists
  // once the month has closed.
  const [y, m] = bangkok.slice(0, 7).split("-").map(Number);
  const prev = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">นำเข้ารายจ่ายรายเดือน (budget69)</h1>
        <Link href="/owner/accounting" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← กลับหน้าบัญชี
        </Link>
      </div>

      <div className="space-y-2 text-sm text-neutral-500">
        <p>
          ระบบบันทึกรายวันไม่เคยมีค่าใช้จ่ายที่จ่ายเป็นรายเดือน — เงินเดือน ค่าเช่า ค่าไฟ ค่าน้ำ ค่าทำบัญชี
          เงินเดือนเจ้าของ ค่าธรรมเนียมบัตร — ราว 1 ล้านบาทต่อเดือน เพราะไม่มีใครจ่ายที่หน้าร้าน
          หน้านี้นำตัวเลข &quot;จริง&quot; จาก budget69.xlsx มาบันทึกเป็นก้อนเดือนละบรรทัดต่อบัญชี
        </p>
        <p>
          ที่บันทึกคือ <strong>ส่วนที่ยังไม่ได้บันทึกรายวัน</strong>: ยอดชีต − ที่บันทึกแล้ว
          ถ้าบันทึกรายวันเกินยอดชีต จะไม่เขียนเพิ่มและรายการเดิมคงอยู่ ส่วนลดกับ GP มาจากการนำเข้ารายได้ POS ไม่เขียนจากชีต
        </p>
        <p>
          ทุกบรรทัดลงวันที่ 1 ของเดือน เป็น &quot;ไม่ต้องจ่าย&quot; และไม่ผูกซัพพลายเออร์ จึงไม่ขึ้นในใบโอนเงิน
          นำเข้าเดือนเดิมซ้ำได้ — ของเดิมถูกแทนที่ทั้งชุด
        </p>
      </div>

      <Budget69ImportClient defaultYearMonth={prev} />
    </div>
  );
}
