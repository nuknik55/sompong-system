"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertAttendanceDaily, deleteAttendanceDailyRecord } from "../actions";
import type { Employee, Department, LeaveType, Holiday, AttendanceDaily } from "../actions";

const DAY_OF_WEEK: Record<string, number> = {
  อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6,
};
const DAY_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

type Status = "present" | "absent" | "late" | "leave" | "day_off";

const S: Record<Status, { label: string; short: string; cell: string; btn: string }> = {
  present: { label: "มา",   short: "✓", cell: "bg-green-50 text-green-700",      btn: "bg-green-100 text-green-800 hover:bg-green-200" },
  absent:  { label: "ขาด",  short: "✗", cell: "bg-red-50 text-red-700",          btn: "bg-red-100 text-red-800 hover:bg-red-200" },
  late:    { label: "สาย",  short: "ส", cell: "bg-amber-50 text-amber-700",      btn: "bg-amber-100 text-amber-800 hover:bg-amber-200" },
  leave:   { label: "ลา",   short: "ล", cell: "bg-blue-50 text-blue-700",        btn: "bg-blue-100 text-blue-800 hover:bg-blue-200" },
  day_off: { label: "หยุด", short: "–", cell: "bg-neutral-100 text-neutral-500", btn: "bg-neutral-200 text-neutral-700 hover:bg-neutral-300" },
};

type EditState = {
  empId: string;
  empName: string;
  date: string;
  displayDate: string;
  status: Status;
  lateMin: number;
  otHours: number;
  leaveTypeId: string;
  note: string;
};

