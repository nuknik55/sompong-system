"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { upsertAttendanceDaily, deleteAttendanceDailyRecord } from "../actions";
import type { Employee, Department, LeaveType, Holiday, AttendanceDaily, LeaveDay } from "../actions";

const DAY_OF_WEEK: Record<string, number> = {
  อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6,
};
const DAY_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

type Status = "present" | "absent" | "late" | "leave" | "day_off";

const S: Record<Status, { label: string; short: string; cell: string; btn: string }> = {
  present: { label: "มา",   short: "✓", cell: "bg-green-200 text-green-900",     btn: "bg-green-100 text-green-800 hover:bg-green-200" },
  absent:  { label: "ขาด",  short: "✗", cell: "bg-red-200 text-red-900",         btn: "bg-red-100 text-red-800 hover:bg-red-200" },
  late:    { label: "สาย",  short: "ส", cell: "bg-amber-200 text-amber-900",     btn: "bg-amber-100 text-amber-800 hover:bg-amber-200" },
  leave:   { label: "ลา",   short: "ล", cell: "bg-blue-200 text-blue-900",       btn: "bg-blue-100 text-blue-800 hover:bg-blue-200" },
  day_off: { label: "หยุด", short: "–", cell: "bg-neutral-300 text-neutral-600", btn: "bg-neutral-200 text-neutral-700 hover:bg-neutral-300" },
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
  leaveDays,
  year,
  month,
  deptId,
}: {
  employees: Employee[];
  departments: Department[];
  initialRecords: AttendanceDaily[];
  leaveTypes: LeaveType[];
  holidays: Holiday[];
  leaveDays: LeaveDay[];
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

  // Drag-to-select (desktop only)
  const isDraggingRef = useRef(false);
  const dragEmpIdRef = useRef<string | null>(null);
  const dragDatesRef = useRef<string[]>([]);
  const [dragHighlight, setDragHighlight] = useState<{ empId: string; dates: Set<string> } | null>(null);
  type BulkEdit = { empId: string; empName: string; dates: string[]; status: Status | null; lateMin: number; leaveTypeId: string };
  const [bulk, setBulk] = useState<BulkEdit | null>(null);

  const holidayDates = new Set(holidays.map((h) => h.holiday_date));
  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const leaveTypeMap = new Map(leaveTypes.map((lt) => [lt.id, lt.code]));
  const leaveMap = new Map(leaveDays.map((l) => [`${l.employee_id}_${l.leave_date}`, l]));
  const vacationTypeIds = new Set(leaveTypes.filter((lt) => lt.code === "AL" || lt.name_th.includes("พักร้อน")).map((lt) => lt.id));

  const visibleEmps = deptId
    ? employees.filter((e) => e.department_id === deptId)
    : employees;

  // Group employees by department (preserves sort order from getEmployees)
  const empGroups: { deptName: string; emps: typeof employees }[] = [];
  if (!deptId) {
    const seen = new Map<string, typeof employees>();
    for (const e of visibleEmps) {
      const k = e.department_name ?? "(ไม่มีแผนก)";
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k)!.push(e);
    }
    for (const [k, v] of seen) empGroups.push({ deptName: k, emps: v });
  } else {
    empGroups.push({ deptName: "", emps: visibleEmps });
  }

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
    let absent = 0, lateMin = 0, leave = 0, vacation = 0, ot = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const r = getRecord(empId, d);
      if (r) {
        if (r.status === "absent") absent++;
        if (r.status === "late") lateMin += r.late_minutes;
        if (r.status === "leave") {
          leave++;
          if (r.leave_type_id && vacationTypeIds.has(r.leave_type_id)) vacation++;
        }
        ot += Number(r.ot_hours);
      } else {
        const al = leaveMap.get(`${empId}_${dateStr(d)}`);
        if (al) {
          leave++;
          if (al.leave_type_code === "AL" || al.leave_type_name.includes("พักร้อน")) vacation++;
        }
      }
    }
    return { absent, lateMin, leave, vacation, ot };
  }

  function handleCellMouseDown(emp: Employee, day: number) {
    isDraggingRef.current = true;
    dragEmpIdRef.current = emp.id;
    const ds = dateStr(day);
    dragDatesRef.current = [ds];
    setDragHighlight({ empId: emp.id, dates: new Set([ds]) });
  }

  function handleCellMouseEnter(emp: Employee, day: number) {
    if (!isDraggingRef.current || dragEmpIdRef.current !== emp.id) return;
    const ds = dateStr(day);
    if (!dragDatesRef.current.includes(ds)) {
      dragDatesRef.current = [...dragDatesRef.current, ds];
      setDragHighlight((prev) => {
        if (!prev) return null;
        const next = new Set(prev.dates);
        next.add(ds);
        return { empId: prev.empId, dates: next };
      });
    }
  }

  useEffect(() => {
    function handleMouseUp() {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const empId = dragEmpIdRef.current;
      const dates = [...dragDatesRef.current].sort();
      dragEmpIdRef.current = null;
      dragDatesRef.current = [];
      setDragHighlight(null);
      if (!empId || dates.length <= 1) return; // single cell → onClick handles it
      const emp = visibleEmps.find((e) => e.id === empId);
      setBulk({
        empId,
        empName: emp?.nickname ?? emp?.full_name ?? "",
        dates,
        status: null,
        lateMin: 0,
        leaveTypeId: leaveTypes[0]?.id ?? "",
      });
    }
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [visibleEmps, leaveTypes]);

  function clearBulk() {
    if (!bulk) return;
    const empId = bulk.empId;
    const toClear = bulk.dates.filter((ds) => records.has(`${empId}_${ds}`));
    setRecords((prev) => {
      const m = new Map(prev);
      for (const ds of toClear) m.delete(`${empId}_${ds}`);
      return m;
    });
    setBulk(null);
    if (toClear.length === 0) return;
    setSaving(true);
    startTransition(async () => {
      for (const ds of toClear) await deleteAttendanceDailyRecord(empId, ds);
      setSaving(false);
    });
  }

  function applyBulk() {
    if (!bulk || !bulk.status) return;
    const status = bulk.status;
    const toApply = bulk.dates.filter((ds) => !records.has(`${bulk.empId}_${ds}`));
    if (toApply.length === 0) { setBulk(null); return; }
    const newRecs: AttendanceDaily[] = toApply.map((ds) => ({
      id: crypto.randomUUID(),
      employee_id: bulk.empId,
      work_date: ds,
      status,
      late_minutes: status === "late" ? bulk.lateMin : 0,
      ot_hours: 0,
      leave_type_id: status === "leave" ? (bulk.leaveTypeId || null) : null,
      note: null,
      source: "manual",
    }));
    setRecords((prev) => {
      const m = new Map(prev);
      for (const r of newRecs) m.set(`${r.employee_id}_${r.work_date}`, r);
      return m;
    });
    setBulk(null);
    setSaving(true);
    startTransition(async () => {
      await Promise.all(
        newRecs.map((r) =>
          upsertAttendanceDaily({
            employee_id: r.employee_id,
            work_date: r.work_date,
            status: r.status,
            late_minutes: r.late_minutes,
            ot_hours: r.ot_hours,
            leave_type_id: r.leave_type_id,
            note: r.note,
          })
        )
      );
      setSaving(false);
    });
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
        <span className="rounded bg-teal-100 px-2 py-0.5 font-medium text-teal-800">ลา✓ ใบลาอนุมัติแล้ว</span>
        <span className="ml-2 text-neutral-400">คลิก หรือ ลากข้ามหลายวัน เพื่อบันทึกสถานะ</span>
      </div>

      {/* Grid */}
      <div className="overflow-auto rounded-lg border border-neutral-200" style={{ maxHeight: "calc(100vh - 260px)" }}>
        <table className={`w-full border-collapse text-xs${dragHighlight ? " select-none" : ""}`}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-neutral-800 text-neutral-200">
              <th className="sticky left-0 z-30 min-w-[100px] border-r-2 border-neutral-500 bg-neutral-800 px-3 py-2 text-left font-medium">ชื่อ</th>
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
              <th className="min-w-[32px] border-l-2 border-neutral-500 bg-neutral-600 px-1 py-2 text-center text-[11px] font-semibold">ขาด</th>
              <th className="min-w-[40px] bg-neutral-600 px-1 py-2 text-center text-[11px] font-semibold">สาย(น.)</th>
              <th className="min-w-[32px] bg-neutral-600 px-1 py-2 text-center text-[11px] font-semibold">ลา</th>
              <th className="min-w-[36px] bg-neutral-600 px-1 py-2 text-center text-[11px] font-semibold">พักร้อน</th>
              <th className="min-w-[40px] bg-neutral-600 px-1 py-2 text-center text-[11px] font-semibold">OT(ชม.)</th>
            </tr>
          </thead>
          <tbody>
            {visibleEmps.length === 0 && (
              <tr><td colSpan={daysInMonth + 6} className="py-8 text-center text-neutral-400">ไม่มีพนักงานในแผนกนี้</td></tr>
            )}
            {empGroups.map(({ deptName, emps }) => (
              <>
                {!deptId && (
                  <tr key={`dept-${deptName}`} className="bg-neutral-800 border-t-2 border-neutral-600">
                    <td colSpan={daysInMonth + 6} className="sticky left-0 px-3 py-1.5 text-xs font-bold text-white tracking-widest uppercase bg-neutral-800">
                      {deptName} <span className="font-normal text-neutral-400 normal-case tracking-normal">({emps.length} คน)</span>
                    </td>
                  </tr>
                )}
                {emps.map((emp, ei) => {
                  const sum = summary(emp.id);
                  const rowBg = ei % 2 === 0 ? "bg-white" : "bg-neutral-50/40";
                  const stickyBg = ei % 2 === 0 ? "bg-white" : "bg-neutral-50";
                  return (
                    <tr key={emp.id} className={`border-b border-neutral-200 last:border-0 ${rowBg}`}>
                      <td className={`sticky left-0 z-10 border-r-2 border-neutral-300 px-3 py-1.5 ${stickyBg}`}>
                        <div className="max-w-[96px] truncate font-medium text-neutral-900">{emp.nickname ?? emp.full_name}</div>
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

                        const approvedLeave = !rec ? leaveMap.get(`${emp.id}_${ds}`) : undefined;

                        if (rec) {
                          const cfg = S[rec.status as Status] ?? S.present;
                          cellCls += cfg.cell;
                          if (rec.status === "late" && rec.late_minutes > 0) {
                            content = <span className="text-[9px] font-bold">{rec.late_minutes}&apos;</span>;
                          } else if (rec.status === "leave" && rec.leave_type_id) {
                            content = <span className="text-[9px] font-bold">{leaveTypeMap.get(rec.leave_type_id) ?? "ล"}</span>;
                          } else {
                            content = <span className="font-bold">{cfg.short}</span>;
                          }
                        } else if (approvedLeave) {
                          cellCls += "bg-teal-100 text-teal-800 hover:bg-teal-200";
                          content = (
                            <div className="flex flex-col items-center leading-tight">
                              <span className="text-[8px] font-bold">ลา</span>
                              <span className="text-[7px] opacity-70">✓</span>
                            </div>
                          );
                        } else if (isHol) {
                          cellCls += "bg-purple-100 text-purple-600 hover:bg-purple-200";
                          content = <span className="text-[10px] font-bold">*</span>;
                        } else if (isOff) {
                          cellCls += "bg-neutral-200 text-neutral-500 hover:bg-neutral-300";
                          content = <span className="font-bold">–</span>;
                        } else if (dow === 0) {
                          cellCls += "bg-red-50 text-neutral-300 hover:bg-red-100";
                        } else {
                          cellCls += "bg-white text-neutral-300 hover:bg-green-100 border border-neutral-100";
                        }

                        const isDragHighlighted = dragHighlight?.empId === emp.id && dragHighlight.dates.has(ds);
                        return (
                          <td
                            key={d}
                            onClick={() => openEdit(emp, d)}
                            onMouseDown={() => handleCellMouseDown(emp, d)}
                            onMouseEnter={() => handleCellMouseEnter(emp, d)}
                            className={`h-8 w-7 text-center font-medium ${cellCls}${isDragHighlighted ? " ring-2 ring-inset ring-neutral-700" : ""}`}
                          >
                            {content}
                          </td>
                        );
                      })}

                      <td className="border-l-2 border-neutral-200 bg-neutral-50/60 px-1 py-1.5 text-center font-semibold text-red-600">{sum.absent > 0 ? sum.absent : ""}</td>
                      <td className="bg-neutral-50/60 px-1 py-1.5 text-center text-amber-700">{sum.lateMin > 0 ? sum.lateMin : ""}</td>
                      <td className="bg-neutral-50/60 px-1 py-1.5 text-center text-blue-700">{sum.leave > 0 ? sum.leave : ""}</td>
                      <td className="bg-neutral-50/60 px-1 py-1.5 text-center text-teal-700">{sum.vacation > 0 ? sum.vacation : ""}</td>
                      <td className="bg-neutral-50/60 px-1 py-1.5 text-center text-neutral-600">{sum.ot > 0 ? sum.ot : ""}</td>
                    </tr>
                  );
                })}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {edit && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setEdit(null)} />

          {/* modal */}
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl">
            {/* header */}
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-neutral-900">{edit.empName}</p>
                <p className="text-xs text-neutral-500">{edit.displayDate}</p>
              </div>
              <button onClick={() => setEdit(null)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600">✕</button>
            </div>

            {/* status buttons */}
            <div className="mb-4 grid grid-cols-5 gap-1.5">
              {(Object.entries(S) as [Status, (typeof S)[Status]][]).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setEdit((e) => e ? { ...e, status: k } : e)}
                  className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                    edit.status === k
                      ? `${v.cell} ring-2 ring-offset-1 ring-neutral-500`
                      : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                  }`}
                >
                  <div className="text-sm">{v.short}</div>
                  <div>{v.label}</div>
                </button>
              ))}
            </div>

            {/* conditional fields */}
            <div className="mb-4 space-y-2">
              {edit.status === "late" && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="w-20 text-neutral-600">สายกี่นาที</span>
                  <input
                    type="number" min={0}
                    value={edit.lateMin}
                    onChange={(e) => setEdit((v) => v ? { ...v, lateMin: +e.target.value } : v)}
                    className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-center text-sm"
                  />
                  <span className="text-neutral-500">นาที</span>
                </label>
              )}

              {edit.status === "leave" && leaveTypes.length > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="w-20 text-neutral-600">ประเภทลา</span>
                  <select
                    value={edit.leaveTypeId}
                    onChange={(e) => setEdit((v) => v ? { ...v, leaveTypeId: e.target.value } : v)}
                    className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    {leaveTypes.map((lt) => (
                      <option key={lt.id} value={lt.id}>{lt.code} – {lt.name_th}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="flex items-center gap-2 text-sm">
                <span className="w-20 text-neutral-600">OT</span>
                <input
                  type="number" min={0} step={0.5}
                  value={edit.otHours}
                  onChange={(e) => setEdit((v) => v ? { ...v, otHours: +e.target.value } : v)}
                  className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-center text-sm"
                />
                <span className="text-neutral-500">ชั่วโมง</span>
              </label>

              <label className="flex items-center gap-2 text-sm">
                <span className="w-20 text-neutral-600">หมายเหตุ</span>
                <input
                  type="text" placeholder="ระบุ..."
                  value={edit.note}
                  onChange={(e) => setEdit((v) => v ? { ...v, note: e.target.value } : v)}
                  className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                />
              </label>
            </div>

            {/* actions */}
            <div className="flex gap-2">
              <button onClick={clearCell} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500 hover:bg-neutral-50">
                ล้างข้อมูล
              </button>
              <div className="flex-1" />
              <button onClick={() => setEdit(null)} className="rounded-lg border border-neutral-200 px-4 py-2 text-xs text-neutral-500 hover:bg-neutral-50">
                ยกเลิก
              </button>
              <button onClick={saveEdit} disabled={isPending} className="rounded-lg bg-neutral-900 px-5 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-50">
                บันทึก
              </button>
            </div>
          </div>
        </>
      )}

      {/* Bulk drag dialog */}
      {bulk && (() => {
        const hasDataCount = bulk.dates.filter((ds) => records.has(`${bulk.empId}_${ds}`)).length;
        const applyCount = bulk.dates.length - hasDataCount;
        const dayNums = bulk.dates.map((ds) => parseInt(ds.split("-")[2]));
        return (
          <>
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setBulk(null)} />
            <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl">
              <div className="mb-3">
                <p className="text-sm font-semibold text-neutral-900">{bulk.empName}</p>
                <p className="text-xs text-neutral-500">
                  วันที่ {dayNums.join(", ")} ({bulk.dates.length} วัน{hasDataCount > 0 ? ` · มีข้อมูลแล้ว ${hasDataCount} วัน` : ""})
                </p>
              </div>

              {/* Status — ไม่มี "มา" เพราะช่องว่าง = มาทำงาน */}
              <div className="mb-3 grid grid-cols-4 gap-1.5">
                {(["absent", "late", "leave", "day_off"] as Status[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setBulk((b) => b ? { ...b, status: k } : b)}
                    className={`rounded-lg py-2 text-xs font-semibold transition-colors ${
                      bulk.status === k
                        ? `${S[k].cell} ring-2 ring-offset-1 ring-neutral-500`
                        : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                    }`}
                  >
                    {S[k].label}
                  </button>
                ))}
              </div>

              {bulk.status !== null && bulk.status === "late" && (
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <span className="w-20 text-neutral-600">สายกี่นาที</span>
                  <input
                    type="number" min={0}
                    value={bulk.lateMin}
                    onChange={(e) => setBulk((b) => b ? { ...b, lateMin: +e.target.value } : b)}
                    className="w-20 rounded border border-neutral-300 px-2 py-1.5 text-center text-sm"
                  />
                  <span className="text-neutral-500">น.</span>
                </label>
              )}

              {bulk.status !== null && bulk.status === "leave" && leaveTypes.length > 0 && (
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <span className="w-20 text-neutral-600">ประเภทลา</span>
                  <select
                    value={bulk.leaveTypeId}
                    onChange={(e) => setBulk((b) => b ? { ...b, leaveTypeId: e.target.value } : b)}
                    className="flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    {leaveTypes.map((lt) => (
                      <option key={lt.id} value={lt.id}>{lt.code} – {lt.name_th}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex gap-2">
                <button
                  onClick={clearBulk}
                  disabled={hasDataCount === 0 || isPending}
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500 hover:bg-neutral-50 disabled:opacity-40"
                >
                  ล้างข้อมูล
                </button>
                <div className="flex-1" />
                <button onClick={() => setBulk(null)} className="rounded-lg border border-neutral-200 px-4 py-2 text-xs text-neutral-500 hover:bg-neutral-50">
                  ยกเลิก
                </button>
                <button
                  onClick={applyBulk}
                  disabled={bulk.status === null || applyCount === 0 || isPending}
                  className="rounded-lg bg-neutral-900 px-5 py-2 text-xs font-semibold text-white hover:bg-neutral-700 disabled:opacity-40"
                >
                  บันทึก {applyCount} วัน
                </button>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
