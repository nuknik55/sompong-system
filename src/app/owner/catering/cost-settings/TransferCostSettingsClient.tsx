"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCateringTransferCostRate, updateCateringTransferCostRate, deleteCateringTransferCostRate,
  toggleCateringTransferCostRateActive, reorderCateringTransferCostRate,
} from "../actions";
import type { CateringTransferCostRate } from "../actions";
import { COST_TYPE_OPTIONS, COST_TYPE_LABEL, fmtBaht } from "../shared-utils";

type CostRateForm = {
  cost_type: string;
  label: string;
  amount: string;
  unit: string;
};

function blankForm(costType: string): CostRateForm {
  return { cost_type: costType, label: "", amount: "", unit: "" };
}

function formFromRate(r: CateringTransferCostRate): CostRateForm {
  return {
    cost_type: r.cost_type,
    label: r.label,
    amount: r.amount.toString(),
    unit: r.unit ?? "",
  };
}

export function TransferCostSettingsClient({ initialRates }: { initialRates: CateringTransferCostRate[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rates, setRates] = useState(initialRates);
  const [modal, setModal] = useState<{ editingId: string | null; form: CostRateForm } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openAdd(costType: string) {
    setModal({ editingId: null, form: blankForm(costType) });
    setError(null);
  }

  function openEdit(r: CateringTransferCostRate) {
    setModal({ editingId: r.id, form: formFromRate(r) });
    setError(null);
  }

  function setForm(patch: Partial<CostRateForm>) {
    setModal((m) => (m ? { ...m, form: { ...m.form, ...patch } } : m));
  }

  function saveModal() {
    if (!modal) return;
    const f = modal.form;
    if (!f.label.trim() || f.amount.trim() === "") {
      setError("กรุณากรอกชื่อรายการและราคา");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          cost_type: f.cost_type,
          label: f.label.trim(),
          amount: Number(f.amount),
          unit: f.unit.trim() || null,
        };
        if (modal.editingId) {
          await updateCateringTransferCostRate(modal.editingId, payload);
        } else {
          await addCateringTransferCostRate(payload);
        }
        setModal(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function handleDelete(r: CateringTransferCostRate) {
    if (!confirm(`ลบ "${r.label}" ใช่ไหม?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteCateringTransferCostRate(r.id);
        setRates((prev) => prev.filter((x) => x.id !== r.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  function handleToggleActive(r: CateringTransferCostRate) {
    startTransition(async () => {
      await toggleCateringTransferCostRateActive(r.id, !r.is_active);
      setRates((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_active: !x.is_active } : x)));
    });
  }

  function handleReorder(r: CateringTransferCostRate, direction: "up" | "down") {
    setError(null);
    startTransition(async () => {
      const result = await reorderCateringTransferCostRate(r.id, r.cost_type, direction);
      if (result.error) { setError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="space-y-3">
        {COST_TYPE_OPTIONS.map((group) => {
          const rows = rates.filter((r) => r.cost_type === group.value).sort((a, b) => a.sort_order - b.sort_order);
          return (
            <div key={group.value} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-4 py-2.5">
                <span className="text-sm font-semibold text-neutral-800">{group.label}</span>
                <button onClick={() => openAdd(group.value)} className="text-xs text-green-700 hover:underline">
                  + เพิ่มรายการ
                </button>
              </div>
              <div>
                {rows.length === 0 && (
                  <div className="px-4 py-3 text-xs text-neutral-400">ยังไม่มีรายการ</div>
                )}
                {rows.map((r, idx) => (
                  <div
                    key={r.id}
                    className={`group flex items-center gap-3 border-b border-neutral-50 px-4 py-2 last:border-0 hover:bg-neutral-50/50 ${!r.is_active ? "opacity-50" : ""}`}
                  >
                    <span className="flex-1 text-sm text-neutral-700">{r.label}</span>
                    <span className="w-32 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                      {fmtBaht(r.amount)}{r.unit ? ` / ${r.unit}` : ""}
                    </span>
                    <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => handleReorder(r, "up")} disabled={isPending || idx === 0}
                        className="rounded px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-20" title="เลื่อนขึ้น">
                        ▲
                      </button>
                      <button onClick={() => handleReorder(r, "down")} disabled={isPending || idx === rows.length - 1}
                        className="rounded px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-20" title="เลื่อนลง">
                        ▼
                      </button>
                      <span className="mx-1 text-neutral-200">|</span>
                      <button onClick={() => openEdit(r)} className="text-xs text-neutral-400 hover:text-neutral-700">แก้ไข</button>
                      <button onClick={() => handleToggleActive(r)} disabled={isPending}
                        className={`text-xs ${r.is_active ? "text-neutral-400 hover:text-red-500" : "text-green-600 hover:text-green-800"}`}>
                        {r.is_active ? "ปิดใช้" : "เปิดใช้"}
                      </button>
                      <button onClick={() => handleDelete(r)} disabled={isPending} className="text-xs text-neutral-400 hover:text-red-500 disabled:opacity-30">
                        ลบ
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">
                {modal.editingId ? "แก้ไขรายการ" : "เพิ่มรายการใหม่"} — {COST_TYPE_LABEL[modal.form.cost_type] ?? modal.form.cost_type}
              </h2>
              <button onClick={() => setModal(null)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3 px-5 py-4">
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-neutral-600">ชื่อรายการ *</label>
                <input autoFocus className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none"
                  value={modal.form.label} onChange={(e) => setForm({ label: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">ราคา (บาท) *</label>
                <input type="number" className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none"
                  value={modal.form.amount} onChange={(e) => setForm({ amount: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">หน่วย</label>
                <input className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none" placeholder="ต่อคน, ต่อคัน, ต่องาน ฯลฯ"
                  value={modal.form.unit} onChange={(e) => setForm({ unit: e.target.value })} />
              </div>
              {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">
              <button onClick={() => setModal(null)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">ยกเลิก</button>
              <button onClick={saveModal} disabled={isPending}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
                {isPending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
