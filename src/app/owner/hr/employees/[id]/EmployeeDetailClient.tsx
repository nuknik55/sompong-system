"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertEmployee } from "../../actions";
import type {
  Employee,
  Department,
  LeaveRequest,
  EmployeePayrollHistoryRow,
  LeaveQuotaRow,
  CompDayBalance,
  DaySwapRequest,
  AttendanceYearSummary,
} from "../../actions";

function fmtMoney(n: number) {
  if (!n) return "–";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const DAYS_TH = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
const STATUS_LABEL: Record<string, string> = { pending: "รอ", approved: "อนุมัติ", rejected: "ปฏิเสธ" };
const STATUS_COLOR: Record<string, string> = {
  pending: "text-amber-700 bg-amber-50",
  approved: "text-green-700 bg-green-50",
  rejected: "text-red-700 bg-red-50",
};

function thDate(d: string | null) {
  if (!d) return "–";
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${(y ?? 2500) + 543}`;
}

function yearsOfServiceText(hireDateStr: string | null): string {
  if (!hireDateStr) return "";
  const hire = new Date(hireDateStr + "T00:00:00");
  const now = new Date();
  let y = now.getFullYear() - hire.getFullYear();
  const ann = new Date(now.getFullYear(), hire.getMonth(), hire.getDate());
  if (now < ann) y--;
  if (y < 0) return "ยังไม่ครบ 1 ปี";
  const m = Math.floor(
    ((now.getTime() - new Date(now.getFullYear(), hire.getMonth(), hire.getDate()).getTime()) / (1000 * 60 * 60 * 24 * 30)) % 12
  );
  return `${y} ปี ${m > 0 ? `${m} เดือน` : ""}`.trim();
}

function calcYears(hireDateStr: string | null): number {
  if (!hireDateStr) return 0;
  const hire = new Date(hireDateStr + "T00:00:00");
  const now = new Date();
  let y = now.getFullYear() - hire.getFullYear();
  if (now < new Date(now.getFullYear(), hire.getMonth(), hire.getDate())) y--;
  return Math.max(0, y);
}

function alAutoQuota(years: number): number {
  if (years < 1) return 0;
  if (years < 3) return 4;
  if (years < 6) return 6;
  if (years < 10) return 8;
  return 10;
}

type TabKey = "summary" | "info" | "leave" | "payroll";

export function EmployeeDetailClient({
  employee,
  departments,
  leaveRequests,
  payrollHistory,
  quota,
  compBalance,
  daySwaps,
  attendanceSummary,
  defaultYear,
  initialTab,
}: {
  employee: Employee;
  departments: Department[];
  leaveRequests: LeaveRequest[];
  payrollHistory: EmployeePayrollHistoryRow[];
  quota: LeaveQuotaRow | null;
  compBalance: CompDayBalance | null;
  daySwaps: DaySwapRequest[];
  attendanceSummary: AttendanceYearSummary;
  defaultYear: number;
  initialTab: TabKey;
}) {
  const router = useRouter();
  const [tab, setTabState] = useState<TabKey>(initialTab);
  const [form, setForm] = useState({ ...employee, al_quota_override: employee.al_quota_override ?? null, probation_end_date: employee.probation_end_date ?? null });
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const year = defaultYear;

  function setTab(t: TabKey) {
    setTabState(t);
    router.replace(`/owner/hr/employees/${employee.id}?year=${year}&tab=${t}`, { scroll: false });
  }

  function setYear(y: number) {
    router.push(`/owner/hr/employees/${employee.id}?year=${y}&tab=${tab}`);
  }

  function handleSave() {
    startTransition(async () => {
      await upsertEmployee({
        id: employee.id,
        employee_code: form.employee_code ?? "",
        full_name: form.full_name,
        nickname: form.nickname ?? "",
        phone: form.phone ?? "",
        department_id: form.department_id,
        position: form.position ?? "",
        employment_type: form.employment_type,
        base_salary: form.base_salary,
        position_allowance: form.position_allowance,
        social_security_monthly: form.social_security_monthly,
        hire_date: form.hire_date ?? "",
        weekly_day_off: form.weekly_day_off ?? "",
        citizenship_type: form.citizenship_type,
        is_active: form.is_active,
        al_quota_override: form.al_quota_override,
        probation_end_date: form.employment_type === "probation" ? form.probation_end_date : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  }

  // Leave summary by type (all years, approved only)
  const leaveSummaryAll = new Map<string, { name: string; days: number }>();
  for (const r of leaveRequests.filter((l) => l.status === "approved")) {
    const cur = leaveSummaryAll.get(r.leave_type_code) ?? { name: r.leave_type_name, days: 0 };
    leaveSummaryAll.set(r.leave_type_code, { ...cur, days: cur.days + r.total_days });
  }

  // Leave filtered by selected year
  const leaveThisYear = leaveRequests.filter((r) => r.date_from?.startsWith(String(year)));

  // Day swap status labels
  function swapStatusLabel(d: DaySwapRequest) {
    if (d.swap_type === "work_first" && d.compensation === "extra_pay") return "จ่ายเพิ่ม";
    if (d.swap_type === "work_first" && d.compensation === "bank_day") {
      if (d.off_date) return "ใช้ไปแล้ว";
      return "วันหยุดค้าง";
    }
    if (d.swap_type === "off_first") {
      if (d.work_date) return "ทดแทนแล้ว";
      return "รอมาทดแทน";
    }
    return "–";
  }

  const availableCompDays = (compBalance?.earned ?? 0) - (compBalance?.used ?? 0);

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-kanit text-2xl font-semibold text-neutral-900">
            {employee.full_name}
            {employee.nickname && <span className="ml-2 text-lg text-neutral-400">({employee.nickname})</span>}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            {employee.employee_code && <span className="mr-3 font-mono">{employee.employee_code}</span>}
            {employee.position ?? ""}
            {employee.department_name && <span className="ml-2 text-neutral-400">· {employee.department_name}</span>}
            {employee.hire_date && (
              <span className="ml-2 text-neutral-400">· บรรจุ {thDate(employee.hire_date)} ({yearsOfServiceText(employee.hire_date)})</span>
            )}
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${employee.is_active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
          {employee.is_active ? "ทำงานอยู่" : "ลาออกแล้ว"}
        </span>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-neutral-200">
        {(["summary", "info", "leave", "payroll"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}
          >
            {t === "summary" ? "สรุปรายปี" : t === "info" ? "ข้อมูล" : t === "leave" ? "ประวัติลา" : "ประวัติเงินเดือน"}
          </button>
        ))}
      </div>

      {/* ─── Tab: สรุปรายปี ─── */}
      {tab === "summary" && (
        <div className="space-y-5">
          {/* Year nav */}
          <div className="flex items-center gap-2">
            <button onClick={() => setYear(year - 1)} className="rounded border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50">‹</button>
            <span className="min-w-[4rem] text-center text-sm font-medium">{year + 543}</span>
            <button onClick={() => setYear(year + 1)} className="rounded border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50">›</button>
          </div>

          {/* Comp day balance */}
          {compBalance && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">วันหยุดชดเชย</h3>
              <div className="flex flex-wrap gap-3">
                <StatChip label="วันสะสม (ได้รับ)" value={compBalance.earned} color="teal" />
                <StatChip label="ใช้ไปแล้ว" value={compBalance.used} color="neutral" />
                <StatChip label="คงเหลือ" value={availableCompDays} color={availableCompDays > 0 ? "green" : "neutral"} />
                {compBalance.pending_makeup > 0 && (
                  <StatChip label="รอมาทดแทน" value={compBalance.pending_makeup} color="red" />
                )}
              </div>
            </section>
          )}

          {/* Attendance stats */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">สถิติการเข้างาน {year + 543}</h3>
            <div className="flex flex-wrap gap-3">
              <StatChip label="ขาดงาน" value={attendanceSummary.absentDays} unit="วัน" color={attendanceSummary.absentDays > 0 ? "red" : "neutral"} />
              <StatChip label="มาสาย" value={attendanceSummary.lateDays} unit="วัน" color={attendanceSummary.lateDays > 0 ? "amber" : "neutral"} />
              <StatChip label="รวมนาทีสาย" value={attendanceSummary.lateMinutesTotal} unit="น." color="neutral" />
              <StatChip label="OT" value={attendanceSummary.otDays} unit="วัน" color="blue" />
            </div>
          </section>

          {/* Leave quota */}
          {quota && quota.usage.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">โควต้าการลา {year + 543}</h3>
              <div className="space-y-2 max-w-md">
                {quota.usage.map((u) => {
                  const isAL = u.h1_quota !== undefined;
                  if (isAL) {
                    // AL: show H1 + H2 split
                    const halves = [
                      { label: "ครึ่งปีแรก (ม.ค.–มิ.ย.)", quota: u.h1_quota ?? 0, used: u.h1_used ?? 0 },
                      { label: "ครึ่งปีหลัง (ก.ค.–ธ.ค.)", quota: u.h2_quota ?? 0, used: u.h2_used ?? 0 },
                    ];
                    return (
                      <div key={u.leave_type_id} className="rounded-lg border border-neutral-200 bg-white p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-600">{u.leave_type_code}</span>
                          <span className="text-sm font-medium text-neutral-800">{u.leave_type_name}</span>
                        </div>
                        <div className="space-y-2">
                          {halves.map(({ label, quota: q, used }) => {
                            const pct = q > 0 ? Math.min(100, Math.round((used / q) * 100)) : 0;
                            const remaining = q - used;
                            const barColor = pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-orange-400" : pct >= 50 ? "bg-amber-400" : "bg-green-500";
                            return (
                              <div key={label}>
                                <div className="mb-1 flex items-center justify-between">
                                  <span className="text-xs text-neutral-500">{label}</span>
                                  <span className="text-xs text-neutral-500">
                                    {used} / {q} วัน
                                    {remaining > 0 && <span className="ml-1 text-green-600">(เหลือ {remaining})</span>}
                                    {remaining <= 0 && q > 0 && <span className="ml-1 text-red-500">(หมดสิทธิ์)</span>}
                                  </span>
                                </div>
                                <div className="h-2 rounded-full bg-neutral-100">
                                  <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  // Other leave types: original display
                  const pct = u.annual_quota > 0 ? Math.min(100, Math.round((u.used_days / u.annual_quota) * 100)) : 0;
                  const remaining = u.annual_quota - u.used_days;
                  const barColor = pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-orange-400" : pct >= 50 ? "bg-amber-400" : "bg-green-500";
                  return (
                    <div key={u.leave_type_id} className="rounded-lg border border-neutral-200 bg-white p-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-600">{u.leave_type_code}</span>
                          <span className="text-sm font-medium text-neutral-800">{u.leave_type_name}</span>
                        </div>
                        <span className="text-xs text-neutral-500">
                          {u.used_days} / {u.annual_quota} วัน
                          {remaining > 0 && <span className="ml-1 text-green-600">(เหลือ {remaining})</span>}
                          {remaining <= 0 && <span className="ml-1 text-red-500">(หมดสิทธิ์)</span>}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-neutral-100">
                        <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Leave this year */}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">การลา {year + 543}</h3>
            {leaveThisYear.length === 0 ? (
              <p className="text-sm text-neutral-400">ยังไม่มีประวัติการลาในปีนี้</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
                      <th className="px-3 py-2">วันที่ลา</th>
                      <th className="px-3 py-2">ประเภท</th>
                      <th className="px-3 py-2 text-right">วัน</th>
                      <th className="px-3 py-2">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaveThisYear.map((r, i) => (
                      <tr key={r.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                        <td className="px-3 py-2 text-neutral-700">{thDate(r.date_from)} – {thDate(r.date_to)}</td>
                        <td className="px-3 py-2">
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">{r.leave_type_code}</span>
                          <span className="ml-1 text-xs text-neutral-500">{r.leave_type_name}</span>
                        </td>
                        <td className="px-3 py-2 text-right">{r.total_days}</td>
                        <td className="px-3 py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? ""}`}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Day swap this year */}
          {daySwaps.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">เปลี่ยนวันหยุด {year + 543}</h3>
              <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
                      <th className="px-3 py-2">วันทำงาน</th>
                      <th className="px-3 py-2">วันหยุดชดเชย</th>
                      <th className="px-3 py-2">สถานะ</th>
                      <th className="px-3 py-2">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daySwaps.map((d, i) => (
                      <tr key={d.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                        <td className="px-3 py-2">{thDate(d.work_date)}</td>
                        <td className="px-3 py-2">{thDate(d.off_date)}</td>
                        <td className="px-3 py-2">
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{swapStatusLabel(d)}</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-neutral-400">{d.note ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* ─── Tab: ข้อมูล ─── */}
      {tab === "info" && (
        <div className="max-w-2xl space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="รหัสพนักงาน">
              <input className="input-base" value={form.employee_code ?? ""} onChange={(e) => setForm((f) => ({ ...f, employee_code: e.target.value }))} />
            </Field>
            <Field label="แผนก">
              <select className="input-base" value={form.department_id ?? ""} onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value || null }))}>
                <option value="">– ไม่ระบุ –</option>
                {departments.filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="ชื่อ-สกุล *" className="col-span-2">
              <input className="input-base" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
            </Field>
            <Field label="ชื่อเล่น">
              <input className="input-base" value={form.nickname ?? ""} onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))} />
            </Field>
            <Field label="โทรศัพท์">
              <input className="input-base" value={form.phone ?? ""} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="ตำแหน่ง" className="col-span-2">
              <input className="input-base" value={form.position ?? ""} onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))} />
            </Field>
            <Field label="เงินเดือนฐาน">
              <input type="number" className="input-base" value={form.base_salary} onChange={(e) => setForm((f) => ({ ...f, base_salary: +e.target.value }))} />
            </Field>
            <Field label="ค่าตำแหน่ง">
              <input type="number" className="input-base" value={form.position_allowance} onChange={(e) => setForm((f) => ({ ...f, position_allowance: +e.target.value }))} />
            </Field>
            <Field label="ประกันสังคม (ต่อเดือน)">
              {(() => {
                const suggested = form.base_salary > 0 ? Math.min(Math.round(form.base_salary * 0.05), 875) : 0;
                const isDiff = form.social_security_monthly !== suggested && suggested > 0;
                return isDiff ? (
                  <p className="mb-1 flex items-center gap-1 text-xs text-amber-700">
                    แนะนำ: {suggested} บาท (5% ของ {form.base_salary.toLocaleString()}, เพดาน 875)
                    <button type="button" className="underline hover:text-amber-900" onClick={() => setForm((f) => ({ ...f, social_security_monthly: suggested }))}>ใช้ค่านี้</button>
                  </p>
                ) : null;
              })()}
              <input type="number" className="input-base" value={form.social_security_monthly} onFocus={(e) => e.target.select()} onChange={(e) => setForm((f) => ({ ...f, social_security_monthly: +e.target.value }))} />
            </Field>
            <Field label="วันบรรจุ">
              <input type="date" className="input-base" value={form.hire_date ?? ""} onChange={(e) => setForm((f) => ({ ...f, hire_date: e.target.value || null }))} />
            </Field>
            <Field label="วันหยุดประจำสัปดาห์">
              <select className="input-base" value={form.weekly_day_off ?? ""} onChange={(e) => setForm((f) => ({ ...f, weekly_day_off: e.target.value }))}>
                <option value="">– ไม่ระบุ –</option>
                {DAYS_TH.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="สัญชาติ">
              <select className="input-base" value={form.citizenship_type} onChange={(e) => setForm((f) => ({ ...f, citizenship_type: e.target.value as "thai" | "foreign" }))}>
                <option value="thai">ไทย</option>
                <option value="foreign">ต่างด้าว</option>
              </select>
            </Field>
            <Field label="ประเภทจ้าง">
              <select
                className="input-base"
                value={form.employment_type}
                onChange={(e) => setForm((f) => ({ ...f, employment_type: e.target.value as Employee["employment_type"], probation_end_date: e.target.value !== "probation" ? null : f.probation_end_date }))}
              >
                <option value="full_time">ประจำ</option>
                <option value="part_time_fixed">พาร์ทไทม์ประจำ</option>
                <option value="part_time_oncall">พาร์ทไทม์ตามเรียก</option>
                <option value="probation">ทดลองงาน</option>
              </select>
            </Field>
            {form.employment_type === "probation" && (
              <Field label="วันสิ้นสุดทดลองงาน">
                <input
                  type="date"
                  className="input-base"
                  value={form.probation_end_date ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, probation_end_date: e.target.value || null }))}
                />
              </Field>
            )}
            <Field label="สถานะ">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                ยังทำงานอยู่
              </label>
            </Field>
          </div>
          {/* AL quota */}
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">โควต้าพักร้อน (AL)</p>
            {(() => {
              const yrs = calcYears(form.hire_date);
              const auto = alAutoQuota(yrs);
              return (
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <p className="text-xs text-neutral-500">อัตโนมัติตามอายุงาน</p>
                    <p className="mt-0.5 text-sm font-medium text-neutral-700">
                      {yrs} ปี → <span className="text-blue-700 font-semibold">{auto} วัน</span>
                    </p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      1–2ปี=4วัน · 3–5ปี=6วัน · 6–9ปี=8วัน · 10ปีขึ้นไป=10วัน
                    </p>
                  </div>
                  <Field label="แก้ไขพิเศษ (เว้นว่าง = ใช้อัตโนมัติ)">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      placeholder={String(auto)}
                      className="input-base w-28"
                      value={form.al_quota_override ?? ""}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          al_quota_override: e.target.value === "" ? null : parseInt(e.target.value),
                        }))
                      }
                    />
                  </Field>
                  {form.al_quota_override !== null && (
                    <button
                      type="button"
                      className="mb-0.5 text-xs text-red-500 hover:text-red-700 underline"
                      onClick={() => setForm((f) => ({ ...f, al_quota_override: null }))}
                    >
                      รีเซ็ตเป็นอัตโนมัติ
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={isPending} className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
              {isPending ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
            </button>
            {saved && <span className="text-sm text-green-600">บันทึกแล้ว ✓</span>}
          </div>
        </div>
      )}

      {/* ─── Tab: ประวัติลา (ทั้งหมด) ─── */}
      {tab === "leave" && (
        <div className="space-y-4">
          {leaveSummaryAll.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...leaveSummaryAll.entries()].map(([code, { name, days }]) => (
                <span key={code} className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700">
                  {code} ({name}) — {days} วัน
                </span>
              ))}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
                  <th className="px-3 py-2">วันที่ลา</th>
                  <th className="px-3 py-2">ประเภท</th>
                  <th className="px-3 py-2 text-right">วัน</th>
                  <th className="px-3 py-2">เหตุผล</th>
                  <th className="px-3 py-2">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {leaveRequests.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-neutral-400">ยังไม่มีประวัติการลา</td></tr>
                )}
                {leaveRequests.map((r, i) => (
                  <tr key={r.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                    <td className="px-3 py-2 text-neutral-700">{thDate(r.date_from)} – {thDate(r.date_to)}</td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">{r.leave_type_code}</span>
                      <span className="ml-1 text-xs text-neutral-500">{r.leave_type_name}</span>
                    </td>
                    <td className="px-3 py-2 text-right">{r.total_days}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{r.reason ?? "–"}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? ""}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Tab: ประวัติเงินเดือน ─── */}
      {tab === "payroll" && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-800 text-neutral-100">
                <th className="px-3 py-2 text-left">งวด</th>
                <th className="px-2 py-2 text-right">เงินเดือน</th>
                <th className="px-2 py-2 text-right">ค่าตำแหน่ง</th>
                <th className="px-2 py-2 text-right">พิเศษ</th>
                <th className="px-2 py-2 text-right">นักขัตฤกษ์</th>
                <th className="px-2 py-2 text-right">OT</th>
                <th className="px-2 py-2 text-right text-red-200">ประกัน</th>
                <th className="px-2 py-2 text-right text-red-200">ขาด/ลา/สาย</th>
                <th className="px-2 py-2 text-right text-red-200">ยืม</th>
                <th className="px-2 py-2 text-right text-red-200">ปรับ</th>
                <th className="px-2 py-2 text-right">อื่นๆ</th>
                <th className="px-2 py-2 text-right">ข้าวพนง</th>
                <th className="px-2 py-2 text-right">ทิป</th>
                <th className="px-2 py-2 text-right font-semibold">รวม</th>
                <th className="px-2 py-2 text-right font-semibold text-yellow-200">สุทธิ</th>
              </tr>
            </thead>
            <tbody>
              {payrollHistory.length === 0 && (
                <tr><td colSpan={15} className="py-6 text-center text-neutral-400">ยังไม่มีประวัติเงินเดือน</td></tr>
              )}
              {payrollHistory.map((r, i) => (
                <tr key={r.period_id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                  <td className="px-3 py-2 text-neutral-700">
                    <a href={`/owner/hr/payroll?period=${r.period_id}`} className="hover:underline">
                      {MONTHS_TH[(r.period_month - 1) % 12]} {r.period_year + 543}
                      <span className="ml-1 text-neutral-400">{r.period_half === "first" ? "(ครึ่งแรก)" : "(ครึ่งหลัง)"}</span>
                    </a>
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-700">{fmtMoney(r.base_salary)}</td>
                  <td className="px-2 py-2 text-right text-neutral-700">{fmtMoney(r.position_allowance)}</td>
                  <td className="px-2 py-2 text-right text-neutral-700">{fmtMoney(r.special_bonus)}</td>
                  <td className="px-2 py-2 text-right text-neutral-700">{fmtMoney(r.holiday_pay)}</td>
                  <td className="px-2 py-2 text-right text-neutral-700">{fmtMoney(r.ot_pay)}</td>
                  <td className="px-2 py-2 text-right text-red-600">{fmtMoney(r.social_security_deduction)}</td>
                  <td className="px-2 py-2 text-right text-red-600">{fmtMoney(r.leave_deduction)}</td>
                  <td className="px-2 py-2 text-right text-red-600">{fmtMoney(r.advance_deduction)}</td>
                  <td className="px-2 py-2 text-right text-red-600">{fmtMoney(r.adjustment)}</td>
                  <td className="px-2 py-2 text-right text-neutral-700">{fmtMoney(r.other_amount)}</td>
                  <td className="px-2 py-2 text-right text-neutral-700">{fmtMoney(r.meal_allowance)}</td>
                  <td className="px-2 py-2 text-right text-neutral-700">{fmtMoney(r.tip_amount)}</td>
                  <td className="px-2 py-2 text-right font-medium text-neutral-700">{fmtMoney(r.gross_total)}</td>
                  <td className="px-2 py-2 text-right font-bold text-neutral-900">{fmtMoney(r.net_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .input-base { width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; font-size: 0.875rem; outline: none; background: white; }
        .input-base:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
      `}</style>
    </div>
  );
}

function StatChip({
  label,
  value,
  unit = "วัน",
  color,
}: {
  label: string;
  value: number;
  unit?: string;
  color: "teal" | "green" | "amber" | "red" | "blue" | "neutral";
}) {
  const colorMap: Record<string, string> = {
    teal: "bg-teal-50 text-teal-700 border-teal-200",
    green: "bg-green-50 text-green-700 border-green-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-red-50 text-red-700 border-red-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    neutral: "bg-neutral-50 text-neutral-700 border-neutral-200",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${colorMap[color]}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
      <div className="text-xs opacity-60">{unit}</div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      {children}
    </div>
  );
}
