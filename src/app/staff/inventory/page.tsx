import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getOrderSessions, getStations, getAllStationTemplates } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import { FromTemplateButton } from "./FromTemplateButton";
import type { OrderStatus, OrderSessionSummary } from "@/lib/inventory-data";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  submitted: "รออนุมัติ",
  returned:  "ตีกลับ",
  approved:  "อนุมัติแล้ว",
  sent:      "สั่งแล้ว",
  received:  "รับของแล้ว",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  submitted: "bg-amber-100 text-amber-800",
  returned:  "bg-orange-100 text-orange-800",
  approved:  "bg-blue-100 text-blue-800",
  sent:      "bg-purple-100 text-purple-800",
  received:  "bg-green-100 text-green-800",
};

function SessionTable({ sessions }: { sessions: OrderSessionSummary[] }) {
  if (sessions.length === 0) return null;
  return (
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
  );
}

function SectionHeader({ title, count, hint, color }: { title: string; count: number; hint: string; color: string }) {
  return (
    <div className="flex items-baseline gap-2 mt-2">
      <h2 className={`text-sm font-semibold ${color}`}>{title}</h2>
      <span className="text-xs text-neutral-400">{count} รายการ · {hint}</span>
    </div>
  );
}

export default async function InventoryListPage() {
  const [profile, sessions, stations, allTemplates] = await Promise.all([
    requireProfile(),
    getOrderSessions(),
    getStations(),
    getAllStationTemplates().catch(() => ({} as Record<string, unknown[]>)),
  ]);

  const canManageTemplate = ["owner", "admin", "editor"].includes(profile.role);
  const stationsWithTemplate = stations.filter((s) => (allTemplates[s.id]?.length ?? 0) > 0);

  // Group by workflow stage
  const needsAction   = sessions.filter((s) => s.status === "submitted" || s.status === "returned");
  const inProgress    = sessions.filter((s) => s.status === "approved" || s.status === "sent");
  const done          = sessions.filter((s) => s.status === "received");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <InventorySubNav showTemplate={canManageTemplate} />

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">สั่งของ</h1>
          <p className="text-xs text-neutral-400 mt-0.5">เช็คของ → สั่งซื้อ → รับของ</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {stationsWithTemplate.length > 0 && (
            <FromTemplateButton stations={stationsWithTemplate} />
          )}
          <Link
            href="/staff/inventory/new"
            className="rounded-md px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "#2F5A16" }}
          >
            + เช็คของ / สั่งของ
          </Link>
        </div>
      </div>

      {/* ① ต้องดำเนินการ */}
      {needsAction.length > 0 && (
        <div className="space-y-2">
          <SectionHeader
            title="⚠ รอดำเนินการ"
            count={needsAction.length}
            hint="รออนุมัติ หรือ ถูกตีกลับ"
            color="text-amber-700"
          />
          <SessionTable sessions={needsAction} />
        </div>
      )}

      {/* ② กำลังสั่ง / รับของ */}
      {inProgress.length > 0 && (
        <div className="space-y-2">
          <SectionHeader
            title="📦 กำลังดำเนินการ"
            count={inProgress.length}
            hint="อนุมัติแล้ว หรือ ส่งสั่งแล้ว — รอรับของ"
            color="text-blue-700"
          />
          <SessionTable sessions={inProgress} />
        </div>
      )}

      {/* Empty state */}
      {needsAction.length === 0 && inProgress.length === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          ไม่มีรายการที่ต้องดำเนินการ
        </div>
      )}

      {/* ③ เสร็จแล้ว (collapsed) */}
      {done.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer items-baseline gap-2 text-sm text-neutral-400 hover:text-neutral-600 list-none">
            <span className="text-neutral-300 group-open:hidden">▶</span>
            <span className="hidden group-open:inline text-neutral-300">▼</span>
            รับของแล้ว ({done.length} รายการ)
          </summary>
          <div className="mt-2">
            <SessionTable sessions={done} />
          </div>
        </details>
      )}
    </div>
  );
}
