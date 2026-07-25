"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertScheduleNote } from "../actions";
import type { Employee, Department, Holiday, ScheduleNote, NoteType, LeaveDay } from "../actions";

const MONTHS_TH = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const DAYS_LONG = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
const DAYS_SHORT = ["อา","จ","อ","พ","พฤ","ศ","ส"];

const DAY_OF_WEEK: Record<string, number> = {
  อาทิตย์: 0, จันทร์: 1, อังคาร: 2, พุธ: 3, พฤหัสบดี: 4, ศุกร์: 5, เสาร์: 6,
};

type NoteConfig = { label: string; short: string; cell: string; badge: string };
const NOTE_CFG: Record<NoteType, NoteConfig> = {
  compensatory: { label: "ชดเชย",        short: "ชด", cell: "bg-orange-100 text-orange-900", badge: "bg-orange-500" },
  holiday_use:  { label: "ใช้สิทธิ์หยุด", short: "สท", cell: "bg-blue-100 text-blue-900",   badge: "bg-blue-500" },
  leave:        { label: "ลา",            short: "ลา", cell: "bg-sky-100 text-sky-900",      badge: "bg-sky-500" },
  sick:         { label: "ลาป่วย",        short: "ป่", cell: "bg-red-100 text-red-900",      badge: "bg-red-500" },
  vacation:     { label: "พักร้อน",       short: "พร", cell: "bg-teal-100 text-teal-900",   badge: "bg-teal-600" },
  event:        { label: "งานพิเศษ",      short: "งาน",cell: "bg-amber-100 text-amber-900", badge: "bg-amber-500" },
  note:         { label: "หมายเหตุ",      short: "⚑",  cell: "bg-yellow-50 text-yellow-900",badge: "bg-yellow-400" },
};

/** Map an approved leave to the closest schedule note style, based on type name keywords. */
function leaveNoteStyle(code: string, name: string): NoteConfig {
  const n = name;
  if (n.includes("พักร้อน") || n.includes("annual") || code === "AL")
    return NOTE_CFG.vacation;
  if (n.includes("ป่วย") || n.includes("sick") || code === "SL")
    return NOTE_CFG.sick;
  if (n.includes("กิจ") || n.includes("personal") || code === "PL")
    return NOTE_CFG.leave;
  return NOTE_CFG.leave;
}

type EditState = {
  empId: string;
  empName: string;
  date: string;
  displayDate: string;
  note: string;
  noteType: NoteType;
};

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateStr(base: Date, offset: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offset);
  return localDateStr(d);
}

function thaiDate(ds: string): string {
  const d = new Date(ds + "T00:00:00");
  return `${d.getDate()} ${MONTHS_TH[d.getMonth()]} ${d.getFullYear() + 543}`;
}

