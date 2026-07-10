"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap, Droplets, UtensilsCrossed, MoreHorizontal, AlertTriangle, Plus } from "lucide-react";
import type { MaintenanceReport, MaintenanceStatus } from "@/lib/maintenance-data";

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

const CAT_ICON: Record<string, React.ReactNode> = {
  ไฟฟ้า: <Zap className="h-3.5 w-3.5 text-yellow-500" />,
  ประปา: <Droplets className="h-3.5 w-3.5 text-blue-500" />,
  เครื่องครัว: <UtensilsCrossed className="h-3.5 w-3.5 text-green-700" />,
  อื่นๆ: <MoreHorizontal className="h-3.5 w-3.5 text-neutral-500" />,
};

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  new: "แจ้งแล้ว",
  in_progress: "กำลังซ่อม",
  done: "เสร็จแล้ว",
};
const STATUS_CLS: Record<MaintenanceStatus, string> = {
  new: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

type Tab = "all" | MaintenanceStatus;
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "new", label: "แจ้งแล้ว" },
  { key: "in_progress", label: "กำลังซ่อม" },
  { key: "done", label: "เสร็จแล้ว" },
];

export function MaintenanceListClient({
  reports,
  canManage,
  currentUserId,
}: {
  reports: MaintenanceReport[];
  canManage: boolean;
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
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                tab === key
                  ? "font-medium text-white"
                  : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              }`}
              style={tab === key ? { backgroundColor: "#2F5A16" } : undefined}
            >
              {label} ({n})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">ไม่มีรายการ</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => {
            const canEdit = r.reporterId === currentUserId && r.status === "new";
            return (
              <li key={r.id} className="rounded-xl border border-neutral-200 bg-white p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-neutral-800">
                      {CAT_ICON[r.category] ?? CAT_ICON["อื่นๆ"]}
                      <span>{r.category} — {r.location || "ไม่ระบุจุด"}</span>
                    </div>
                    {r.description && (
                      <p className="mt-0.5 text-xs text-neutral-500 line-clamp-2">{r.description}</p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[r.status]}`}>
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
                      <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">
                        <AlertTriangle className="h-3 w-3" /> เร่งด่วน
                      </span>
                    )}
                    <span className="text-xs text-neutral-400">
                      {r.reporterName || "ไม่ระบุ"} · {relTime(r.createdAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    {canEdit && (
                      <Link
                        href={`/maintenance/${r.id}/edit`}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
                      >
                        แก้ไข
                      </Link>
                    )}
                    <Link
                      href={`/maintenance/${r.id}`}
                      className={`rounded border px-2 py-0.5 text-xs font-medium ${
                        canManage && r.status !== "done"
                          ? "border-green-700 text-green-700 hover:bg-green-50"
                          : "border-neutral-200 text-neutral-500 hover:bg-neutral-100"
                      }`}
                    >
                      {canManage && r.status !== "done" ? "จัดการ" : "ดู"}
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
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full shadow-xl text-white sm:hidden"
        style={{ backgroundColor: "#2F5A16" }}
      >
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  );
}
