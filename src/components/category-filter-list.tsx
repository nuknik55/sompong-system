"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";

export type FilterableItem = {
  id: string;
  name: string;
  category: string | null;
  subtitle?: string;
  meClass?: string; // Menu Engineering class for sort — "Star" | "Horse" | "Puzzle" | "Dog" | "Unranked"
  hiddenFromStaff?: boolean;
};

// Soft palette for category badges — color is picked by hashing the category name
// so the same category always gets the same color across the list.
const BADGE_COLORS = [
  "bg-sky-100 text-sky-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700",
];

function categoryBadgeColor(cat: string): string {
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = (hash * 31 + cat.charCodeAt(i)) & 0xffffff;
  return BADGE_COLORS[Math.abs(hash) % BADGE_COLORS.length];
}

const ME_ORDER: Record<string, number> = { Star: 0, Horse: 1, Puzzle: 2, Dog: 3, Unranked: 4 };

type SortMode = "name" | "category" | "me";

const PAGE_SIZE = 25;

export function CategoryFilterList({
  items,
  hrefPrefix,
  placeholder = "พิมพ์ค้นหาชื่อ...",
}: {
  items: FilterableItem[];
  hrefPrefix: string;
  placeholder?: string;
}) {
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(item.category ?? "ไม่มีหมวด");
    return ["ทั้งหมด", ...Array.from(set).sort((a, b) => a.localeCompare(b, "th"))];
  }, [items]);

  const hasMeData = items.some((i) => i.meClass != null);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ทั้งหมด");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [page, setPage] = useState(0);

  // Reset to first page whenever filters or sort change.
  useEffect(() => {
    setPage(0);
  }, [search, category, sortMode]);

  const filtered = useMemo(() => {
    const base = items.filter((item) => {
      const itemCategory = item.category ?? "ไม่มีหมวด";
      if (category !== "ทั้งหมด" && itemCategory !== category) return false;
      if (search.trim() && !item.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });

    if (sortMode === "category") {
      base.sort((a, b) => {
        const ca = a.category ?? "ไม่มีหมวด";
        const cb = b.category ?? "ไม่มีหมวด";
        const cmp = ca.localeCompare(cb, "th");
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name, "th");
      });
    } else if (sortMode === "me") {
      base.sort((a, b) => {
        const ma = ME_ORDER[a.meClass ?? "Unranked"] ?? 4;
        const mb = ME_ORDER[b.meClass ?? "Unranked"] ?? 4;
        return ma !== mb ? ma - mb : a.name.localeCompare(b.name, "th");
      });
    } else {
      base.sort((a, b) => a.name.localeCompare(b.name, "th"));
    }

    return base;
  }, [items, search, category, sortMode]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-md border border-neutral-300 py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm sm:w-48"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm sm:w-52"
        >
          <option value="name">เรียงตามชื่อ (ก–ฮ)</option>
          <option value="category">เรียงตามหมวด</option>
          {hasMeData && <option value="me">เรียงตาม ME group (Star→Dog)</option>}
        </select>
      </div>

      <p className="text-xs text-neutral-400">
        พบ {filtered.length} รายการ
        {totalPages > 1 && ` — หน้า ${page + 1} / ${totalPages}`}
      </p>

      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
        {pageItems.map((item) => {
          const cat = item.category ?? "ไม่มีหมวด";
          const badgeColor = categoryBadgeColor(cat);
          return (
            <li key={item.id}>
              <Link href={`${hrefPrefix}/${item.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-neutral-50">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{item.name}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${badgeColor}`}>{cat}</span>
                  {item.hiddenFromStaff && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700">🔒 ซ่อน</span>
                  )}
                </div>
                {item.subtitle && (
                  <span className="shrink-0 text-sm text-neutral-400">{item.subtitle}</span>
                )}
              </Link>
            </li>
          );
        })}
        {pageItems.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-neutral-400">ไม่พบรายการ</li>
        )}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            ก่อนหน้า
          </button>
          <span className="text-sm text-neutral-500">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
          >
            ถัดไป
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
