"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCateringTaskCompletion } from "../actions";
import type { CateringEvent, TaskCompletion } from "../actions";
import { CHECKLIST_STEPS } from "../checklist";
import { thDate } from "../shared";

export function TaskChecklistSection({
  event,
  initialCompletions,
}: {
  event: CateringEvent;
  initialCompletions: TaskCompletion[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const completedMap = new Map(initialCompletions.map((c) => [c.task_key, c.completed_at]));

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const steps = CHECKLIST_STEPS.filter((s) => !s.showFor || s.showFor(event.location_type));
  const completedCount = steps.filter((s) => completedMap.get(s.key) != null).length;

  function toggle(key: string, next: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        await setCateringTaskCompletion(event.id, key, next);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    // Native <details>/<summary> — same collapsible pattern already used in
    // pos-sales-import.tsx, collapsed by default (no `open` attribute).
    <details className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6">
      <summary className="cursor-pointer font-kanit text-base font-semibold text-neutral-900">
        เช็คลิสต์งาน ({completedCount}/{steps.length} เสร็จ)
      </summary>
      <div className="divide-y divide-neutral-100">
        {steps.map((step) => {
          const checked = completedMap.get(step.key) != null;
          const dateStr = step.date ? step.date(event.event_date) : null;
          const isOverdue = !!step.isDeadline && !checked && dateStr !== null && dateStr < todayStr;
          return (
            <label key={step.key} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isPending}
                  onChange={(e) => toggle(step.key, e.target.checked)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
                <span className={`text-sm ${checked ? "text-neutral-400 line-through" : "text-neutral-800"}`}>{step.label}</span>
              </span>
              {dateStr && (
                <span className={`whitespace-nowrap text-xs tabular-nums ${isOverdue ? "font-medium text-red-600" : "text-neutral-400"}`}>
                  {isOverdue ? "เลยกำหนด · " : ""}{thDate(dateStr)}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </details>
  );
}
