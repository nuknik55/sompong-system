"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEmployeeSortOrders } from "../../actions";
import type { Employee } from "../../actions";

type EmpItem = Pick<Employee, "id" | "full_name" | "nickname" | "department_name" | "sort_order">;

function groupByDept(emps: EmpItem[]) {
  const map = new Map<string, EmpItem[]>();
  for (const e of emps) {
    const k = e.department_name ?? "(ไม่มีแผนก)";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(e);
  }
  return [...map.entries()];
}

export function ReorderClient({ initialEmployees }: { initialEmployees: EmpItem[] }) {
  const [groups, setGroups] = useState<{ dept: string; emps: EmpItem[] }[]>(() =>
    groupByDept(initialEmployees).map(([dept, emps]) => ({ dept, emps }))
  );
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const dragItem = useRef<{ dept: string; idx: number } | null>(null);
  const dragOver = useRef<{ dept: string; idx: number } | null>(null);

  function handleDragStart(dept: string, idx: number) {
    dragItem.current = { dept, idx };
  }

  function handleDragEnter(dept: string, idx: number) {
    dragOver.current = { dept, idx };
    if (!dragItem.current || dragItem.current.dept !== dept) return;
    if (dragItem.current.idx === idx) return;

    setGroups((prev) => prev.map((g) => {
      if (g.dept !== dept) return g;
      const emps = [...g.emps];
      const [moved] = emps.splice(dragItem.current!.idx, 1);
      emps.splice(idx, 0, moved);
      dragItem.current = { dept, idx };
      return { ...g, emps };
    }));
  }

  function handleDragEnd() {
    dragItem.current = null;
    dragOver.current = null;
    setSaved(false);
  }

  function save() {
    const updates: { id: string; sort_order: number }[] = [];
    for (const g of groups) {
      g.emps.forEach((e, i) => updates.push({ id: e.id, sort_order: (i + 1) * 10 }));
    }
    startTransition(async () => {
      await updateEmployeeSortOrders(updates);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">จัดเรียงพนักงาน</h1>
          <p className="text-xs text-neutral-500 mt-0.5">ลากขึ้น/ลง เพื่อเปลี่ยนลำดับภายในแผนก</p>
        </div>
        <button
          onClick={save}
          disabled={isPending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก…" : saved ? "บันทึกแล้ว ✓" : "บันทึก"}
        </button>
      </div>

      {groups.map(({ dept, emps }) => (
        <div key={dept} className="rounded-xl border border-neutral-200 overflow-hidden">
          <div className="bg-neutral-100 px-4 py-2 text-xs font-semibold text-neutral-600">
            {dept} <span className="font-normal text-neutral-400">({emps.length} คน)</span>
          </div>
          <ul className="divide-y divide-neutral-100">
            {emps.map((emp, idx) => (
              <li
                key={emp.id}
                draggable
                onDragStart={() => handleDragStart(dept, idx)}
                onDragEnter={() => handleDragEnter(dept, idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
                className="flex items-center gap-3 px-4 py-2.5 bg-white hover:bg-neutral-50 cursor-grab active:cursor-grabbing select-none"
              >
                <span className="text-neutral-300 text-sm">⠿</span>
                <span className="text-sm font-medium text-neutral-900">
                  {emp.nickname ?? emp.full_name}
                </span>
                {emp.nickname && (
                  <span className="text-xs text-neutral-400 truncate">{emp.full_name}</span>
                )}
                <span className="ml-auto text-xs text-neutral-300">{idx + 1}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
