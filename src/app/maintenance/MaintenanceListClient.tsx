"use client";

import { useState } from "react";
import Link from "next/link";
import { Zap, Droplets, UtensilsCrossed, MoreHorizontal, AlertTriangle } from "lucide-react";
import type { MaintenanceReport, MaintenanceStatus } from "@/lib/maintenance-data";

// ── Helpers ────────────────────────────────────────────────────────────────────

const CAT_ICON: Record<string, React.ReactNode> = {
  ไฟฟ้า: <Zap className="h-3.5 w-3.5" />,
  ประปา: <Droplets className="h-3.5 w-3.5" />,
  เครื่องครัว: <UtensilsCrossed className="h-3.5 w-3.5" />,
  อื่นๆ: <MoreHorizontal className="h-3.5 w-3.5" />,
};
const CAT_COLOR: Record<string, string> = {
  ไฟฟ้า: "bg-amber-100 text-amber-700",
  ประปา: "bg-blue-100 text-blue-700",
  เครื่องครัว: "bg-green-100 text-green-700",
  อื่นๆ: "bg-neutral-100 text-neutral-600",
};

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  new: "แจ้งแล้ว",
  in_progress: "กำลังซ่อม",
  done: "เสร็จแล้ว",
};
const STATUS_COLOR: Record<MaintenanceStatus, string> = {
  new: "bg-amber-100 text-amber-800",
  in_progress: "bg-blue-100 text-blue-800",
  done: "bg-green-100 text-green-700",
};

function relTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

// ── Component ─────────────────────────────────────────────────────────────────

type Filter = "all" | MaintenanceStatus;

export function MaintenanceListClient({
  reports,
  canManage,
}: {
  reports: MaintenanceReport[];
  canManage: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const counts: Record<Filter, number> = {
    all: reports.length,
    new: reports.filter((r) => r.status === "new").length,
    in_progress: reports.filter((r) => r.status === "in_progress").length,
    done: reports.filter((r) => r.status === "done").length,
  };

  const filtered = filter === "all" ? reports : reports.filter((r) => r.status === filter);

  const TABS: { key: Filter; label: string }[] = [
    { key: "all", label: `ทั้งหมด (${counts.all})` },
    { key: "new", label: `แจ้งแล้ว (${counts.new})` },
    { key: "in_progress", label: `กำลังซ่อม (${counts.in_progress})` },
    { key: "done", label: `เสร็จแล้ว (${counts.done})` },
  ];

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5 overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === key
                ? "bg-brand-green text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
            style={filter === key ? { backgroundColor: "#2F5A16" } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">ไม่มีรายการ</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => {
            const cat = r.category;
            const catCls = CAT_COLOR[cat] ?? CAT_COLOR["อื่นๆ"];
            const icon = CAT_ICON[cat] ?? CAT_ICON["อื่นๆ"];
            return (
              <li key={r.id}>
                <Link
                  href={`/maintenance/${r.id}`}
                  className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-3.5 hover:border-neutral-300 hover:bg-neutral-50 transition-colors"
                >
                  {/* Thumbnail */}
                  {r.photoBefore ? (
                    <div className="shrink-0 h-12 w-12 overflow-hidden rounded-lg bg-neutral-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.photoBefore}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className={`shrink-0 flex h-12 w-12 items-center justify-center rounded-lg ${catCls}`}>
                      {icon}
                    </div>
                  )}

                  {/* Content */}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm text-neutral-800 leading-snug">
                        {cat} {r.location ? `— ${r.location}` : ""}
                      </p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    {r.description && (
                      <p className="text-xs text-neutral-500 line-clamp-1">{r.description}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-400">
                      {r.isUrgent && (
                        <span className="flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-red-600 font-medium">
                          <AlertTriangle className="h-2.5 w-2.5" />
                          เร่งด่วน
                        </span>
                      )}
                      <span>แจ้งโดย {r.reporterName || "ไม่ระบุ"}</span>
                      <span>·</span>
                      <span>{relTime(r.createdAt)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
