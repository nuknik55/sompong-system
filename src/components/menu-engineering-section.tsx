"use client";

import { useState } from "react";
import { IconStar, IconHorse, IconPuzzle, IconDog } from "@tabler/icons-react";
import { MenuEngineeringTable, type MenuTableRow } from "@/components/menu-engineering-table";
import type { MenuEngineeringClass } from "@/lib/costing";

type IconComponent = React.ComponentType<{ className?: string; size?: number; stroke?: number }>;

const CLASS_ICON: Record<MenuEngineeringClass, IconComponent | null> = {
  Star:     IconStar,
  Horse:    IconHorse,
  Puzzle:   IconPuzzle,
  Dog:      IconDog,
  Unranked: null,
};

const CLASS_ICON_COLOR: Record<MenuEngineeringClass, string> = {
  Star:     "text-green-600",
  Horse:    "text-blue-600",
  Puzzle:   "text-amber-500",
  Dog:      "text-neutral-400",
  Unranked: "text-neutral-300",
};

const CLASS_LABEL: Record<MenuEngineeringClass, string> = {
  Star:     "พระเอก",
  Horse:    "ขายดีกำไรบาง",
  Puzzle:   "กำไรดีขายน้อย",
  Dog:      "ตัวถ่วง",
  Unranked: "ไม่มีข้อมูล",
};

const CLASS_SUBLABEL: Record<MenuEngineeringClass, string> = {
  Star:     "ขายดี + กำไรดี",
  Horse:    "ขายดี + กำไรบาง",
  Puzzle:   "กำไรดี + ขายน้อย",
  Dog:      "ขายน้อย + กำไรบาง",
  Unranked: "ยอดขาย",
};

const CLASS_ACTIVE_RING: Record<MenuEngineeringClass, string> = {
  Star:     "ring-2 ring-green-400",
  Horse:    "ring-2 ring-blue-400",
  Puzzle:   "ring-2 ring-amber-400",
  Dog:      "ring-2 ring-neutral-400",
  Unranked: "ring-2 ring-neutral-300",
};

type Props = {
  rows: MenuTableRow[];
  classCounts: Partial<Record<MenuEngineeringClass, number>>;
};

const FILTERABLE_CLASSES: MenuEngineeringClass[] = ["Star", "Horse", "Puzzle", "Dog"];

export function MenuEngineeringSection({ rows, classCounts }: Props) {
  const [classFilter, setClassFilter] = useState<MenuEngineeringClass | null>(null);

  function toggleFilter(cls: MenuEngineeringClass) {
    setClassFilter((prev) => (prev === cls ? null : cls));
  }

  const filteredRows = classFilter ? rows.filter((r) => r.menuClass === classFilter) : rows;

  return (
    <div className="space-y-6">
      {/* Clickable class summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FILTERABLE_CLASSES.map((cls) => {
          const isActive = classFilter === cls;
          const Icon = CLASS_ICON[cls];
          return (
            <button
              key={cls}
              type="button"
              onClick={() => toggleFilter(cls)}
              className={`rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-left text-sm transition-all hover:bg-neutral-100 ${isActive ? CLASS_ACTIVE_RING[cls] : ""}`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                {Icon && <Icon className={`h-4 w-4 shrink-0 ${CLASS_ICON_COLOR[cls]}`} />}
                <p className="font-medium text-neutral-800">{CLASS_LABEL[cls]}</p>
              </div>
              <p className="text-xs text-neutral-500">{CLASS_SUBLABEL[cls]}</p>
              <p className="mt-1.5 text-2xl font-semibold text-neutral-800">{classCounts[cls] ?? 0}</p>
            </button>
          );
        })}
      </div>

      {/* Active filter indicator */}
      {classFilter && (
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <span>กำลังดู: {CLASS_LABEL[classFilter]} ({filteredRows.length} เมนู)</span>
          <button
            type="button"
            onClick={() => setClassFilter(null)}
            className="text-xs underline hover:text-neutral-900"
          >
            ล้างตัวกรอง
          </button>
        </div>
      )}

      <MenuEngineeringTable rows={filteredRows} />
    </div>
  );
}
