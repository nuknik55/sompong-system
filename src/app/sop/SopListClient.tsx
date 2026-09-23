"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { deleteSop } from "@/app/sop/actions";
import type { SopListItem } from "@/lib/sop-data";
import { Button, buttonClass } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { AccentTag, Badge, accentFor } from "@/components/ui/badge";
import { thaiDate } from "@/lib/thai-date";

type Tab = "all" | "has" | "none";

// Category tags take a brand ACCENT (components/ui/badge.tsx): told apart,
// not judged; the same category always gets the same one.

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
  const [error, setError] = useState<string | null>(null);

  const filtered = items.filter((item) => {
    if (tab === "has" && !item.sopId) return false;
    if (tab === "none" && item.sopId) return false;
    if (search.trim() && !item.menuName.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  function handleDelete(menuId: string, menuName: string) {
    if (!confirm(`ลบ SOP ของ "${menuName}" แน่ใจหรือไม่? ลบแล้วกู้คืนไม่ได้`)) return;
    setDeletingId(menuId);
    setError(null);
    startTransition(async () => {
      try {
        // This handler showed NOTHING on failure — try/finally only, so a
        // failed delete looked identical to a successful one (item 12).
        const result = await deleteSop(menuId, menuName);
        if (result.status === "error") setError(result.message);
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
      {error && (
        <p className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Segmented label="กรองรายการ" value={tab} options={TAB_LABELS.map(({ key, label }) => ({ value: key, label }))} onChange={setTab} />
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อเมนู..."
            className="w-full rounded-md border border-neutral-300 py-1.5 pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      <p className="text-xs text-neutral-500">พบ {filtered.length} รายการ</p>

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {filtered.map((item) => {
          const cat = item.menuCategory ?? "ไม่มีหมวด";

          // Compute which sections are missing (only relevant when SOP exists)
          const missing: string[] = [];
          if (item.sopId) {
            if ((item.prepCount ?? 0) === 0) missing.push("เตรียม");
            if ((item.cookCount ?? 0) === 0) missing.push("ปรุง");
            if ((item.platingCount ?? 0) === 0) missing.push("จัดจาน");
            if ((item.checklistCount ?? 0) === 0) missing.push("checklist");
          }
          const sopComplete = item.sopId && missing.length === 0;

          return (
            <li key={item.menuId} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Link
                href={`/sop/${item.menuId}`}
                className="min-w-0 flex-1 font-medium text-neutral-800 hover:text-primary"
              >
                {item.menuName}
              </Link>

              <span className="shrink-0"><AccentTag accent={accentFor(cat)}>{cat}</AccentTag></span>

              {item.sopId ? (
                <span className={`shrink-0 text-xs ${sopComplete ? "text-success-ink" : "text-pending-ink"}`}>
                  {sopComplete ? "✓" : "⚠"} มี SOP — {item.updatedAt ? thaiDate(item.updatedAt) : ""}
                  {item.authorName ? ` (${item.authorName})` : ""}
                  {missing.length > 0 && ` · ขาด: ${missing.join(", ")}`}
                </span>
              ) : (
                <span className="shrink-0 text-xs text-neutral-500">ยังไม่มี SOP</span>
              )}

              {item.hasVideo && (
                <span className="shrink-0"><Badge tone="info">🎬 VDO</Badge></span>
              )}

              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  {item.sopId ? (
                    <>
                      <Link
                        href={`/sop/${item.menuId}/edit`}
                        className={buttonClass("secondary", { size: "sm" })}
                      >
                        แก้ไข
                      </Link>
                      {isAdmin && (
                        <Button
                          kind="secondary"
                          size="sm"
                          danger
                          disabled={isPending && deletingId === item.menuId}
                          onClick={() => handleDelete(item.menuId, item.menuName)}
                        >
                          ลบ
                        </Button>
                      )}
                    </>
                  ) : (
                    <Link
                      href={`/sop/${item.menuId}/edit`}
                      className={buttonClass("secondary", { size: "sm" })}
                    >
                      + สร้าง SOP
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-8 text-center text-sm text-neutral-500">ไม่พบรายการ</li>
        )}
      </ul>
    </div>
  );
}
