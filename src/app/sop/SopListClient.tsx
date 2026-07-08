"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { deleteSop } from "@/app/sop/actions";
import type { SopListItem } from "@/lib/sop-data";

type Tab = "all" | "has" | "none";

const BADGE_COLORS: Record<string, string> = {};
const PALETTE = [
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
];
function catColor(cat: string): string {
  if (!BADGE_COLORS[cat]) {
    let h = 0;
    for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) & 0xffffff;
    BADGE_COLORS[cat] = PALETTE[Math.abs(h) % PALETTE.length];
  }
  return BADGE_COLORS[cat];
}

export function SopListClient({
  items,
  canEdit,
  isAdmin,
}: {
  items: SopListItem[];
  canEdit: boolean;  // admin or editor can see edit/delete buttons
  isAdmin: boolean;  // only admin can create directly (editor goes through pending on edit page)
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = items.filter((item) => {
    if (tab === "has" && !item.sopId) return false;
    if (tab === "none" && item.sopId) return false;
    if (search.trim() && !item.menuName.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  function handleDelete(menuId: string, menuName: string) {
    if (!confirm(`ลบ SOP ของ "${menuName}" แน่ใจหรือไม่? ลบแล้วกู้คืนไม่ได้`)) return;
    setDeletingId(menuId);
    startTransition(async () => {
      try {
        await deleteSop(menuId);
      } finally {
        setDeletingId(null);
      }
    });
  }

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: "all", label: "ทั้งหมด" },
    { key: "has", label: "มี SOP แล้ว" },
    { key: "none", label: "ยังไม่มี SOP" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex gap-1">
          {TAB_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full px-3 py-1 text-sm ${tab === key ? "bg-brand-green text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อเมนู..."
            className="w-full rounded-md border border-neutral-300 py-1.5 pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      <p className="text-xs text-neutral-400">พบ {filtered.length} รายการ</p>

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {filtered.map((item) => {
          const cat = item.menuCategory ?? "ไม่มีหมวด";

          // Compute which sections are missing (only relevant when SOP exists)
          const missing: string[] = [];
          if (item.sopId) {
            if ((item.prepCount ?? 0) === 0) missing.push("ขั้นตอนเตรียม");
            if ((item.cookCount ?? 0) === 0) missing.push("ขั้นตอนปรุง");
            if ((item.platingCount ?? 0) === 0) missing.push("จัดจาน");
            if ((item.checklistCount ?? 0) === 0) missing.push("checklist");
          }
          const sopComplete = item.sopId && missing.length === 0;

          return (
            <li key={item.menuId} className="px-4 py-3 space-y-1.5">
              {/* Main row */}
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/sop/${item.menuId}`}
                  className="min-w-0 flex-1 font-medium text-neutral-800 hover:text-brand-green"
                >
                  {item.menuName}
                </Link>

                <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${catColor(cat)}`}>{cat}</span>

                {item.sopId ? (
                  <span className={`shrink-0 text-xs ${sopComplete ? "text-green-600" : "text-amber-600"}`}>
                    {sopComplete ? "✓" : "⚠"} มี SOP — {item.updatedAt ?? ""}
                    {item.authorName ? ` (${item.authorName})` : ""}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-neutral-400">ยังไม่มี SOP</span>
                )}

                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    {item.sopId ? (
                      <>
                        <Link
                          href={`/sop/${item.menuId}/edit`}
                          className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100"
                        >
                          แก้ไข
                        </Link>
                        {isAdmin && (
                          <button
                            type="button"
                            disabled={isPending && deletingId === item.menuId}
                            onClick={() => handleDelete(item.menuId, item.menuName)}
                            className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
                          >
                            ลบ
                          </button>
                        )}
                      </>
                    ) : (
                      <Link
                        href={`/sop/${item.menuId}/edit`}
                        className="rounded border border-brand-green px-2 py-0.5 text-xs text-brand-green hover:bg-brand-green/5"
                      >
                        + สร้าง SOP
                      </Link>
                    )}
                  </div>
                )}
              </div>

              {/* Completion status row — only for existing SOPs */}
              {item.sopId && (
                <div className="flex flex-wrap gap-1">
                  {item.hasVideo && (
                    <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
                      🎬 มี VDO
                    </span>
                  )}
                  {missing.map((label) => (
                    <span key={label} className="rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-xs text-amber-700">
                      ยังไม่มี{label}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-neutral-400">ไม่พบรายการ</li>
        )}
      </ul>
    </div>
  );
}
