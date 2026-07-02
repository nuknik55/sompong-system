"use client";

import { useState, useTransition } from "react";
import { updateQFactor } from "@/app/owner/settings/actions";

export function QFactorSetting({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(true);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm">
      <span className="text-neutral-500">Q-factor (ค่าเผื่อแก๊ส/เครื่องปรุงเล็กๆ/บรรจุภัณฑ์ทุกเมนู)</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          setValue(e.target.value.replace(/[^0-9.]/g, ""));
          setSaved(false);
        }}
        className="w-16 rounded border border-neutral-300 px-2 py-1 text-right"
      />
      <span className="text-neutral-500">%</span>
      {!saved && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await updateQFactor(Number(value) || 0);
              setSaved(true);
            })
          }
          className="rounded bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          บันทึก
        </button>
      )}
    </div>
  );
}