export function AttendanceClient({
  employees,
  departments,
  initialRecords,
  leaveTypes,
  holidays,
  year,
  month,
  deptId,
}: {
  employees: Employee[];
  departments: Department[];
  initialRecords: AttendanceDaily[];
  leaveTypes: LeaveType[];
  holidays: Holiday[];
  year: number;
  month: number;
  deptId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const [records, setRecords] = useState<Map<string, AttendanceDaily>>(() => {
    const m = new Map<string, AttendanceDaily>();
    for (const r of initialRecords) m.set(`${r.employee_id}_${r.work_date}`, r);
    return m;
  });

  const [edit, setEdit] = useState<EditState | null>(null);

  const holidayDates = new Set(holidays.map((h) => h.holiday_date));
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const leaveTypeMap = new Map(leaveTypes.map((lt) => [lt.id, lt.code]));

  const visibleEmps = deptId
    ? employees.filter((e) => e.department_id === deptId)
    : employees;

  function goMonth(delta: number) {
    let y = year, m = month + delta;
    if (m > 12) { y++; m = 1; }
    if (m < 1)  { y--; m = 12; }
    const p = new URLSearchParams({ year: String(y), month: String(m) });
    if (deptId) p.set("dept", deptId);
    router.push(`/owner/hr/attendance?${p}`);
  }

  function setDept(id: string) {
    const p = new URLSearchParams({ year: String(year), month: String(month) });
    if (id) p.set("dept", id);
    router.push(`/owner/hr/attendance?${p}`);
  }

  function dateStr(day: number) {
    return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
  }

  function getDow(day: number) {
    return new Date(year, month - 1, day).getDay();
  }

  function getRecord(empId: string, day: number) {
    return records.get(`${empId}_${dateStr(day)}`);
  }

  function isWeeklyOff(emp: Employee, day: number) {
    const dow = DAY_OF_WEEK[emp.weekly_day_off ?? ""] ?? -1;
    return dow === getDow(day);
  }

  function openEdit(emp: Employee, day: number) {
    const rec = getRecord(emp.id, day);
    const ds = dateStr(day);
    const isHol = holidayDates.has(ds);
    const isOff = isWeeklyOff(emp, day);
    let defaultStatus: Status = "present";
    if (rec) defaultStatus = rec.status as Status;
    else if (isHol || isOff) defaultStatus = "day_off";

    setEdit({
      empId: emp.id,
      empName: emp.nickname ?? emp.full_name,
      date: ds,
      displayDate: `${day} ${MONTHS_TH[month - 1]} ${year + 543}`,
      status: defaultStatus,
      lateMin: rec?.late_minutes ?? 0,
      otHours: rec?.ot_hours ?? 0,
      leaveTypeId: rec?.leave_type_id ?? (leaveTypes[0]?.id ?? ""),
      note: rec?.note ?? "",
    });
  }

  function saveEdit() {
    if (!edit) return;
    const rec: AttendanceDaily = {
      id: records.get(`${edit.empId}_${edit.date}`)?.id ?? crypto.randomUUID(),
      employee_id: edit.empId,
      work_date: edit.date,
      status: edit.status,
      late_minutes: edit.status === "late" ? edit.lateMin : 0,
      ot_hours: edit.otHours,
      leave_type_id: edit.status === "leave" ? (edit.leaveTypeId || null) : null,
      note: edit.note || null,
      source: "manual",
    };
    setRecords((prev) => new Map(prev).set(`${edit.empId}_${edit.date}`, rec));
    const snapshot = { ...edit };
    setEdit(null);
    setSaving(true);
    startTransition(async () => {
      await upsertAttendanceDaily({
        employee_id: rec.employee_id,
        work_date: rec.work_date,
        status: rec.status,
        late_minutes: rec.late_minutes,
        ot_hours: rec.ot_hours,
        leave_type_id: rec.leave_type_id,
        note: rec.note,
      });
      setSaving(false);
    });
  }

  function clearCell() {
    if (!edit) return;
    const key = `${edit.empId}_${edit.date}`;
    const empId = edit.empId;
    const date = edit.date;
    setRecords((prev) => { const m = new Map(prev); m.delete(key); return m; });
    setEdit(null);
    setSaving(true);
    startTransition(async () => {
      await deleteAttendanceDailyRecord(empId, date);
      setSaving(false);
    });
  }

  function summary(empId: string) {
    let absent = 0, lateMin = 0, leave = 0, ot = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const r = getRecord(empId, d);
      if (!r) continue;
      if (r.status === "absent") absent++;
      if (r.status === "late") lateMin += r.late_minutes;
      if (r.status === "leave") leave++;
      ot += Number(r.ot_hours);
    }
    return { absent, lateMin, leave, ot };
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={deptId}
          onChange={(e) => setDept(e.target.value)}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm"
        >
          <option value="">ทุกแผนก</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50">←</button>
          <span className="min-w-[130px] text-center text-sm font-medium">
            {MONTHS_TH[month - 1]} {year + 543}
          </span>
          <button onClick={() => goMonth(1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50">→</button>
        </div>

        {saving && <span className="text-xs text-neutral-400">กำลังบันทึก…</span>}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.entries(S) as [Status, (typeof S)[Status]][]).map(([k, v]) => (
          <span key={k} className={`rounded px-2 py-0.5 font-medium ${v.cell}`}>{v.short} {v.label}</span>
        ))}
        <span className="rounded bg-purple-50 px-2 py-0.5 font-medium text-purple-700">* นักขัตฤกษ์</span>
        <span className="ml-2 text-neutral-400">คลิกช่องเพื่อบันทึกสถานะ</span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-neutral-800 text-neutral-200">
              <th className="sticky left-0 z-10 min-w-[100px] bg-neutral-800 px-3 py-2 text-left font-medium">ชื่อ</th>
              {days.map((d) => {
                const dow = getDow(d);
                const isHol = holidayDates.has(dateStr(d));
                return (
                  <th key={d} className={`min-w-[28px] px-0 py-1 text-center font-normal ${isHol ? "text-purple-300" : dow === 0 ? "text-red-300" : dow === 6 ? "text-amber-300" : ""}`}>
                    <div className="text-[11px]">{d}</div>
                    <div className="text-[9px] opacity-60">{DAY_SHORT[dow]}</div>
                  </th>
                );
              })}
              <th className="min-w-[32px] bg-neutral-700 px-1 py-2 text-center text-[11px] font-normal">ขาด</th>
              <th className="min-w-[40px] bg-neutral-700 px-1 py-2 text-center text-[11px] font-normal">สาย(ม.)</th>
              <th className="min-w-[32px] bg-neutral-700 px-1 py-2 text-center text-[11px] font-normal">ลา</th>
              <th className="min-w-[40px] bg-neutral-700 px-1 py-2 text-center text-[11px] font-normal">OT(ชม.)</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmps.length === 0 && (
              <tr><td colSpan={daysInMonth + 5} className="py-8 text-center text-neutral-400">ไม่มีพนักงานในแผนกนี้</td></tr>
            )}
            {visibleEmps.map((emp, ei) => {
              const sum = summary(emp.id);
              const rowBg = ei % 2 === 0 ? "bg-white" : "bg-neutral-50/40";
              const stickyBg = ei % 2 === 0 ? "bg-white" : "bg-neutral-50";
              return (
                <tr key={emp.id} className={`border-b border-neutral-100 last:border-0 ${rowBg}`}>
                  <td className={`sticky left-0 z-10 border-r border-neutral-100 px-3 py-1.5 ${stickyBg}`}>
                    <div className="max-w-[96px] truncate font-medium text-neutral-900">{emp.nickname ?? emp.full_name}</div>
                    {emp.department_name && <div className="truncate text-[10px] text-neutral-400">{emp.department_name}</div>}
                  </td>

                  {days.map((d) => {
                    const ds = dateStr(d);
                    const rec = getRecord(emp.id, d);
                    const isHol = holidayDates.has(ds);
                    const isOff = isWeeklyOff(emp, d);
                    const dow = getDow(d);
                    const isEditing = edit?.empId === emp.id && edit?.date === ds;

                    let cellCls = "cursor-pointer select-none transition-colors ";
                    let content: React.ReactNode = null;

                    if (isEditing) {
                      cellCls += "ring-2 ring-inset ring-neutral-900 ";
                    }

                    if (rec) {
                      const cfg = S[rec.status as Status] ?? S.present;
                      cellCls += cfg.cell;
                      if (rec.status === "late" && rec.late_minutes > 0) {
                        content = <span className="text-[9px]">{rec.late_minutes}'</span>;
                      } else if (rec.status === "leave" && rec.leave_type_id) {
                        content = <span className="text-[9px]">{leaveTypeMap.get(rec.leave_type_id) ?? "ล"}</span>;
                      } else {
                        content = <span>{cfg.short}</span>;
                      }
                    } else if (isHol) {
                      cellCls += "bg-purple-50 text-purple-400 hover:bg-purple-100";
                      content = <span className="text-[9px]">*</span>;
                    } else if (isOff) {
                      cellCls += "bg-neutral-100 text-neutral-400 hover:bg-neutral-200";
                      content = <span>–</span>;
                    } else if (dow === 0) {
                      cellCls += "bg-red-50/40 text-neutral-200 hover:bg-red-50";
                    } else {
                      cellCls += "text-neutral-200 hover:bg-green-50";
                    }

                    return (
                      <td
                        key={d}
                        onClick={() => openEdit(emp, d)}
                        className={`h-8 w-7 text-center font-medium ${cellCls}`}
                      >
                        {content}
                      </td>
                    );
                  })}

                  <td className="bg-neutral-50/60 px-1 py-1.5 text-center font-semibold text-red-600">{sum.absent > 0 ? sum.absent : ""}</td>
                  <td className="bg-neutral-50/60 px-1 py-1.5 text-center text-amber-700">{sum.lateMin > 0 ? sum.lateMin : ""}</td>
                  <td className="bg-neutral-50/60 px-1 py-1.5 text-center text-blue-700">{sum.leave > 0 ? sum.leave : ""}</td>
                  <td className="bg-neutral-50/60 px-1 py-1.5 text-center text-neutral-600">{sum.ot > 0 ? sum.ot : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit panel — fixed bottom */}
      {edit && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-neutral-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <div className="min-w-[120px]">
              <p className="text-xs font-semibold text-neutral-900">{edit.empName}</p>
              <p className="text-[11px] text-neutral-500">{edit.displayDate}</p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(S) as [Status, (typeof S)[Status]][]).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setEdit((e) => e ? { ...e, status: k } : e)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${edit.status === k ? `${v.btn} ring-2 ring-neutral-400 ring-offset-1` : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {edit.status === "late" && (
              <label className="flex items-center gap-1.5 text-xs">
                <span className="text-neutral-600">สาย</span>
                <input
                  type="number" min={0}
                  value={edit.lateMin}
                  onChange={(e) => setEdit((v) => v ? { ...v, lateMin: +e.target.value } : v)}
                  className="w-16 rounded border border-neutral-300 px-2 py-1 text-center text-xs"
                />
                <span className="text-neutral-600">นาที</span>
              </label>
            )}

            {edit.status === "leave" && leaveTypes.length > 0 && (
              <select
                value={edit.leaveTypeId}
                onChange={(e) => setEdit((v) => v ? { ...v, leaveTypeId: e.target.value } : v)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs"
              >
                {leaveTypes.map((lt) => (
                  <option key={lt.id} value={lt.id}>{lt.code} – {lt.name_th}</option>
                ))}
              </select>
            )}

            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-neutral-500">OT</span>
              <input
                type="number" min={0} step={0.5}
                value={edit.otHours}
                onChange={(e) => setEdit((v) => v ? { ...v, otHours: +e.target.value } : v)}
                className="w-16 rounded border border-neutral-300 px-2 py-1 text-center text-xs"
              />
              <span className="text-neutral-500">ชม.</span>
            </label>

            <input
              type="text" placeholder="หมายเหตุ"
              value={edit.note}
              onChange={(e) => setEdit((v) => v ? { ...v, note: e.target.value } : v)}
              className="w-32 rounded border border-neutral-300 px-2 py-1 text-xs"
            />

            <div className="ml-auto flex gap-2">
              <button onClick={clearCell} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50">
                ล้าง
              </button>
              <button onClick={() => setEdit(null)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50">
                ยกเลิก
              </button>
              <button onClick={saveEdit} disabled={isPending} className="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}

      {edit && <div className="h-20" />}
    </div>
  );
}
