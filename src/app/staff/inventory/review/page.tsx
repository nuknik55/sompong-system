import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, isAdminOrAbove } from "@/lib/auth";
import { getOrderSessions } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import type { OrderSessionSummary } from "@/lib/inventory-data";
import { PageHeader, PageShell } from "@/components/ui/page";
import { buttonClass } from "@/components/ui/button";

export default async function ReviewQueuePage() {
  const profile = await requireProfile();
  if (!["owner", "admin", "editor"].includes(profile.role)) redirect("/staff/inventory");
  const canSend = isAdminOrAbove(profile.role);

  const sessions = await getOrderSessions({ status: "submitted" });

  return (
    <PageShell>
      <InventorySubNav showTemplate={true} canReview={true} canSend={canSend} />

      <PageHeader title="รอตรวจสอบ" subtitle={<span className="text-xs">ใบสั่งของที่ staff ส่งมา รอ editor+ ตรวจสอบ</span>} />

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
          ไม่มีรายการรอตรวจสอบ
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} cta={{ label: "ตรวจสอบ →" }} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function SessionCard({
  session,
  cta,
}: {
  session: OrderSessionSummary;
  cta: { label: string };
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 flex items-center justify-between gap-4">
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
          <span className="text-xs text-neutral-500">{session.itemCount} รายการ</span>
        </div>
        <p className="text-xs text-neutral-500">สร้างโดย {session.createdByName}</p>
      </div>
      <Link
        href={`/staff/inventory/${session.id}`}
        className={buttonClass("primary", { size: "sm", className: "shrink-0" })}
      >
        {cta.label}
      </Link>
    </div>
  );
}
