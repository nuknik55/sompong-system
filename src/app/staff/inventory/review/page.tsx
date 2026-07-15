import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile, isAdminOrAbove } from "@/lib/auth";
import { getOrderSessions } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import type { OrderSessionSummary } from "@/lib/inventory-data";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
}

export default async function ReviewQueuePage() {
  const profile = await requireProfile();
  if (!["owner", "admin", "editor"].includes(profile.role)) redirect("/staff/inventory");
  const canSend = isAdminOrAbove(profile.role);

  const sessions = await getOrderSessions({ status: "submitted" });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate={true} canReview={true} canSend={canSend} />

      <div>
        <h1 className="text-lg font-semibold text-neutral-900">รอตรวจสอบ</h1>
        <p className="text-xs text-neutral-400 mt-0.5">ใบสั่งของที่ staff ส่งมา รอ editor+ ตรวจสอบ</p>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          ไม่มีรายการรอตรวจสอบ
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} cta={{ label: "ตรวจสอบ →", color: "#2F5A16" }} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({
  session,
  cta,
}: {
  session: OrderSessionSummary;
  cta: { label: string; color: string };
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
          <span className="text-xs text-neutral-400">{session.itemCount} รายการ</span>
        </div>
        <p className="text-xs text-neutral-500">สร้างโดย {session.createdByName}</p>
      </div>
      <Link
        href={`/staff/inventory/${session.id}`}
        className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-white"
        style={{ backgroundColor: cta.color }}
      >
        {cta.label}
      </Link>
    </div>
  );
}
