"use client";

import { useState, useTransition } from "react";
import { updateQFactor } from "@/app/owner/settings/actions";

export function QFactorSetting({ initial, isOwner }: { initial: number; isOwner: boolean }) {
  const [value, setValue] = useState(String(initial));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm">
      <span className="text-neutral-500">Q-factor (ค่าเผื่อแก๊ส/เครื่องปรุงเล็กๆ/บรรจุภัณฑ์ทุกเมนู)</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        readOnly={!isOwner}
        onChange={isOwner ? (e) => {
          setValue(e.target.value.replace(/[^0-9.]/g, ""));
          setSaved(false);
        } : undefined}
        className={`w-16 rounded border border-neutral-300 px-2 py-1 text-right ${!isOwner ? "bg-neutral-50 text-neutral-400 cursor-default" : ""}`}
      />
      <span className="text-neutral-500">%</span>
      {isOwner && !saved && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              // Previously no handling at all: a failed save was an unhandled
              // rejection and the button just did not change (item 12).
              setError(null);
              const result = await updateQFactor(Number(value) || 0);
              if (result.status === "error") { setError(result.message); return; }
              setSaved(true);
            })
          }
          className="rounded bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          บันทึก
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
