import Link from "next/link";
import { requireProfile, isAdminOrAbove } from "@/lib/auth";
import { getOrderSessions } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import type { OrderSessionSummary } from "@/lib/inventory-data";
import { PageHeader, PageShell } from "@/components/ui/page";
import { buttonClass } from "@/components/ui/button";
import { thaiDate } from "@/lib/thai-date";

export default async function ReceiveQueuePage() {
  const profile = await requireProfile();
  const canReview = ["owner", "admin", "editor"].includes(profile.role);
  const canSend = isAdminOrAbove(profile.role);
  const sessions = await getOrderSessions({ status: "sent" });

  return (
    <PageShell>
      <InventorySubNav showTemplate={canReview} canReview={canReview} canSend={canSend} />

      <PageHeader title="รอรับของ" subtitle={<span className="text-xs">ใบสั่งซื้อที่ส่งแล้ว รอของมาส่ง</span>} />

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
          ไม่มีรายการรอรับของ
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <ReceiveCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function ReceiveCard({ session }: { session: OrderSessionSummary }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-neutral-900">
            {thaiDate(session.createdAt)}
          </span>
          {session.stationName && (
            <span className="text-xs text-neutral-500">{session.stationName}</span>
          )}
          <span className="text-xs text-neutral-500">{session.itemCount} รายการ</span>
        </div>
        <p className="text-xs text-neutral-500">สร้างโดย {session.createdByName}</p>
      </div>
      <Link
        href={`/staff/inventory/${session.id}/receive`}
        className={buttonClass("primary", { size: "sm", className: "shrink-0" })}
      >
        รับของ →
      </Link>
    </div>
  );
}
