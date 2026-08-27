"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addCateringEventLabor, deleteCateringEventLabor } from "../../actions";
import type { CateringEventLabor, CateringTransferCostRate } from "../../actions";
import { COST_TYPE_OPTIONS, Field, fmtBaht, toNum } from "../../shared-utils";

type Draft = {
  rate: CateringTransferCostRate;
  quantity: string;
  amount: string;
  note: string;
};

function CostRatePicker({
  rates,
  disabled,
  onPick,
}: {
  rates: CateringTransferCostRate[];
  disabled: boolean;
  onPick: (r: CateringTransferCostRate) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(ev: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const activeRates = rates.filter((r) => r.is_active);

  return (
    <div ref={boxRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        + เพิ่มต้นทุน
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
          {COST_TYPE_OPTIONS.map((group) => {
            const rows = activeRates.filter((r) => r.cost_type === group.value);
            if (rows.length === 0) return null;
            return (
              <div key={group.value}>
                <div className="sticky top-0 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-500">{group.label}</div>
                {rows.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => { onPick(r); setOpen(false); }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <span className="text-neutral-800">{r.label}</span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">
                      ฿{fmtBaht(r.amount)}{r.unit ? `/${r.unit}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
          {activeRates.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-neutral-400">ยังไม่มีอัตราต้นทุน — ตั้งค่าที่หน้าต้นทุนภายใน</p>
          )}
        </div>
      )}
    </div>
  );
}

export function CostSummaryClient({
  eventId,
  laborEntries,
  costRates,
  revenue,
  foodCost,
  hasUnknownFoodCost,
}: {
  eventId: string;
  laborEntries: CateringEventLabor[];
  costRates: CateringTransferCostRate[];
  revenue: number;
  foodCost: number;
  hasUnknownFoodCost: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const laborCost = laborEntries.reduce((s, l) => s + l.amount, 0);
  const profit = revenue - foodCost - laborCost;
  const profitPct = revenue > 0 ? (profit / revenue) * 100 : null;

  function pickRate(rate: CateringTransferCostRate) {
    setError(null);
    setDraft({ rate, quantity: "1", amount: rate.amount.toString(), note: "" });
  }

  function updateDraftQuantity(q: string) {
    setDraft((d) => {
      if (!d) return d;
      const qNum = toNum(q) ?? 0;
      return { ...d, quantity: q, amount: (qNum * d.rate.amount).toString() };
    });
  }

  function confirmAdd() {
    if (!draft) return;
    const quantity = toNum(draft.quantity) ?? 0;
    const amount = toNum(draft.amount) ?? 0;
    if (quantity <= 0) {
      setError("กรุณาระบุจำนวน");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addCateringEventLabor(eventId, {
          cost_rate_id: draft.rate.id,
          label: draft.rate.label,
          quantity,
          unit_amount: draft.rate.amount,
          amount,
          note: draft.note.trim() || null,
        });
        setDraft(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteCateringEventLabor(id, eventId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-kanit text-base font-semibold text-neutral-900">ต้นทุนแรงงาน/รถ</h3>
          <CostRatePicker rates={costRates} disabled={isPending} onPick={pickRate} />
        </div>

        {draft && (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <Field label={draft.rate.label}>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  value={draft.quantity} onChange={(e) => updateDraftQuantity(e.target.value)}
                />
                {draft.rate.unit && <span className="text-xs text-neutral-400">{draft.rate.unit}</span>}
              </div>
            </Field>
            <Field label="ยอดรวม (บาท)">
              <input
                type="number" className="w-28 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                value={draft.amount} onChange={(e) => setDraft((d) => (d ? { ...d, amount: e.target.value } : d))}
              />
            </Field>
            <Field label="หมายเหตุ">
              <input
                className="w-40 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                value={draft.note} onChange={(e) => setDraft((d) => (d ? { ...d, note: e.target.value } : d))}
              />
            </Field>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDraft(null)} className="rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100">
                ยกเลิก
              </button>
              <button
                type="button" onClick={confirmAdd} disabled={isPending}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                เพิ่ม
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {laborEntries.length === 0 ? (
          <p className="py-3 text-center text-xs text-neutral-400">ยังไม่มีรายการต้นทุน</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {laborEntries.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 py-2">
                <div className="text-sm text-neutral-800">
                  {l.label}
                  {l.note && <span className="ml-1 text-xs text-neutral-400">— {l.note}</span>}
                  <span className="ml-2 text-xs tabular-nums text-neutral-400">× {l.quantity}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-neutral-700">฿{fmtBaht(l.amount)}</span>
                  <button type="button" onClick={() => handleDelete(l.id)} disabled={isPending} className="text-xs text-neutral-400 hover:text-red-600">
                    ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-6">
        <h3 className="mb-3 font-kanit text-base font-semibold text-neutral-900">สรุปกำไร/ขาดทุน</h3>
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-500">รายรับ</span>
            <span className="tabular-nums text-neutral-800">฿{fmtBaht(revenue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">ต้นทุนอาหาร{hasUnknownFoodCost ? " *" : ""}</span>
            <span className="tabular-nums text-neutral-800">−฿{fmtBaht(foodCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">ต้นทุนแรงงาน/รถ</span>
            <span className="tabular-nums text-neutral-800">−฿{fmtBaht(laborCost)}</span>
          </div>
          <div className={`flex justify-between border-t border-neutral-100 pt-1.5 text-base font-semibold ${profit >= 0 ? "text-green-700" : "text-red-600"}`}>
            <span>กำไร/ขาดทุน</span>
            <span className="tabular-nums">฿{fmtBaht(profit)}{profitPct != null ? ` (${profitPct.toFixed(1)}%)` : ""}</span>
          </div>
        </div>
        {hasUnknownFoodCost && (
          <p className="mt-2 text-xs text-amber-600">* มีเมนูบางรายการที่ยังไม่มีต้นทุนวัตถุดิบครบ ตัวเลขนี้อาจต่ำกว่าความจริง</p>
        )}
      </section>
    </div>
  );
}
