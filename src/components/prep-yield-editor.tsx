"use client";

import { useState, useTransition } from "react";
import { updatePrepYield } from "@/app/staff/prep/actions";
import { buttonClass } from "@/components/ui/button";
import { BATCH_YIELD_REFUSAL, parseBatchYield } from "@/components/sop-rules";

export function PrepYieldEditor({
  prepId,
  prepName,
  initialQty,
  initialUnit,
  submitMode = "save",
}: {
  prepId: string;
  prepName: string;
  initialQty: number;
  initialUnit: string;
  submitMode?: "save" | "pending";
}) {
  const [qty, setQty] = useState(String(initialQty));
  const [unit, setUnit] = useState(initialUnit);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "pending">("idle");

  const dirty = qty !== String(initialQty) || unit !== initialUnit;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-500">
      <span>ทำได้</span>
      <input
        type="text"
        inputMode="decimal"
        value={qty}
        onChange={(e) => { setQty(e.target.value.replace(/[^0-9.]/g, "")); setSaveStatus("idle"); }}
        className="w-20 rounded border border-neutral-300 px-2 py-1 text-right"
      />
      <input
        type="text"
        value={unit}
        onChange={(e) => { setUnit(e.target.value); setSaveStatus("idle"); }}
        className="w-20 rounded border border-neutral-300 px-2 py-1"
      />
      <span>ต่อรอบ</span>
      {dirty && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              // Queue item 44: a blank, "." or "1.2.3" used to save as 0.
              const batch = parseBatchYield(qty);
              if (batch === null) { setError(BATCH_YIELD_REFUSAL); return; }
              try {
                const result = await updatePrepYield(prepId, batch, unit, { prepName });
                if (result.status === "error") { setError(result.message); setSaveStatus("idle"); return; }
                setError(null);
                setSaveStatus(result.status);
              } catch (e) {
                // Unexpected only — expected failures come back as values now.
                setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
              }
            })
          }
          className={buttonClass("primary", { size: "sm" })}
        >
          {submitMode === "pending" ? "ส่งขออนุมัติ" : "บันทึก"}
        </button>
      )}
      {error && <span className="text-danger">{error}</span>}
      {saveStatus === "saved" && !dirty && <span className="text-xs text-success-ink">✓ บันทึกสำเร็จ</span>}
      {saveStatus === "pending" && <span className="text-xs text-pending-ink">⏳ ส่งขออนุมัติแล้ว</span>}
    </div>
  );
}
