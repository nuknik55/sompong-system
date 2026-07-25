export const dynamic = "force-dynamic";

import { requireHROrAdmin } from "@/lib/auth";
import { getEmployees, getDepartments, getHolidays, getScheduleWeek, getApprovedLeavesForWeek } from "../../actions";
import { PrintButtons } from "./PrintButtons";

const MONTHS_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const DAYS_LONG = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
const DAY_OF_WEEK: Record<string, number> = {
  อาทิตย์:0, จันทร์:1, อังคาร:2, พุธ:3, พฤหัสบดี:4, ศุกร์:5, เสาร์:6,
};

function getMondayOf(ds: string): string {
  const d = new Date(ds + "T00:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function thaiDateShort(ds: string): string {
  const d = new Date(ds + "T00:00:00");
  return `${d.getDate()} ${MONTHS_TH[d.getMonth()].slice(0,3)}. ${d.getFullYear() + 543}`;
}

function thaiDateFull(ds: string): string {
  const d = new Date(ds + "T00:00:00");
  return `${DAYS_LONG[d.getDay()]}ที่ ${d.getDate()} ${MONTHS_TH[d.getMonth()]} ${d.getFullYear() + 543}`;
}

export default async function SchedulePrintPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; dept?: string }>;
}) {
  await requireHROrAdmin();
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const weekStart = sp.week ? getMondayOf(sp.week) : getMondayOf(today);
  const deptId = sp.dept ?? "";
  const year = parseInt(weekStart.slice(0, 4));

  const [employees, departments, notes, leaveDays, holidays, nextHol] = await Promise.all([
    getEmployees(),
    getDepartments(),
    getScheduleWeek(weekStart),
    getApprovedLeavesForWeek(weekStart),
    getHolidays(year),
    getHolidays(year + 1),
  ]);

  const allHolidays = [...holidays, ...nextHol].filter((h) => h.is_active);
  const holidaySet = new Set(allHolidays.map((h) => h.holiday_date));
  const holidayName = new Map(allHolidays.map((h) => [h.holiday_date, h.name]));

  const noteMap = new Map(notes.map((n) => [`${n.employee_id}_${n.note_date}`, n]));
  const leaveMap = new Map(leaveDays.map((l) => [`${l.employee_id}_${l.leave_date}`, l]));

  const visibleEmps = (deptId
    ? employees.filter((e) => e.department_id === deptId)
    : employees
  ).filter((e) => e.is_active);

  const deptName = deptId ? (departments.find((d) => d.id === deptId)?.name ?? "") : "ทุกแผนก";

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const ABSENT_TYPES = new Set(["leave", "sick", "vacation", "holiday_use", "compensatory"]);

  function headcount(ds: string): number {
    return visibleEmps.filter((emp) => {
      const dow = DAY_OF_WEEK[emp.weekly_day_off ?? ""] ?? -1;
      if (dow === new Date(ds + "T00:00:00").getDay()) return false;
      if (holidaySet.has(ds)) return false;
      const n = noteMap.get(`${emp.id}_${ds}`);
      if (n && ABSENT_TYPES.has(n.note_type)) return false;
      if (!n && leaveMap.has(`${emp.id}_${ds}`)) return false;
      return true;
    }).length;
  }

  const printDate = new Date();
  const printDateStr = `${printDate.getDate()} ${MONTHS_TH[printDate.getMonth()]} ${printDate.getFullYear() + 543}`;

  return (
    <>
      <style>{`
        @page { size: A4 landscape; margin: 12mm 15mm; }
        @media print { .no-print { display: none !important; } body { margin: 0; } }
        * { box-sizing: border-box; }
        body { font-family: 'TH SarabunNew', 'Sarabun', 'Angsana New', Arial, sans-serif; font-size: 13px; color: #000; background: #fff; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #555; padding: 3px 5px; }
        th { background: #1a1a1a; color: #fff; text-align: center; }
        .hol-head { background: #5b21b6; color: #fff; }
        .day-off { background: #d1d5db; color: #374151; text-align: center; }
        .hol-cell { background: #ede9fe; color: #4c1d95; text-align: center; }
        .cell-compensatory { background: #ffedd5; color: #7c2d12; }
        .cell-holiday_use  { background: #dbeafe; color: #1e3a5f; }
        .cell-leave        { background: #e0f2fe; color: #0c4a6e; }
        .cell-sick         { background: #fee2e2; color: #7f1d1d; }
        .cell-vacation     { background: #ccfbf1; color: #134e4a; }
        .cell-event        { background: #fef3c7; color: #78350f; }
        .cell-note         { background: #fefce8; color: #713f12; }
        .headcount-row td  { background: #f3f4f6; font-weight: bold; text-align: center; }
        .red-head { color: #ef4444; }
        .sun-head { color: #fca5a5; }
        .sat-head { color: #fcd34d; }
        .sticky-name { text-align: left; min-width: 110px; max-width: 130px; }
        .note-text { font-size: 10px; word-break: break-word; }
        h2 { margin: 0 0 6px 0; font-size: 16px; font-weight: bold; }
        .sub { font-size: 12px; color: #555; margin-bottom: 8px; }
        .footer-note { margin-top: 10px; font-size: 11px; color: #444; border-top: 1px solid #ccc; padding-top: 6px; }
        .print-date { text-align: right; font-size: 10px; color: #888; margin-bottom: 4px; }
      `}</style>

      <PrintButtons />

      <div style={{ padding: "16px 8px" }}>
        <p className="print-date">พิมพ์วันที่ {printDateStr}</p>
        <h2>รายชื่อพนักงาน{deptName !== "ทุกแผนก" ? `แผนก${deptName}` : ""}</h2>
        <p className="sub">
          ตารางวันหยุดประจำสัปดาห์ &nbsp;|&nbsp;
          {thaiDateFull(weekDates[0])} – {thaiDateFull(weekDates[6])}
        </p>

        <table>
          <thead>
            <tr>
              <th style={{ width: 28, minWidth: 28 }}>ที่</th>
              <th className="sticky-name">ชื่อ</th>
              <th style={{ width: 90 }}>หน้าที่</th>
              <th style={{ width: 42 }}>วันหยุด<br/>ประจำ</th>
              {weekDates.map((ds) => {
                const dow = new Date(ds + "T00:00:00").getDay();
                const isHol = holidaySet.has(ds);
                const d = new Date(ds + "T00:00:00");
                return (
                  <th key={ds} className={isHol ? "hol-head" : dow === 0 ? "sun-head" : dow === 6 ? "sat-head" : ""} style={{ minWidth: 80 }}>
                    {DAYS_LONG[dow]}<br/>
                    {thaiDateShort(ds)}<br/>
                    {isHol && <span style={{ fontSize: 10, opacity: 0.85 }}>{holidayName.get(ds)}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleEmps.map((emp, ei) => {
              const dowOff = DAY_OF_WEEK[emp.weekly_day_off ?? ""] ?? -1;
              return (
                <tr key={emp.id}>
                  <td style={{ textAlign: "center" }}>{ei + 1}</td>
                  <td className="sticky-name">{emp.nickname ?? emp.full_name}</td>
                  <td>{emp.position ?? ""}</td>
                  <td style={{ textAlign: "center" }}>{emp.weekly_day_off ? DAYS_LONG[dowOff]?.slice(0, 2) ?? "–" : "–"}</td>
                  {weekDates.map((ds) => {
                    const d = new Date(ds + "T00:00:00");
                    const isOff = dowOff === d.getDay();
                    const isHol = holidaySet.has(ds);
                    const n = noteMap.get(`${emp.id}_${ds}`);
                    const lv = !n ? leaveMap.get(`${emp.id}_${ds}`) : undefined;
                    let cls = "";
                    let text = "";
                    if (n) {
                      cls = `cell-${n.note_type}`;
                      text = n.note;
                    } else if (lv) {
                      const lvName = lv.leave_type_name;
                      const lvCode = lv.leave_type_code;
                      if (lvName.includes("พักร้อน") || lvCode === "AL") {
                        cls = "cell-vacation";
                        text = `พร (ใบลา✓)`;
                      } else if (lvName.includes("ป่วย") || lvCode === "SL") {
                        cls = "cell-sick";
                        text = `ป่วย (ใบลา✓)`;
                      } else {
                        cls = "cell-leave";
                        text = `${lvCode} (ใบลา✓)`;
                      }
                    } else if (isHol) {
                      cls = "hol-cell";
                      text = "★";
                    } else if (isOff) {
                      cls = "day-off";
                      text = "–";
                    }
                    return (
                      <td key={ds} className={cls}>
                        {text && <span className="note-text">{text}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Headcount row */}
            <tr className="headcount-row">
              <td colSpan={4} style={{ textAlign: "left" }}>กำลังคนในการปฏิบัติงาน (คน)</td>
              {weekDates.map((ds) => (
                <td key={ds}>{headcount(ds)}</td>
              ))}
            </tr>
          </tbody>
        </table>

        <div className="footer-note">
          <p>- หากมีการลาเพิ่มเติมจากตารางข้างต้น ให้แจ้งหัวหน้าให้ทราบด้วย</p>
          <p>- การลา ให้ลาล่วงหน้า 3 วัน</p>
          <p>- หากมีเหตุสุดวิสัยจริงๆ แจ้งหัวหน้าโดยตรงทันที</p>
        </div>
      </div>
    </>
  );
}
