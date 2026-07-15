import Link from "next/link";
import { requireProfile, isAdminOrAbove } from "@/lib/auth";
import { getOrderSessions } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import type { OrderSessionSummary } from "@/lib/inventory-data";

export default async function ReceiveQueuePage() {
  const profile = await requireProfile();
  const canReview = ["owner", "admin", "editor"].includes(profile.role);
  const canSend = isAdminOrAbove(profile.role);
  const sessions = await getOrderSessions({ status: "sent" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate={canReview} canReview={canReview} canSend={canSend} />

      <div>
        <h1 className="text-lg font-semibold text-neutral-900">รอรับของ</h1>
        <p className="text-xs text-neutral-400 mt-0.5">ใบสั่งซื้อที่ส่งแล้ว รอของมาส่ง</p>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          ไม่มีรายการรอรับของ
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <ReceiveCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReceiveCard({ session }: { session: OrderSessionSummary }) {
  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/40 p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-neutral-900">
            {new Date(session.createdAt).toLocaleDateString("th-TH", {
              day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok"
            })}
          </span>
          {session.stationName && (
            <span className="text-xs text-neutral-500">{session.stationName}</span>
          )}
          <span className="text-xs text-neutral-400">{session.itemCount} รายการ</span>
        </div>
        <p className="text-xs text-neutral-500">สร้างโดย {session.createdByName}</p>
      </div>
      <Link
        href={`/staff/inventory/${session.id}/receive`}
        className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-white"
        style={{ backgroundColor: "#2F5A16" }}
      >
        รับของ →
      </Link>
    </div>
  );
}
