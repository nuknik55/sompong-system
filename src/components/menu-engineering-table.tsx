"use client";

import { useMemo, useState } from "react";
import { IconStar, IconHorse, IconPuzzle, IconDog } from "@tabler/icons-react";
import type { MenuEngineeringClass } from "@/lib/costing";

export type MenuTableRow = {
  id: string;
  name: string;
  qtySold: number;
  sellingPrice: number;
  totalCost: number;
  foodCostPct: number | null;
  profitPerUnit: number;
  menuClass: MenuEngineeringClass;
  hasUnknownCost: boolean;
  isPremium?: boolean;
};

const CLASS_COLOR: Record<MenuEngineeringClass, string> = {
  Star: "bg-green-100 text-green-800",
  Horse: "bg-blue-100 text-blue-800",
  Puzzle: "bg-amber-100 text-amber-800",
  Dog: "bg-neutral-200 text-neutral-700",
  Unranked: "bg-neutral-100 text-neutral-400",
};

const CLASS_ICON: Partial<Record<MenuEngineeringClass, React.ComponentType<{ className?: string; size?: number; stroke?: number }>>> = {
  Star:   IconStar,
  Horse:  IconHorse,
  Puzzle: IconPuzzle,
  Dog:    IconDog,
};

const CLASS_LABEL_TH: Record<MenuEngineeringClass, string> = {
  Star: "พระเอก",
  Horse: "ขายดีกำไรบาง",
  Puzzle: "กำไรดีขายน้อย",
  Dog: "ตัวถ่วง",
  Unranked: "ไม่มีข้อมูล",
};

function ClassBadge({ cls }: { cls: MenuEngineeringClass }) {
  const Icon = CLASS_ICON[cls];
  return (
    <span className="inline-flex items-center gap-1">
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      {CLASS_LABEL_TH[cls]}
    </span>
  );
}

function formatBaht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type SortKey = "name" | "qtySold" | "sellingPrice" | "totalCost" | "foodCostPct" | "profitPerUnit" | "menuClass";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "เมนู" },
  { key: "qtySold", label: "ขาย (จาน)", align: "right" },
  { key: "sellingPrice", label: "ราคาขาย", align: "right" },
  { key: "totalCost", label: "ต้นทุน", align: "right" },
  { key: "foodCostPct", label: "%Food Cost", align: "right" },
  { key: "profitPerUnit", label: "กำไร/จาน", align: "right" },
  { key: "menuClass", label: "กลุ่ม" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "qtySold", label: "เรียงตามยอดขาย" },
  { value: "name", label: "เรียงตามชื่อ" },
  { value: "sellingPrice", label: "เรียงตามราคาขาย" },
  { value: "totalCost", label: "เรียงตามต้นทุน" },
  { value: "foodCostPct", label: "เรียงตาม %Food Cost" },
  { value: "profitPerUnit", label: "เรียงตามกำไร/จาน" },
  { value: "menuClass", label: "เรียงตามกลุ่ม" },
];

function exportCsv(rows: MenuTableRow[]) {
  const header = ["เมนู", "ขาย (จาน)", "ราคาขาย", "ต้นทุน", "%Food Cost", "กำไร/จาน", "กลุ่ม"];
  const lines = rows.map((r) =>
    [
      r.name,
      r.qtySold,
      r.sellingPrice.toFixed(2),
      r.totalCost.toFixed(2),
      r.foodCostPct != null ? `${(r.foodCostPct * 100).toFixed(1)}%` : "",
      r.profitPerUnit.toFixed(2),
      r.menuClass,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = "﻿" + [header.join(","), ...lines].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `menu-cost-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function MenuEngineeringTable({ rows }: { rows: MenuTableRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("qtySold");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function clickHeader(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === "string" && typeof bv === "string") {
        cmp = av.localeCompare(bv, "th");
      } else {
        cmp = ((av as number) ?? -Infinity) - ((bv as number) ?? -Infinity);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  return (
    <div>
      {/* Action bar — export/print (desktop only) + mobile sort selector */}
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
        {/* Mobile: sort dropdown (headers not visible on cards) */}
        <div className="flex items-center gap-2 md:hidden">
          <select
            value={`${sortKey}_${sortDir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split("_") as [SortKey, "asc" | "desc"];
              setSortKey(k);
              setSortDir(d);
            }}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={`${o.value}_desc`} value={`${o.value}_desc`}>{o.label} ↓</option>
            ))}
            {SORT_OPTIONS.map((o) => (
              <option key={`${o.value}_asc`} value={`${o.value}_asc`}>{o.label} ↑</option>
            ))}
          </select>
        </div>
        {/* Desktop: export/print */}
        <div className="hidden md:flex gap-2 ml-auto">
          <button
            type="button"
            onClick={() => exportCsv(sorted)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            ดาวน์โหลด CSV (Excel)
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            พิมพ์ / บันทึกเป็น PDF
          </button>
        </div>
      </div>

      {/* ── Desktop table ─────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => clickHeader(col.key)}
                  className={`cursor-pointer select-none px-3 py-2 hover:text-neutral-900 ${col.align === "right" ? "text-right" : ""}`}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir === "asc" ? " ▲" : " ▼")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-brand-green/5 transition-colors">
                <td className="px-3 py-2">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {r.name}
                    {r.isPremium && (
                      <span className="rounded bg-brand-gold/20 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        พรีเมียม
                      </span>
                    )}
                    {r.hasUnknownCost && (
                      <span className="text-xs text-amber-600" title="มีวัตถุดิบที่ยังไม่มีราคา">⚠</span>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.qtySold.toLocaleString("th-TH")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBaht(r.sellingPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBaht(r.totalCost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.foodCostPct != null ? `${(r.foodCostPct * 100).toFixed(1)}%` : "-"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBaht(r.profitPerUnit)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${CLASS_COLOR[r.menuClass]}`}>{r.menuClass}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ──────────────────────────────────────────── */}
      <div className="space-y-2 md:hidden">
        {sorted.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm"
          >
            {/* Card header: name + ME class badge */}
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <span className="font-medium text-neutral-900">{r.name}</span>
                {r.isPremium && (
                  <span className="rounded bg-brand-gold/20 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                    พรีเมียม
                  </span>
                )}
                {r.hasUnknownCost && (
                  <span className="text-xs text-amber-600" title="มีวัตถุดิบที่ยังไม่มีราคา">⚠</span>
                )}
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${CLASS_COLOR[r.menuClass]}`}>
                <ClassBadge cls={r.menuClass} />
              </span>
            </div>
            {/* Key figures as label-value grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-neutral-500">ขาย</span>
              <span className="text-right tabular-nums">{r.qtySold.toLocaleString("th-TH")} จาน</span>
              <span className="text-neutral-500">ราคาขาย</span>
              <span className="text-right tabular-nums">{formatBaht(r.sellingPrice)} บาท</span>
              <span className="text-neutral-500">ต้นทุน</span>
              <span className="text-right tabular-nums">{formatBaht(r.totalCost)} บาท</span>
              <span className="text-neutral-500">%Food Cost</span>
              <span className="text-right tabular-nums">
                {r.foodCostPct != null ? `${(r.foodCostPct * 100).toFixed(1)}%` : "-"}
              </span>
              <span className="text-neutral-500">กำไร/จาน</span>
              <span className={`text-right tabular-nums font-medium ${r.profitPerUnit < 0 ? "text-red-600" : "text-green-700"}`}>
                {formatBaht(r.profitPerUnit)} บาท
              </span>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-400">ไม่พบรายการ</p>
        )}
      </div>
    </div>
  );
}
