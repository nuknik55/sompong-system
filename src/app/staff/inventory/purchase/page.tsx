import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getOrderSessions } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import type { OrderSessionSummary } from "@/lib/inventory-data";

export default async function PurchaseQueuePage() {
  const profile = await requireProfile();
  if (!["owner", "admin", "editor"].includes(profile.role)) redirect("/staff/inventory");

  const sessions = await getOrderSessions({ status: "reviewed" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate={true} canReview={true} />

      <div>
        <h1 className="text-lg font-semibold text-neutral-900">รอสั่งซื้อ</h1>
        <p className="text-xs text-neutral-400 mt-0.5">ตรวจสอบแล้ว รอโทรสั่งซัพพลายเออร์</p>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          ไม่มีรายการรอสั่งซื้อ
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <PurchaseCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function PurchaseCard({ session }: { session: OrderSessionSummary }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 flex items-center justify-between gap-4">
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
        <p className="text-xs text-neutral-500">
          สร้างโดย {session.createdByName}
          {session.reviewedByName && ` · ตรวจโดย ${session.reviewedByName}`}
        </p>
      </div>
      <Link
        href={`/staff/inventory/${session.id}`}
        className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800"
      >
        สั่งซื้อ →
      </Link>
    </div>
  );
}
