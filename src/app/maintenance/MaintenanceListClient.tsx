"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap, Droplets, UtensilsCrossed, MoreHorizontal, AlertTriangle, Plus } from "lucide-react";
import type { MaintenanceReport } from "@/lib/maintenance-data";
import {
  MAINTENANCE_STATUSES, STATUS_CLASS, STATUS_LABEL, canEditReport, canMarkDone, type MaintenanceStatus,
} from "@/lib/maintenance-rules";
import { buttonClass } from "@/components/ui/button";
import { thaiDate } from "@/lib/thai-date";

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} วันที่แล้ว`;
  return thaiDate(iso);
}

const CAT_ICON: Record<string, React.ReactNode> = {
  ไฟฟ้า: <Zap className="h-3.5 w-3.5 text-yellow-500" />,
  ประปา: <Droplets className="h-3.5 w-3.5 text-blue-500" />,
  เครื่องครัว: <UtensilsCrossed className="h-3.5 w-3.5 text-success-ink" />,
  อื่นๆ: <MoreHorizontal className="h-3.5 w-3.5 text-neutral-500" />,
};

// ทั้งหมด, then one tab per status in the order they run; ยกเลิก last, so a
// cancelled report can still be found.
type Tab = "all" | MaintenanceStatus;
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  ...MAINTENANCE_STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s] })),
];

export function MaintenanceListClient({
  reports,
  role,
  currentUserId,
}: {
  reports: MaintenanceReport[];
  role: string;
  currentUserId: string;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const filtered = tab === "all" ? reports : reports.filter((r) => r.status === tab);
  const count = (s: MaintenanceStatus) => reports.filter((r) => r.status === s).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(({ key, label }) => {
          const n = key === "all" ? reports.length : count(key as MaintenanceStatus);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              // The selected tab is the primary tint (a selection, not an action).
              className={`rounded-full border px-3 py-1 font-heading text-sm transition-colors ${
                tab === key
                  ? "border-primary/30 bg-primary-soft font-medium text-primary"
                  : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {label} ({n})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-500">ไม่มีรายการ</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => {
            // Every control by the rules module, the screen's mirror of the
            // maint_* functions; never an inline role list.
            const canEdit = canEditReport(role, r.reporterId === currentUserId, r.status);
            const manage = canMarkDone(role, r.status);
            // A cancelled report: grey, its title struck through (neutral,
            // never red — AGENTS.md colour roles).
            const cancelled = r.status === "cancelled";
            return (
              <li
                key={r.id}
                className={`rounded-xl border p-4 space-y-2 ${cancelled ? "border-neutral-200 bg-neutral-50" : "border-neutral-200 bg-white"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className={`flex items-center gap-1.5 text-sm font-medium ${cancelled ? "text-neutral-500" : "text-neutral-800"}`}>
                      <span className="shrink-0">{CAT_ICON[r.category] ?? CAT_ICON["อื่นๆ"]}</span>
                      <span className={`min-w-0 break-words ${cancelled ? "line-through" : ""}`}>{r.category} — {r.location || "ไม่ระบุจุด"}</span>
                    </div>
                    {r.description && (
                      <p className="mt-0.5 text-xs text-neutral-500 line-clamp-2">{r.description}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>

                {r.photoBefore && (
                  <div className="h-24 w-32 overflow-hidden rounded-lg bg-neutral-100 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.photoBefore} alt="รูปก่อนซ่อม" className="h-full w-full object-contain" />
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.isUrgent && (
                      <span className="inline-flex items-center gap-1 rounded bg-danger-soft px-1.5 py-0.5 text-xs text-danger">
                        <AlertTriangle className="h-3 w-3" /> เร่งด่วน
                      </span>
                    )}
                    <span className="text-xs text-neutral-500">
                      {r.reporterName || "ไม่ระบุ"} · {relTime(r.createdAt)}
                    </span>
                    {/* "ไม่ระบุชื่อ" is the truth for rows accepted before the
                        column existed — the roof leak — not a rendering gap. */}
                    {(r.status === "in_progress" || r.status === "done") && (
                      <span className="text-xs text-neutral-500">
                        {r.status === "done" ? "ซ่อมโดย" : "รับเรื่องโดย"} {r.resolverName || "ไม่ระบุชื่อ"}
                      </span>
                    )}
                    {cancelled && (
                      <span className="text-xs text-neutral-500">ยกเลิกโดย {r.cancelledByName || "ไม่ระบุชื่อ"}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {canEdit && (
                      <Link
                        href={`/maintenance/${r.id}/edit`}
                        className={buttonClass("secondary", { size: "sm" })}
                      >
                        แก้ไข
                      </Link>
                    )}
                    <Link
                      href={`/maintenance/${r.id}`}
                      className={buttonClass(manage ? "primary" : "secondary", { size: "sm" })}
                    >
                      {manage ? "จัดการ" : "ดู"}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        href="/maintenance/new"
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-xl hover:bg-primary-hover sm:hidden"
      >
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  );
}
