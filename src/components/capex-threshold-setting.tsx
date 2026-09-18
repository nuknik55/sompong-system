"use client";

import { useState, useTransition } from "react";
import { updateCapexThreshold } from "@/app/owner/settings/actions";

/**
 * The amount above which บันทึกรายวัน asks whether a purchase is CapEx
 * (queue item 9). Owner-set, like the Q-factor beside it: an admin sees the
 * figure and cannot change it, and updateCapexThreshold refuses them again on
 * the server.
 *
 * 0 turns the question off — stated on screen, because a control that can be
 * switched off silently is one nobody can tell is off.
 */
export function CapexThresholdSetting({ initial, isOwner }: { initial: number; isOwner: boolean }) {
  const [value, setValue] = useState(String(initial));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm">
      <span className="text-neutral-500" title="ใส่ 0 เพื่อปิดการเตือน">
        เตือน CapEx เมื่อเกิน (หมวดอุปกรณ์/ซ่อมบำรุง)
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        readOnly={!isOwner}
        onChange={isOwner ? (e) => {
          setValue(e.target.value.replace(/[^0-9.]/g, ""));
          setSaved(false);
        } : undefined}
        className={`w-24 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums ${!isOwner ? "bg-neutral-50 text-neutral-400 cursor-default" : ""}`}
      />
      <span className="text-neutral-500">฿</span>
      {isOwner && !saved && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              // Same care as the Q-factor beside it: a change believed to have
              // landed and did not means the question is asked at the old
              // amount for as long as nobody notices.
              setError(null);
              try {
                const result = await updateCapexThreshold(Number(value) || 0);
                if (result.status === "error") { setError(result.message); return; }
                setSaved(true);
              } catch {
                setError("บันทึกไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่");
              }
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
