"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  upsertDepartment, setDepartmentActive,
  upsertLeaveType,
  upsertHoliday, deleteHoliday,
  upsertOtRule,
} from "../actions";
import type { Department, LeaveType, Holiday, OtRule } from "../actions";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const MONTHS_LONG = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const DAYS_SHORT = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"]; // Mon=0

function getDaysInMonth(year: number, month: number) { return new Date(year, month, 0).getDate(); }
function getFirstDayOfMonth(year: number, month: number) {
  const d = new Date(year, month - 1, 1).getDay(); // Sun=0
  return (d + 6) % 7; // Mon=0
}

export function HRSettingsClient({
  initialDepartments,
  initialLeaveTypes,
  initialHolidays,
  initialOtRules,
  calendarYear,
}: {
  initialDepartments: Department[];
  initialLeaveTypes: LeaveType[];
  initialHolidays: Holiday[];
  initialOtRules: OtRule[];
  calendarYear: number;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"dept" | "leave" | "holiday" | "ot">("dept");
  const [isPending, startTransition] = useTransition();

  // Departments
  const [departments, setDepartments] = useState(initialDepartments);
  const [editingDept, setEditingDept] = useState<string | null>(null);
  const [deptName, setDeptName] = useState("");

  // Leave Types
  const [leaveTypes, setLeaveTypes] = useState(initialLeaveTypes);
  const [editingLT, setEditingLT] = useState<LeaveType | null>(null);
  const [showLTForm, setShowLTForm] = useState(false);
  const [ltForm, setLtForm] = useState<Omit<LeaveType, "id">>({
    code: "", name_th: "", annual_quota_days: null,
    is_paid: true, is_subject_to_day_multiplier: false,
    requires_medical_cert: false, is_active: true,
  });

  // Holidays
  const [holidays, setHolidays] = useState(initialHolidays);
  const [holidayModal, setHolidayModal] = useState<{ date: string; existing?: Holiday } | null>(null);
  const [hForm, setHForm] = useState({ name: "", pay_type: "multiplier" as "multiplier" | "substitute", pay_multiplier: 2 });
  const year = calendarYear;

  // OT Rules
  const [otRules, setOtRules] = useState(initialOtRules);
  const [editingOT, setEditingOT] = useState<OtRule | null>(null);
  const [showOTForm, setShowOTForm] = useState(false);
  const [otForm, setOtForm] = useState<Omit<OtRule, "id">>({ name: "", applies_to: "weekday", multiplier: 1.5, is_active: true });

  const holidayMap = new Map(holidays.map((h) => [h.holiday_date, h]));

  // ─── Dept handlers ────────────────────────────────────────────────────────
  function saveDept(id?: string) {
    if (!deptName.trim()) return;
    startTransition(async () => {
      await upsertDepartment({ ...(id ? { id } : {}), name: deptName });
      if (id) {
        setDepartments((prev) => prev.map((d) => (d.id === id ? { ...d, name: deptName } : d)));
      } else {
        setDepartments((prev) => [...prev, { id: crypto.randomUUID(), name: deptName, is_active: true }]);
      }
      setEditingDept(null);
      setDeptName("");
    });
  }

  function toggleDeptActive(d: Department) {
    startTransition(async () => {
      await setDepartmentActive(d.id, !d.is_active);
      setDepartments((prev) => prev.map((x) => (x.id === d.id ? { ...x, is_active: !x.is_active } : x)));
    });
  }

  // ─── LeaveType handlers ───────────────────────────────────────────────────
  function openNewLT() { setEditingLT(null); setLtForm({ code: "", name_th: "", annual_quota_days: null, is_paid: true, is_subject_to_day_multiplier: false, requires_medical_cert: false, is_active: true }); setShowLTForm(true); }
  function openEditLT(lt: LeaveType) { setEditingLT(lt); setLtForm({ code: lt.code, name_th: lt.name_th, annual_quota_days: lt.annual_quota_days, is_paid: lt.is_paid, is_subject_to_day_multiplier: lt.is_subject_to_day_multiplier, requires_medical_cert: lt.requires_medical_cert, is_active: lt.is_active }); setShowLTForm(true); }
  function saveLT() {
    startTransition(async () => {
      await upsertLeaveType({ ...(editingLT ? { id: editingLT.id } : {}), ...ltForm });
      if (editingLT) {
        setLeaveTypes((prev) => prev.map((x) => (x.id === editingLT.id ? { ...x, ...ltForm } : x)));
      } else {
        setLeaveTypes((prev) => [...prev, { id: crypto.randomUUID(), ...ltForm }]);
      }
      setShowLTForm(false);
    });
  }

  // ─── Holiday handlers ─────────────────────────────────────────────────────
  function openHoliday(dateStr: string) {
    const existing = holidayMap.get(dateStr);
    setHolidayModal({ date: dateStr, existing });
    setHForm({ name: existing?.name ?? "", pay_type: existing?.pay_type ?? "multiplier", pay_multiplier: existing?.pay_multiplier ?? 2 });
  }

  function saveHoliday() {
    if (!holidayModal) return;
    startTransition(async () => {
      await upsertHoliday({ ...(holidayModal.existing ? { id: holidayModal.existing.id } : {}), holiday_date: holidayModal.date, ...hForm });
      const updated: Holiday = {
        id: holidayModal.existing?.id ?? crypto.randomUUID(),
        holiday_date: holidayModal.date,
        ...hForm,
        is_active: true,
      };
      setHolidays((prev) => {
        const filtered = prev.filter((h) => h.holiday_date !== holidayModal.date);
        return [...filtered, updated].sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
      });
      setHolidayModal(null);
    });
  }

  function removeHoliday() {
    if (!holidayModal?.existing) return;
    startTransition(async () => {
      await deleteHoliday(holidayModal.existing!.id);
      setHolidays((prev) => prev.filter((h) => h.holiday_date !== holidayModal.date));
      setHolidayModal(null);
    });
  }

  // ─── OT handlers ──────────────────────────────────────────────────────────
  function openNewOT() { setEditingOT(null); setOtForm({ name: "", applies_to: "weekday", multiplier: 1.5, is_active: true }); setShowOTForm(true); }
  function openEditOT(r: OtRule) { setEditingOT(r); setOtForm({ name: r.name, applies_to: r.applies_to, multiplier: r.multiplier, is_active: r.is_active }); setShowOTForm(true); }
  function saveOT() {
    startTransition(async () => {
      await upsertOtRule({ ...(editingOT ? { id: editingOT.id } : {}), ...otForm });
      if (editingOT) {
        setOtRules((prev) => prev.map((x) => (x.id === editingOT.id ? { ...x, ...otForm } : x)));
      } else {
        setOtRules((prev) => [...prev, { id: crypto.randomUUID(), ...otForm }]);
      }
      setShowOTForm(false);
    });
  }

  const TABS: { key: "dept" | "leave" | "holiday" | "ot"; label: string }[] = [
    { key: "dept", label: "แผนก" },
    { key: "leave", label: "ประเภทลา" },
    { key: "holiday", label: "วันนักขัตฤกษ์" },
    { key: "ot", label: "กฎ OT" },
  ];

  return (
    <>
      <div className="mb-4 flex gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── แผนก ─── */}
      {tab === "dept" && (
        <div className="max-w-md space-y-3">
          {departments.map((d) => (
            <div key={d.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${d.is_active ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50 opacity-60"}`}>
              {editingDept === d.id ? (
                <>
                  <input autoFocus className="flex-1 rounded border border-neutral-300 px-2 py-1 text-sm" value={deptName} onChange={(e) => setDeptName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveDept(d.id); if (e.key === "Escape") setEditingDept(null); }} />
                  <button onClick={() => saveDept(d.id)} className="text-xs text-green-600 hover:underline">บันทึก</button>
                  <button onClick={() => setEditingDept(null)} className="text-xs text-neutral-400 hover:text-neutral-700">ยกเลิก</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-neutral-800">{d.name}</span>
                  <button onClick={() => { setEditingDept(d.id); setDeptName(d.name); }} className="text-xs text-neutral-400 hover:text-neutral-700">แก้ไข</button>
                  <button onClick={() => toggleDeptActive(d)} className={`text-xs ${d.is_active ? "text-red-400 hover:text-red-700" : "text-green-600 hover:text-green-800"}`}>
                    {d.is_active ? "ปิดใช้" : "เปิดใช้"}
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <input className="flex-1 rounded border border-neutral-200 px-3 py-2 text-sm" placeholder="ชื่อแผนกใหม่..." value={editingDept === "new" ? deptName : ""} onFocus={() => { setEditingDept("new"); setDeptName(""); }} onChange={(e) => setDeptName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveDept(); if (e.key === "Escape") setEditingDept(null); }} />
            <button onClick={() => saveDept()} disabled={isPending || !deptName.trim()} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">+ เพิ่ม</button>
          </div>
        </div>
      )}

      {/* ─── ประเภทลา ─── */}
      {tab === "leave" && (
        <>
          <div className="mb-3 flex justify-end">
            <button onClick={openNewLT} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">+ เพิ่มประเภทลา</button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
                  <th className="px-3 py-2">รหัส</th>
                  <th className="px-3 py-2">ชื่อ</th>
                  <th className="px-3 py-2 text-center">โควตา/ปี</th>
                  <th className="px-3 py-2 text-center">ได้รับค่าจ้าง</th>
                  <th className="px-3 py-2 text-center">หักตามวันประเภท</th>
                  <th className="px-3 py-2 text-center">ต้องใบแพทย์</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {leaveTypes.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-neutral-400">ยังไม่มีประเภทลา</td></tr>}
                {leaveTypes.map((lt, i) => (
                  <tr key={lt.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"} ${!lt.is_active ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2 font-mono text-xs font-semibold">{lt.code}</td>
                    <td className="px-3 py-2">{lt.name_th}</td>
                    <td className="px-3 py-2 text-center">{lt.annual_quota_days ?? "ไม่จำกัด"}</td>
                    <td className="px-3 py-2 text-center">{lt.is_paid ? "✓" : "✗"}</td>
                    <td className="px-3 py-2 text-center">{lt.is_subject_to_day_multiplier ? "✓" : "–"}</td>
                    <td className="px-3 py-2 text-center">{lt.requires_medical_cert ? "✓" : "–"}</td>
                    <td className="px-3 py-2"><button onClick={() => openEditLT(lt)} className="text-xs text-neutral-400 hover:text-neutral-700">แก้ไข</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── วันนักขัตฤกษ์ (Calendar) ─── */}
      {tab === "holiday" && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <button onClick={() => router.push(`/owner/hr/settings?year=${year - 1}`)} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">◀</button>
            <span className="text-base font-semibold">{year + 543}</span>
            <button onClick={() => router.push(`/owner/hr/settings?year=${year + 1}`)} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">▶</button>
            <span className="ml-4 text-xs text-neutral-400">คลิกวันที่เพื่อเพิ่ม/แก้ไขวันนักขัตฤกษ์</span>
          </div>

          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {Array.from({ length: 12 }, (_, mi) => {
              const monthNum = mi + 1;
              const daysInMonth = getDaysInMonth(year, monthNum);
              const firstDay = getFirstDayOfMonth(year, monthNum); // Mon=0
              return (
                <div key={mi} className="rounded-lg border border-neutral-200 p-3">
                  <div className="mb-2 text-center text-sm font-semibold text-neutral-700">{MONTHS_LONG[mi]}</div>
                  <div className="grid grid-cols-7 gap-0.5 text-center">
                    {DAYS_SHORT.map((d) => <div key={d} className="text-[10px] font-medium text-neutral-400">{d}</div>)}
                    {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} />)}
                    {Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const dateStr = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                      const h = holidayMap.get(dateStr);
                      return (
                        <button
                          key={day}
                          onClick={() => openHoliday(dateStr)}
                          title={h?.name}
                          className={`h-6 w-6 rounded text-[11px] transition-colors ${h ? "bg-orange-400 font-bold text-white hover:bg-orange-500" : "text-neutral-600 hover:bg-neutral-100"}`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-neutral-500">
            <span><span className="mr-1 inline-block h-3 w-3 rounded bg-orange-400"></span>วันนักขัตฤกษ์</span>
            <span className="text-neutral-400">รายการทั้งหมด: {holidays.length} วัน</span>
          </div>
        </>
      )}

      {/* ─── กฎ OT ─── */}
      {tab === "ot" && (
        <>
          <div className="mb-3 flex justify-end">
            <button onClick={openNewOT} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">+ เพิ่มกฎ OT</button>
          </div>
          <div className="max-w-xl space-y-2">
            {otRules.map((r) => (
              <div key={r.id} className={`flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 ${!r.is_active ? "opacity-50" : ""}`}>
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="text-xs text-neutral-500">
                    {r.applies_to === "weekday" ? "วันธรรมดา" : r.applies_to === "weekend" ? "เสาร์-อาทิตย์" : "วันนักขัตฤกษ์"} — x{r.multiplier}
                  </div>
                </div>
                <button onClick={() => openEditOT(r)} className="text-xs text-neutral-400 hover:text-neutral-700">แก้ไข</button>
              </div>
            ))}
            {otRules.length === 0 && <p className="py-6 text-center text-sm text-neutral-400">ยังไม่มีกฎ OT</p>}
          </div>
        </>
      )}

      {/* ─── Holiday Modal ─── */}
      {holidayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">
                {holidayModal.existing ? "แก้ไข" : "เพิ่ม"} — {holidayModal.date}
              </h2>
              <button onClick={() => setHolidayModal(null)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">ชื่อวันหยุด *</label>
                <input autoFocus className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400" value={hForm.name} onChange={(e) => setHForm((f) => ({ ...f, name: e.target.value }))} placeholder="วันขึ้นปีใหม่" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">ประเภท</label>
                <select className="w-full rounded border border-neutral-200 px-3 py-2 text-sm" value={hForm.pay_type} onChange={(e) => setHForm((f) => ({ ...f, pay_type: e.target.value as "multiplier" | "substitute" }))}>
                  <option value="multiplier">จ่ายทวีคูณ (x เท่า)</option>
                  <option value="substitute">วันหยุดชดเชย (เลื่อนวัน)</option>
                </select>
              </div>
              {hForm.pay_type === "multiplier" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">อัตราคูณ</label>
                  <input type="number" step="0.5" className="w-full rounded border border-neutral-200 px-3 py-2 text-sm" value={hForm.pay_multiplier} onChange={(e) => setHForm((f) => ({ ...f, pay_multiplier: +e.target.value }))} />
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-neutral-100 px-5 py-3">
              {holidayModal.existing && (
                <button onClick={removeHoliday} disabled={isPending} className="text-xs text-red-500 hover:underline">ลบวันหยุดนี้</button>
              )}
              <div className="ml-auto flex gap-2">
                <button onClick={() => setHolidayModal(null)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">ยกเลิก</button>
                <button onClick={saveHoliday} disabled={!hForm.name.trim() || isPending} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
                  {isPending ? "กำลังบันทึก…" : "บันทึก"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── LeaveType Modal ─── */}
      {showLTForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">{editingLT ? "แก้ไข" : "เพิ่ม"}ประเภทลา</h2>
              <button onClick={() => setShowLTForm(false)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">รหัส *</label>
                <input className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm" value={ltForm.code} onChange={(e) => setLtForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="AL" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">โควตา/ปี (วัน)</label>
                <input type="number" className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm" value={ltForm.annual_quota_days ?? ""} onChange={(e) => setLtForm((f) => ({ ...f, annual_quota_days: e.target.value ? +e.target.value : null }))} placeholder="ไม่จำกัด" />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-neutral-600">ชื่อ *</label>
                <input className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm" value={ltForm.name_th} onChange={(e) => setLtForm((f) => ({ ...f, name_th: e.target.value }))} placeholder="ลาพักร้อน" />
              </div>
              <div className="col-span-2 space-y-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ltForm.is_paid} onChange={(e) => setLtForm((f) => ({ ...f, is_paid: e.target.checked }))} /> ได้รับค่าจ้าง</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ltForm.is_subject_to_day_multiplier} onChange={(e) => setLtForm((f) => ({ ...f, is_subject_to_day_multiplier: e.target.checked }))} /> หักตามประเภทวัน (x1/x2/x3 วันธรรมดา/เสาร์อาทิตย์/นักขัตฤกษ์)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ltForm.requires_medical_cert} onChange={(e) => setLtForm((f) => ({ ...f, requires_medical_cert: e.target.checked }))} /> ต้องใบรับรองแพทย์</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ltForm.is_active} onChange={(e) => setLtForm((f) => ({ ...f, is_active: e.target.checked }))} /> เปิดใช้งาน</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">
              <button onClick={() => setShowLTForm(false)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">ยกเลิก</button>
              <button onClick={saveLT} disabled={!ltForm.code || !ltForm.name_th || isPending} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── OT Rule Modal ─── */}
      {showOTForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">{editingOT ? "แก้ไข" : "เพิ่ม"}กฎ OT</h2>
              <button onClick={() => setShowOTForm(false)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">ชื่อกฎ *</label>
                <input className="w-full rounded border border-neutral-200 px-3 py-2 text-sm" value={otForm.name} onChange={(e) => setOtForm((f) => ({ ...f, name: e.target.value }))} placeholder="OT วันธรรมดา" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">ใช้กับ</label>
                <select className="w-full rounded border border-neutral-200 px-3 py-2 text-sm" value={otForm.applies_to} onChange={(e) => setOtForm((f) => ({ ...f, applies_to: e.target.value as OtRule["applies_to"] }))}>
                  <option value="weekday">วันธรรมดา</option>
                  <option value="weekend">เสาร์-อาทิตย์</option>
                  <option value="holiday">วันนักขัตฤกษ์</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">อัตราคูณ</label>
                <input type="number" step="0.5" className="w-full rounded border border-neutral-200 px-3 py-2 text-sm" value={otForm.multiplier} onChange={(e) => setOtForm((f) => ({ ...f, multiplier: +e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={otForm.is_active} onChange={(e) => setOtForm((f) => ({ ...f, is_active: e.target.checked }))} /> เปิดใช้งาน</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">
              <button onClick={() => setShowOTForm(false)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">ยกเลิก</button>
              <button onClick={saveOT} disabled={!otForm.name || isPending} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">บันทึก</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
