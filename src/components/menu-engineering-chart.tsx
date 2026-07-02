"use client";

import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";
import { IconStar, IconHorse, IconPuzzle, IconDog } from "@tabler/icons-react";
import type { MenuEngineeringClass } from "@/lib/costing";

const COLOR: Record<MenuEngineeringClass, string> = {
  Star: "#16a34a",
  Horse: "#2563eb",
  Puzzle: "#d97706",
  Dog: "#9ca3af",
  Unranked: "#e5e7eb",
};

type LegendItem = {
  cls: MenuEngineeringClass;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const LEGEND: LegendItem[] = [
  { cls: "Star",   label: "พระเอก",          Icon: IconStar },
  { cls: "Horse",  label: "ขายดีกำไรบาง",    Icon: IconHorse },
  { cls: "Puzzle", label: "กำไรดีแต่ขายน้อย", Icon: IconPuzzle },
  { cls: "Dog",    label: "ตัวถ่วง",          Icon: IconDog },
];

type Point = {
  name: string;
  popularPct: number;
  profitPerUnit: number;
  qtySold: number;
  menuClass: MenuEngineeringClass;
};

function fullDomain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const padding = Math.max((hi - lo) * 0.08, hi - lo === 0 ? Math.abs(hi || 1) * 0.1 : 0);
  return [lo - padding, hi + padding];
}

function niceYTicks(lo: number, hi: number, count = 5): number[] {
  if (lo === hi) return [Math.round(lo)];
  const range = hi - lo;
  const roughStep = range / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(roughStep) || 1)));
  const step = Math.ceil(roughStep / mag) * mag;
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= hi + step * 0.01 && ticks.length < count * 2; t += step) {
    ticks.push(Math.round(t));
  }
  if (ticks.length === 0 || ticks[0] > Math.round(lo)) ticks.unshift(Math.round(lo));
  if (ticks[ticks.length - 1] < Math.round(hi)) ticks.push(Math.round(hi));
  return [...new Set(ticks)].sort((a, b) => a - b);
}

export function MenuEngineeringChart({ data }: { data: Point[] }) {
  const plotData = data;

  const [xMin, xMax] = fullDomain(plotData.map((d) => d.popularPct));
  const [yMin, yMax] = fullDomain(plotData.map((d) => d.profitPerUnit));
  const yTicks = niceYTicks(yMin, yMax, 5);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-neutral-700">
        แผนภาพ Menu Engineering — แกน X = ความนิยม (%), แกน Y = กำไรต่อจาน (บาท)
      </p>

      {/* Color legend */}
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {LEGEND.map(({ cls, label, Icon }) => (
          <span key={cls} className="flex items-center gap-1.5 text-xs text-neutral-600">
            <span style={{ color: COLOR[cls] }}>
              <Icon className="h-3.5 w-3.5 shrink-0" />
            </span>
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-neutral-400">
          <span className="inline-block h-3 w-3 flex-shrink-0 rounded-full border border-neutral-300" style={{ backgroundColor: COLOR.Unranked }} />
          ยังไม่มีข้อมูลยอดขาย
        </span>
      </div>

      <p className="mb-2 text-xs text-neutral-400">
        * แกนครอบคลุมทุกเมนู เมนูขายดีมากๆ อาจทำให้จุดอื่นกระจุกกันที่มุมซ้าย — ดูตัวเลขจริงในตารางด้านล่าง หรือชี้ที่จุดเพื่อดูรายละเอียด
      </p>

      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="popularPct"
            name="ความนิยม"
            unit="%"
            domain={[Math.max(0, xMin), xMax]}
            allowDataOverflow
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => v.toFixed(3)}
          />
          <YAxis
            type="number"
            dataKey="profitPerUnit"
            name="กำไรต่อจาน"
            domain={[yMin, yMax]}
            ticks={yTicks}
            width={58}
            allowDataOverflow
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => Math.round(v).toLocaleString("th-TH")}
          />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Point;
              return (
                <div className="rounded border border-neutral-200 bg-white p-2 text-xs shadow">
                  <p className="font-medium">{p.name}</p>
                  <p>ยอดขาย: {p.qtySold.toLocaleString("th-TH")} จาน</p>
                  <p>ความนิยม: {p.popularPct.toFixed(2)}%</p>
                  <p>กำไรต่อจาน: {p.profitPerUnit.toFixed(2)} บาท</p>
                  <p>กลุ่ม: {p.menuClass}</p>
                </div>
              );
            }}
          />
          <Scatter data={plotData}>
            {plotData.map((d, idx) => (
              <Cell key={idx} fill={COLOR[d.menuClass]} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
