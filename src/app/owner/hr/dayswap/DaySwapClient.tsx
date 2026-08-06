"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertDaySwapRequest, deleteDaySwapRequest } from "../actions";
import type { Employee, DaySwapRequest, CompDayBalance, Holiday } from "../actions";

const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

function thDate(d: string | null) {
  if (!d) return "–";
  const dt = new Date(d + "T00:00:00");
  return `${dt.getDate()} ${MONTHS_TH[dt.getMonth()]} ${dt.getFullYear() + 543}`;
}

const BLANK = {
  employee_id: "",
  swap_type: "work_first" as "work_first" | "off_first",
  compensation: "bank_day" as "bank_day" | "extra_pay",
  work_date: "",
  off_date: "",
  note: "",
  holiday_id: "",
};

export function DaySwapClient({
  employees,
  initialSwaps,
  balances,
  defaultYear,
  holidayOptions,
}: {
  employees: Employee[];
  initialSwaps: DaySwapRequest[];
  balances: CompDayBalance[];
  defaultYear: number;
  holidayOptions: Holiday[];
}) {
  const router = useRouter();
  const [swaps, setSwaps] = useState(initialSwaps);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const year = defaultYear;

  const balanceMap = new Map(balances.map((b) => [b.employee_id, b]));

  function openNew() {
    setEditId(null);
    setForm(BLANK);
    setShowForm(true);
  }

  function openEdit(s: DaySwapRequest) {
    setEditId(s.id);
    setForm({
      employee_id: s.employee_id,
      swap_type: s.swap_type,
      compensation: s.compensation,
      work_date: s.work_date ?? "",
      off_date: s.off_date ?? "",
      note: s.note ?? "",
      holiday_id: s.holiday_id ?? "",
    });
    setShowForm(true);
  }

  function handleSave() {
    if (!form.employee_id) return;
    if (form.swap_type === "work_first" && !form.work_date) return;
    if (form.swap_type === "off_first" && !form.off_date) return;
    startTransition(async () => {
      await upsertDaySwapRequest({
        id: editId ?? undefined,
        employee_id: form.employee_id,
        work_date: form.work_date || null,
        off_date: form.off_date || null,
        swap_type: form.swap_type,
        compensation: form.swap_type === "off_first" ? "bank_day" : form.compensation,
        note: form.note || null,
        holiday_id: form.swap_type === "work_first" ? (form.holiday_id || null) : null,
      });
      // optimistic: re-fetch by navigating (server action revalidates)
      setShowForm(false);
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteDaySwapRequest(id);
      setSwaps((prev) => prev.filter((s) => s.id !== id));
      setConfirmDelete(null);
    });
  }

  function navigate(y: number) {
    router.push(`/owner/hr/dayswap?year=${y}`);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  function swapLabel(s: DaySwapRequest) {
    if (s.swap_type === "work_first") {
      return s.compensation === "bank_day" ? "มาก่อน → เก็บวัน" : "มาก่อน → จ่ายเพิ่ม";
    }
    return "หยุดก่อน → มาทดแทน";
  }

  function swapStatus(s: DaySwapRequest): { label: string; cls: string } {
    const today = new Date().toISOString().slice(0, 10);
    if (s.swap_type === "work_first") {
      if (s.compensation === "extra_pay") return { label: "จ่ายเพิ่ม", cls: "bg-amber-50 text-amber-700 border-amber-200" };
      if (!s.off_date) return { label: "วันหยุดค้าง", cls: "bg-teal-50 text-teal-700 border-teal-200" };
      if (s.off_date <= today) return { label: "ใช้ไปแล้ว", cls: "bg-neutral-100 text-neutral-500 border-neutral-200" };
      return { label: "นัดหยุด", cls: "bg-blue-50 text-blue-700 border-blue-200" };
    }
    // off_first
    if (!s.work_date) return { label: "รอมาทดแทน", cls: "bg-red-50 text-red-600 border-red-200" };
    if (s.work_date <= today) return { label: "ทดแทนแล้ว", cls: "bg-neutral-100 text-neutral-500 border-neutral-200" };
    return { label: "นัดทดแทน", cls: "bg-blue-50 text-blue-700 border-blue-200" };
  }

  // ── selected emp balance ──────────────────────────────────────────────────────
  const selBalance = form.employee_id ? balanceMap.get(form.employee_id) : undefined;

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => navigate(year - 1)} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">◀</button>
          <span className="font-medium">{year + 543}</span>
          <button onClick={() => navigate(year + 1)} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">▶</button>
        </div>
        <button onClick={openNew} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          + บันทึกใบเปลี่ยนวันหยุด
        </button>
      </div>

      {/* Balance summary chips */}
      <div className="flex flex-wrap gap-2">
        {balances
          .filter((b) => b.earned - b.used > 0 || b.pending_makeup > 0)
          .map((b) => {
            const avail = b.earned - b.used;
            const name = b.employee_nickname ?? b.employee_name.split(" ")[0];
            return (
              <div key={b.employee_id} className="flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1 text-xs">
                <span className="font-medium text-neutral-800">{name}</span>
                {avail > 0 && (
                  <span className="rounded bg-teal-100 px-1.5 py-0.5 font-semibold text-teal-700">ค้าง {avail} วัน</span>
                )}
                {b.pending_makeup > 0 && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 font-semibold text-red-600">ต้องทดแทน {b.pending_makeup} วัน</span>
                )}
              </div>
            );
          })}
        {balances.every((b) => b.earned - b.used === 0 && b.pending_makeup === 0) && (
          <p className="text-xs text-neutral-400">ไม่มีวันหยุดค้าง</p>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
              <th className="px-3 py-2">พนักงาน</th>
              <th className="px-3 py-2">ประเภท</th>
              <th className="px-3 py-2">วันทำงาน</th>
              <th className="px-3 py-2">วันหยุดแทน</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2">หมายเหตุ</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {swaps.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-neutral-400">ไม่มีรายการ</td></tr>
            )}
            {swaps.map((s, i) => {
              const st = swapStatus(s);
              return (
                <tr key={s.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-neutral-900">{s.employee_nickname ?? s.employee_name.split(" ")[0]}</span>
                    <span className="ml-1 text-xs text-neutral-400">{s.employee_name}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">
                    {swapLabel(s)}
                    {s.holiday_name && <div className="mt-0.5 text-[10px] text-purple-600">🎌 {s.holiday_name}</div>}
                  </td>
                  <td className="px-3 py-2 text-neutral-700">{thDate(s.work_date)}</td>
                  <td className="px-3 py-2 text-neutral-700">{thDate(s.off_date)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{s.note ?? "–"}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(s)} className="text-xs text-blue-600 hover:underline">แก้ไข</button>
                      <button onClick={() => setConfirmDelete(s.id)} className="text-xs text-neutral-400 hover:text-red-600">ลบ</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">{editId ? "แก้ไขใบเปลี่ยนวันหยุด" : "บันทึกใบเปลี่ยนวันหยุด"}</h2>
              <button onClick={() => setShowForm(false)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>

            <div className="space-y-3 px-5 py-4">
              {/* Employee */}
              <Field label="พนักงาน *">
                <select className="input-base" value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">– เลือกพนักงาน –</option>
                  {employees.filter((e) => e.is_active).map((e) => (
                    <option key={e.id} value={e.id}>{e.nickname ? `${e.nickname} (${e.full_name})` : e.full_name}</option>
                  ))}
                </select>
              </Field>

              {/* Balance hint */}
              {selBalance && (selBalance.earned - selBalance.used > 0 || selBalance.pending_makeup > 0) && (
                <div className="flex gap-2 text-xs">
                  {selBalance.earned - selBalance.used > 0 && (
                    <span className="rounded bg-teal-100 px-2 py-0.5 text-teal-700 font-medium">วันหยุดค้าง {selBalance.earned - selBalance.used} วัน</span>
                  )}
                  {selBalance.pending_makeup > 0 && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-red-600 font-medium">ต้องทดแทน {selBalance.pending_makeup} วัน</span>
                  )}
                </div>
              )}

              {/* Swap type */}
              <Field label="ประเภทการเปลี่ยน *">
                <div className="grid grid-cols-2 gap-2">
                  {(["work_first", "off_first"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, swap_type: t, compensation: "bank_day" }))}
                      className={`rounded-lg border py-2.5 text-xs font-medium transition-colors ${
                        form.swap_type === t
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                      }`}
                    >
                      {t === "work_first" ? "มาทำก่อน → หยุดทีหลัง" : "หยุดก่อน → มาทดแทนทีหลัง"}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Compensation (work_first only) */}
              {form.swap_type === "work_first" && (
                <Field label="ทดแทนด้วย *">
                  <div className="grid grid-cols-2 gap-2">
                    {(["bank_day", "extra_pay"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, compensation: c }))}
                        className={`rounded-lg border py-2 text-xs font-medium transition-colors ${
                          form.compensation === c
                            ? "border-neutral-900 bg-neutral-900 text-white"
                            : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                        }`}
                      >
                        {c === "bank_day" ? "เก็บวันหยุดค้าง" : "จ่ายค่าแรงเพิ่ม 1 เท่า"}
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              {/* Holiday reference (work_first only) */}
              {form.swap_type === "work_first" && (
                <Field label="อ้างอิงวันนักขัตฤกษ์ (ถ้ามี)">
                  <select className="input-base" value={form.holiday_id} onChange={(e) => setForm((f) => ({ ...f, holiday_id: e.target.value }))}>
                    <option value="">– ไม่อ้างอิง –</option>
                    {holidayOptions.map((h) => (
                      <option key={h.id} value={h.id}>{thDate(h.holiday_date)} — {h.name}</option>
                    ))}
                  </select>
                </Field>
              )}

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <Field label={form.swap_type === "work_first" ? "วันที่มาทำงาน *" : "วันที่มาทดแทน"}>
                  <input type="date" className="input-base" value={form.work_date}
                    onChange={(e) => setForm((f) => ({ ...f, work_date: e.target.value }))} />
                </Field>
                <Field label={form.swap_type === "work_first" ? "วันที่จะหยุดแทน" : "วันที่หยุดก่อน *"}>
                  <input type="date" className="input-base" value={form.off_date}
                    onChange={(e) => setForm((f) => ({ ...f, off_date: e.target.value }))} />
                </Field>
              </div>
              {form.swap_type === "work_first" && !form.off_date && (
                <p className="text-xs text-neutral-400">หากยังไม่กำหนดวันหยุด ปล่อยว่างไว้ได้ — ระบบจะนับเป็น "วันหยุดค้าง"</p>
              )}
              {form.swap_type === "off_first" && !form.work_date && (
                <p className="text-xs text-neutral-400">หากยังไม่ได้นัดวันมาทดแทน ปล่อยว่างไว้ได้</p>
              )}

              <Field label="หมายเหตุ">
                <input type="text" className="input-base" placeholder="เช่น มีงานด่วน, งานแต่งงาน..." value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              </Field>
            </div>

            <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">
              <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">ยกเลิก</button>
              <button
                onClick={handleSave}
                disabled={isPending || !form.employee_id || (form.swap_type === "work_first" && !form.work_date) || (form.swap_type === "off_first" && !form.off_date)}
                className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {isPending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 font-kanit text-base font-semibold text-neutral-900">ลบรายการ?</h3>
            <p className="mb-4 text-sm text-neutral-500">ยอดวันหยุดค้างจะถูกปรับให้ตรงกับข้อมูลที่เหลือ</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">ยกเลิก</button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={isPending} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">ลบ</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .input-base { width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; font-size: 0.875rem; outline: none; background: white; }
        .input-base:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      {children}
    </div>
  );
}