export function ScheduleClient({
  employees,
  departments,
  notes,
  leaveDays,
  holidays,
  weekStart,
  deptId,
}: {
  employees: Employee[];
  departments: Department[];
  notes: ScheduleNote[];
  leaveDays: LeaveDay[];
  holidays: Holiday[];
  weekStart: string;
  deptId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [noteMap, setNoteMap] = useState<Map<string, ScheduleNote>>(() => {
    const m = new Map<string, ScheduleNote>();
    for (const n of notes) m.set(`${n.employee_id}_${n.note_date}`, n);
    return m;
  });
  // approved leaves — read-only overlay (schedule_note takes priority if both exist)
  const leaveMap = new Map<string, LeaveDay>(
    leaveDays.map((l) => [`${l.employee_id}_${l.leave_date}`, l])
  );
  const [edit, setEdit] = useState<EditState | null>(null);

  const monday = new Date(weekStart + "T00:00:00");
  const weekDates = Array.from({ length: 7 }, (_, i) => dateStr(monday, i));
  const holidaySet = new Set(holidays.map((h) => h.holiday_date));
  const holidayName = new Map(holidays.map((h) => [h.holiday_date, h.name]));

  const visibleEmps = deptId
    ? employees.filter((e) => e.department_id === deptId)
    : employees;

  function goWeek(delta: number) {
    const d = new Date(monday);
    d.setDate(d.getDate() + delta * 7);
    const p = new URLSearchParams({ week: localDateStr(d) });
    if (deptId) p.set("dept", deptId);
    router.push(`/owner/hr/schedule?${p}`);
  }

  function setDept(id: string) {
    const p = new URLSearchParams({ week: weekStart });
    if (id) p.set("dept", id);
    router.push(`/owner/hr/schedule?${p}`);
  }

  function getNote(empId: string, ds: string) {
    return noteMap.get(`${empId}_${ds}`);
  }

  function isRegularOff(emp: Employee, ds: string): boolean {
    const dow = DAY_OF_WEEK[emp.weekly_day_off ?? ""] ?? -1;
    return dow === new Date(ds + "T00:00:00").getDay();
  }

  function openEdit(emp: Employee, ds: string) {
    const existing = getNote(emp.id, ds);
    setEdit({
      empId: emp.id,
      empName: emp.nickname ?? emp.full_name,
      date: ds,
      displayDate: `${DAYS_LONG[new Date(ds + "T00:00:00").getDay()]}ที่ ${thaiDate(ds)}`,
      note: existing?.note ?? "",
      noteType: existing?.note_type ?? "leave",
    });
  }

  function saveEdit() {
    if (!edit) return;
    const key = `${edit.empId}_${edit.date}`;
    const updated: ScheduleNote = {
      id: noteMap.get(key)?.id ?? crypto.randomUUID(),
      employee_id: edit.empId,
      note_date: edit.date,
      note: edit.note.trim(),
      note_type: edit.noteType,
    };
    setNoteMap((prev) => new Map(prev).set(key, updated));
    const snap = { ...edit };
    setEdit(null);
    setSaving(true);
    startTransition(async () => {
      await upsertScheduleNote(snap.empId, snap.date, snap.note.trim(), snap.noteType);
      setSaving(false);
    });
  }

  function clearNote() {
    if (!edit) return;
    const key = `${edit.empId}_${edit.date}`;
    setNoteMap((prev) => { const m = new Map(prev); m.delete(key); return m; });
    const snap = { ...edit };
    setEdit(null);
    setSaving(true);
    startTransition(async () => {
      await upsertScheduleNote(snap.empId, snap.date, "", snap.noteType);
      setSaving(false);
    });
  }

  const ABSENT_TYPES = new Set<NoteType>(["leave", "sick", "vacation", "holiday_use", "compensatory"]);
  function headcount(ds: string): number {
    return visibleEmps.filter((emp) => {
      if (isRegularOff(emp, ds)) return false;
      if (holidaySet.has(ds)) return false;
      const n = getNote(emp.id, ds);
      if (n && ABSENT_TYPES.has(n.note_type)) return false;
      // approved leave counts as absent
      if (!n && leaveMap.has(`${emp.id}_${ds}`)) return false;
      return true;
    }).length;
  }

  const printUrl = `/owner/hr/schedule/print?week=${weekStart}${deptId ? `&dept=${deptId}` : ""}`;

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
          <button onClick={() => goWeek(-1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50">←</button>
          <span className="min-w-[220px] text-center text-sm font-medium">
            {thaiDate(weekDates[0])} – {thaiDate(weekDates[6])}
          </span>
          <button onClick={() => goWeek(1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50">→</button>
        </div>

        <button
          onClick={() => {
            const today = localDateStr(new Date());
            const p = new URLSearchParams({ week: today });
            if (deptId) p.set("dept", deptId);
            router.push(`/owner/hr/schedule?${p}`);
          }}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm hover:bg-neutral-50"
        >
          สัปดาห์นี้
        </button>

        <a
          href={printUrl}
          target="_blank"
          className="ml-auto rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
        >
          🖨 พิมพ์ / PDF
        </a>

        {saving && <span className="text-xs text-neutral-400">กำลังบันทึก…</span>}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded bg-neutral-200 px-2 py-0.5 font-medium text-neutral-600">– วันหยุดประจำ</span>
        <span className="rounded bg-purple-100 px-2 py-0.5 font-medium text-purple-700">★ นักขัตฤกษ์</span>
        {(Object.entries(NOTE_CFG) as [NoteType, NoteConfig][]).map(([k, v]) => (
          <span key={k} className={`rounded px-2 py-0.5 font-medium ${v.cell}`}>{v.label}</span>
        ))}
        <span className="text-neutral-400">&nbsp;|&nbsp;✓ = มีใบลาอนุมัติแล้ว</span>
        <span className="ml-2 text-neutral-400">คลิกช่องเพื่อเพิ่ม/แก้ไขโน้ต</span>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-neutral-800 text-neutral-100">
              <th className="sticky left-0 z-10 min-w-[120px] bg-neutral-800 px-3 py-2 text-left font-medium">ชื่อ / หน้าที่</th>
              <th className="min-w-[40px] px-2 py-2 text-center font-normal text-neutral-400">หยุดประจำ</th>
              {weekDates.map((ds) => {
                const dow = new Date(ds + "T00:00:00").getDay();
                const isHol = holidaySet.has(ds);
                const d = new Date(ds + "T00:00:00");
                return (
                  <th key={ds} className={`min-w-[80px] px-1 py-1 text-center ${isHol ? "bg-purple-700 text-purple-100" : dow === 0 ? "text-red-300" : dow === 6 ? "text-amber-300" : ""}`}>
                    <div className="text-[11px] font-semibold">{DAYS_SHORT[dow]}</div>
                    <div className="text-[10px] opacity-75">{d.getDate()} {MONTHS_TH[d.getMonth()]}</div>
                    {isHol && <div className="truncate text-[9px] opacity-80">{holidayName.get(ds)}</div>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleEmps.length === 0 && (
              <tr><td colSpan={10} className="py-8 text-center text-neutral-400">ไม่มีพนักงานในแผนกนี้</td></tr>
            )}
            {visibleEmps.map((emp, ei) => {
              const rowBg = ei % 2 === 0 ? "bg-white" : "bg-neutral-50/50";
              const stickyBg = ei % 2 === 0 ? "bg-white" : "bg-neutral-50";
              return (
                <tr key={emp.id} className={`border-b-2 border-neutral-200 last:border-0 ${rowBg}`}>
                  <td className={`sticky left-0 z-10 border-r border-neutral-100 px-3 py-2 ${stickyBg}`}>
                    <div className="max-w-[110px] truncate font-medium text-neutral-900">{emp.nickname ?? emp.full_name}</div>
                    {emp.position && <div className="truncate text-[10px] text-neutral-400">{emp.position}</div>}
                  </td>
                  <td className="border-r border-neutral-100 px-2 py-2 text-center text-[11px] text-neutral-500">
                    {emp.weekly_day_off ? DAYS_SHORT[DAY_OF_WEEK[emp.weekly_day_off] ?? -1] ?? "–" : "–"}
                  </td>
                  {weekDates.map((ds) => {
                    const isOff = isRegularOff(emp, ds);
                    const isHol = holidaySet.has(ds);
                    const existingNote = getNote(emp.id, ds);
                    const approvedLeave = !existingNote ? leaveMap.get(`${emp.id}_${ds}`) : undefined;
                    const isEditing = edit?.empId === emp.id && edit?.date === ds;

                    let cellCls = "cursor-pointer select-none transition-colors h-10 px-1 py-1 text-center align-middle ";
                    if (isEditing) cellCls += "ring-2 ring-inset ring-neutral-900 ";

                    let content: React.ReactNode = null;

                    if (existingNote) {
                      const cfg = NOTE_CFG[existingNote.note_type] ?? NOTE_CFG.note;
                      cellCls += cfg.cell;
                      content = (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="font-bold text-[10px]">{cfg.label}</span>
                          {existingNote.note && <span className="text-[9px] leading-tight line-clamp-2 max-w-[76px] opacity-70">{existingNote.note}</span>}
                        </div>
                      );
                    } else if (approvedLeave) {
                      // from approved leave request — read-only, use leave-type-aware color
                      const lCfg = leaveNoteStyle(approvedLeave.leave_type_code, approvedLeave.leave_type_name);
                      cellCls += lCfg.cell + " hover:brightness-95";
                      content = (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="font-bold text-[10px]">{lCfg.label}</span>
                          <span className="text-[8px] font-semibold opacity-70">✓ใบลา</span>
                        </div>
                      );
                    } else if (isHol) {
                      cellCls += "bg-purple-100 text-purple-700 hover:bg-purple-200";
                      content = <span className="font-bold">★</span>;
                    } else if (isOff) {
                      cellCls += "bg-neutral-200 text-neutral-500 hover:bg-neutral-300";
                      content = <span className="font-bold text-sm">–</span>;
                    } else {
                      const dow = new Date(ds + "T00:00:00").getDay();
                      cellCls += dow === 0
                        ? "bg-red-50 hover:bg-red-100 text-neutral-200"
                        : "bg-white hover:bg-green-50 text-neutral-200 border-b border-neutral-100";
                    }

                    return (
                      <td
                        key={ds}
                        onClick={() => openEdit(emp, ds)}
                        className={`border-r border-neutral-100 last:border-r-0 ${cellCls}`}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Headcount row */}
            {visibleEmps.length > 0 && (
              <tr className="bg-neutral-100 border-t-2 border-neutral-300">
                <td className="sticky left-0 z-10 bg-neutral-100 px-3 py-2 text-[11px] font-semibold text-neutral-600" colSpan={2}>
                  กำลังคน (คน)
                </td>
                {weekDates.map((ds) => {
                  const hc = headcount(ds);
                  const total = visibleEmps.length;
                  const isLow = hc < Math.ceil(total * 0.6);
                  return (
                    <td key={ds} className={`border-r border-neutral-200 px-1 py-2 text-center text-sm font-bold ${isLow ? "text-red-600" : "text-neutral-700"}`}>
                      {hc}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {edit && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setEdit(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold text-neutral-900">{edit.empName}</p>
                <p className="text-xs text-neutral-500">{edit.displayDate}</p>
              </div>
              <button onClick={() => setEdit(null)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100">✕</button>
            </div>

            {/* Note type */}
            <div className="mb-3 grid grid-cols-4 gap-1.5">
              {(Object.entries(NOTE_CFG) as [NoteType, NoteConfig][]).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setEdit((e) => e ? { ...e, noteType: k } : e)}
                  className={`rounded-lg py-2.5 text-[11px] font-semibold transition-colors ${
                    edit.noteType === k
                      ? `${v.cell} ring-2 ring-offset-1 ring-neutral-400`
                      : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {/* Note text */}
            <div className="mb-4">
              <label className="mb-1 block text-xs text-neutral-500">รายละเอียด (ไม่บังคับ)</label>
              <input
                type="text"
                placeholder="เช่น ชดเชยมาฆบูชา, ลาป่วยมีใบแพทย์..."
                value={edit.note}
                onChange={(e) => setEdit((v) => v ? { ...v, note: e.target.value } : v)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-400"
                onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); }}
                autoFocus
              />
            </div>

            <div className="flex gap-2">
              <button onClick={clearNote} className="rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-500 hover:bg-neutral-50">
                ล้าง
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
    </div>
  );
}
