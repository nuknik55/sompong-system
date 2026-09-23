import { requireProfile, isAdminOrAbove } from "@/lib/auth";
import { getOrderSessions } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import type { OrderStatus, OrderSessionSummary } from "@/lib/inventory-data";
import { TH_ROW } from "@/components/ui/table";
import { PageHeader, PageShell } from "@/components/ui/page";
import { RowLink } from "@/components/ui/row-link";

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
  submitted: "bg-pending-soft text-pending-ink",
  returned:  "bg-danger-soft text-danger",
  reviewed:  "bg-info-soft text-info",
  sent:      "bg-primary-soft text-primary",
  received:  "bg-success-soft text-success-ink",
};

export default async function HistoryPage() {
  const profile = await requireProfile();
  const canReview = ["owner", "admin", "editor"].includes(profile.role);
  const canSend = isAdminOrAbove(profile.role);
  const sessions = await getOrderSessions({ status: "received" });

  return (
    <PageShell>
      <InventorySubNav showTemplate={canReview} canReview={canReview} canSend={canSend} />

      <PageHeader title="ประวัติ" subtitle={<span className="text-xs">ใบสั่งของที่รับของเสร็จแล้วทั้งหมด</span>} />

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
          ยังไม่มีประวัติ
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className={TH_ROW}>
                <th className="px-3 py-2">วันที่</th>
                <th className="px-3 py-2">แผนก</th>
                <th className="px-3 py-2">สถานะ</th>
                <th className="px-3 py-2 text-right">รายการ</th>
                <th className="px-3 py-2">โดย</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s: OrderSessionSummary) => (
                // The whole row opens the order.
                <RowLink key={s.id} href={`/staff/inventory/${s.id}`} className="border-b border-neutral-100 last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-neutral-900">{formatDate(s.createdAt)}</td>
                  <td className="px-3 py-2 text-neutral-600">{s.stationName ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s.status]}`}>
                      {STATUS_LABEL[s.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-500">{s.itemCount}</td>
                  <td className="px-3 py-2 text-neutral-500">{s.createdByName}</td>
                </RowLink>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
