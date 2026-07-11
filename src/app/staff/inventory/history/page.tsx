import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getOrderSessions } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import type { OrderStatus, OrderSessionSummary } from "@/lib/inventory-data";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  submitted: "รอตรวจสอบ",
  returned:  "ตีกลับ",
  reviewed:  "รอสั่งซื้อ",
  sent:      "สั่งแล้ว",
  received:  "รับของแล้ว",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  submitted: "bg-amber-100 text-amber-800",
  returned:  "bg-orange-100 text-orange-800",
  reviewed:  "bg-blue-100 text-blue-800",
  sent:      "bg-purple-100 text-purple-800",
  received:  "bg-green-100 text-green-800",
};

export default async function HistoryPage() {
  const profile = await requireProfile();
  const canReview = ["owner", "admin", "editor"].includes(profile.role);
  const sessions = await getOrderSessions({ status: "received" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate={canReview} canReview={canReview} />

      <div>
        <h1 className="text-lg font-semibold text-neutral-900">ประวัติ</h1>
        <p className="text-xs text-neutral-400 mt-0.5">ใบสั่งของที่รับของเสร็จแล้วทั้งหมด</p>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          ยังไม่มีประวัติ
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                <th className="px-3 py-2">วันที่</th>
                <th className="px-3 py-2">สถานี</th>
                <th className="px-3 py-2">สถานะ</th>
                <th className="px-3 py-2 text-right">รายการ</th>
                <th className="px-3 py-2">โดย</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s: OrderSessionSummary) => (
                <tr key={s.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="px-3 py-2">
                    <Link href={`/staff/inventory/${s.id}`} className="font-medium text-neutral-900 hover:underline">
                      {formatDate(s.createdAt)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{s.stationName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-500">{s.itemCount}</td>
                  <td className="px-3 py-2 text-neutral-500">{s.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
