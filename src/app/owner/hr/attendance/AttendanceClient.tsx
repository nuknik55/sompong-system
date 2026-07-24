"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertAttendancePunch, deleteAttendancePunch } from "../actions";
import type { Employee, AttendancePunch } from "../actions";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WEEKDAY_TH = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function toTimeStr(iso: string) {
  try { return iso.slice(11, 16); } catch { return ""; }
}

export function AttendanceClient({
  employees,
  initialPunches,
  selectedEmployeeId,
  year,
  month,
}: {
  employees: Employee[];
  initialPunches: AttendancePunch[];
  selectedEmployeeId: string;
  year: number;
  month: number;
}) {
  const router = useRouter();
  const [punches, setPunches] = useState(initialPunches);
  const [editingPunch, setEditingPunch] = useState<{ date: string; type: "in" | "out"; existing?: AttendancePunch } | null>(null);
  const [timeInput, setTimeInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [isPending, startTransition] = useTransition();

  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams({ employee: selectedEmployeeId, year: String(year), month: String(month), ...params });
    router.push(`/owner/hr/attendance?${sp.toString()}`);
  }

  const daysInMonth = getDaysInMonth(year, month);
  const selectedEmployee = employees.find((e) => e.id === selectedEmployeeId);

  // Map: date → { in?: punch, out?: punch }
  const punchMap = new Map<string, { in?: AttendancePunch; out?: AttendancePunch }>();
  for (const p of punches) {
    const cur = punchMap.get(p.work_date) ?? {};
    if (p.punch_type === "in") cur.in = p;
    else cur.out = p;
    punchMap.set(p.work_date, cur);
  }

  function openEdit(date: string, type: "in" | "out", existing?: AttendancePunch) {
    setEditingPunch({ date, type, existing });
    setTimeInput(existing ? toTimeStr(existing.punch_time) : "");
    setNoteInput(existing?.note ?? "");
  }

  function handleSave() {
    if (!editingPunch || !timeInput || !selectedEmployeeId) return;
    const punch_time = `${editingPunch.date}T${timeInput}:00+07:00`;
    startTransition(async () => {
      await upsertAttendancePunch({
        id: editingPunch.existing?.id,
        employee_id: selectedEmployeeId,
        work_date: editingPunch.date,
        punch_type: editingPunch.type,
        punch_time,
        note: noteInput || undefined,
      });
      const updated: AttendancePunch = {
        id: editingPunch.existing?.id ?? crypto.randomUUID(),
        employee_id: selectedEmployeeId,
        work_date: editingPunch.date,
        punch_type: editingPunch.type,
        punch_time,
        note: noteInput || null,
      };
      setPunches((prev) => {
        const filtered = prev.filter((p) => !(p.work_date === editingPunch.date && p.punch_type === editingPunch.type));
        return [...filtered, updated].sort((a, b) => a.work_date.localeCompare(b.work_date));
      });
      setEditingPunch(null);
    });
  }

  function handleDelete(punch: AttendancePunch) {
    startTransition(async () => {
      await deleteAttendancePunch(punch.id);
      setPunches((prev) => prev.filter((p) => p.id !== punch.id));
      setEditingPunch(null);
    });
  }

  return (
    <>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          value={selectedEmployeeId}
          onChange={(e) => navigate({ employee: e.target.value })}
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.nickname ? `${e.nickname} — ${e.full_name}` : e.full_name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1 text-sm">
          <button onClick={() => { const d = new Date(year, month - 2, 1); navigate({ year: String(d.getFullYear()), month: String(d.getMonth() + 1) }); }} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">◀</button>
          <span className="font-medium">{MONTHS_TH[month - 1]} {year + 543}</span>
          <button onClick={() => { const d = new Date(year, month, 1); navigate({ year: String(d.getFullYear()), month: String(d.getMonth() + 1) }); }} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">▶</button>
        </div>
      </div>

      {/* Employee info */}
      {selectedEmployee && (
        <div className="mb-3 text-sm text-neutral-500">
          วันหยุดประจำ: <span className="font-medium text-neutral-800">{selectedEmployee.weekly_day_off ?? "–"}</span>
        </div>
      )}

      {/* Punch table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-800 text-xs text-neutral-100">
              <th className="px-3 py-2 text-left">วันที่</th>
              <th className="px-3 py-2 text-center">วัน</th>
              <th className="px-3 py-2 text-center">เข้างาน</th>
              <th className="px-3 py-2 text-center">ออกงาน</th>
              <th className="px-3 py-2 text-center">ชั่วโมง</th>
              <th className="px-3 py-2 text-left">หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dow = new Date(dateStr).getDay();
              const dayPunches = punchMap.get(dateStr);
              const isWeekend = dow === 0 || dow === 6;
              const isOff = selectedEmployee?.weekly_day_off === WEEKDAY_TH_FULL[dow];

              // Calculate hours
              let hours = "";
              if (dayPunches?.in && dayPunches.out) {
                const diff = (new Date(dayPunches.out.punch_time).getTime() - new Date(dayPunches.in.punch_time).getTime()) / 3600000;
                hours = diff.toFixed(1);
              }

              return (
                <tr key={dateStr} className={`border-b border-neutral-100 last:border-0 ${isWeekend ? "bg-neutral-50" : "bg-white"} ${isOff ? "opacity-60" : ""}`}>
                  <td className="px-3 py-1.5 font-mono text-xs text-neutral-600">
                    {day}/{month}/{year + 543}
                  </td>
                  <td className={`px-3 py-1.5 text-center text-xs font-medium ${isWeekend ? "text-red-500" : "text-neutral-500"}`}>
                    {WEEKDAY_TH[dow]}
                    {isOff && <span className="ml-1 text-[10px] text-neutral-400">(วันหยุด)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button
                      onClick={() => openEdit(dateStr, "in", dayPunches?.in)}
                      className={`rounded px-2 py-0.5 text-xs transition-colors ${dayPunches?.in ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-neutral-100 text-neutral-400 hover:bg-neutral-200"}`}
                    >
                      {dayPunches?.in ? toTimeStr(dayPunches.in.punch_time) : "+ เพิ่ม"}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button
                      onClick={() => openEdit(dateStr, "out", dayPunches?.out)}
                      className={`rounded px-2 py-0.5 text-xs transition-colors ${dayPunches?.out ? "bg-blue-100 text-blue-700 hover:bg-blue-200" : "bg-neutral-100 text-neutral-400 hover:bg-neutral-200"}`}
                    >
                      {dayPunches?.out ? toTimeStr(dayPunches.out.punch_time) : "+ เพิ่ม"}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-center text-xs font-medium text-neutral-700">
                    {hours ? `${hours} ชม.` : "–"}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-neutral-400">
                    {dayPunches?.in?.note ?? dayPunches?.out?.note ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit punch modal */}
      {editingPunch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">
                {editingPunch.type === "in" ? "เวลาเข้างาน" : "เวลาออกงาน"} — {editingPunch.date}
              </h2>
              <button onClick={() => setEditingPunch(null)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">เวลา *</label>
                <input
                  type="time"
                  className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">หมายเหตุ</label>
                <input
                  className="w-full rounded border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="OT, มาสาย..."
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-neutral-100 px-5 py-3">
              {editingPunch.existing && (
                <button onClick={() => handleDelete(editingPunch.existing!)} disabled={isPending} className="text-xs text-red-500 hover:underline">
                  ลบ
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <button onClick={() => setEditingPunch(null)} className="rounded-lg px-3 py-2 text-sm hover:bg-neutral-100">ยกเลิก</button>
                <button onClick={handleSave} disabled={!timeInput || isPending} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
                  บันทึก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const WEEKDAY_TH_FULL = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
