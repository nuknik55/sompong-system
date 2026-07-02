import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getOrderSessions } from "@/lib/inventory-data";
import type { OrderStatus } from "@/lib/inventory-data";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  submitted: "รออนุมัติ",
  returned:  "ตีกลับ",
  approved:  "อนุมัติแล้ว",
  sent:      "ส่งแล้ว",
  received:  "รับของแล้ว",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  submitted: "bg-amber-100 text-amber-800",
  returned:  "bg-orange-100 text-orange-800",
  approved:  "bg-blue-100 text-blue-800",
  sent:      "bg-purple-100 text-purple-800",
  received:  "bg-green-100 text-green-800",
};

export default async function InventoryListPage() {
  const [, sessions] = await Promise.all([requireProfile(), getOrderSessions()]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">รายการสั่งของ</h1>
          <p className="text-sm text-neutral-500">เช็คของ · สั่งของ · รับของ</p>
        </div>
        <Link
          href="/staff/inventory/new"
          className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + สั่งของใหม่
        </Link>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          ยังไม่มีรายการสั่งของ
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
              {sessions.map((s) => (
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
