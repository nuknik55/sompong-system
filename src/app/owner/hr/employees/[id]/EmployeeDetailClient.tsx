"use client";

import { useState, useTransition } from "react";
import { upsertEmployee } from "../../actions";
import type { Employee, Department, LeaveRequest, PayrollPeriod } from "../../actions";

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

function fmt(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function EmployeeDetailClient({
  employee,
  departments,
  leaveRequests,
  periods,
}: {
  employee: Employee;
  departments: Department[];
  leaveRequests: LeaveRequest[];
  periods: PayrollPeriod[];
}) {
  const [tab, setTab] = useState<"info" | "leave" | "payroll">("info");
  const [form, setForm] = useState({ ...employee });
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

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
        hire_date: form.hire_date ?? "",
        weekly_day_off: form.weekly_day_off ?? "",
        citizenship_type: form.citizenship_type,
        is_active: form.is_active,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  }

  // Leave summary by type code
  const leaveSummary = new Map<string, { name: string; days: number }>();
  for (const r of leaveRequests.filter((l) => l.status === "approved")) {
    const cur = leaveSummary.get(r.leave_type_code) ?? { name: r.leave_type_name, days: 0 };
    leaveSummary.set(r.leave_type_code, { ...cur, days: cur.days + r.total_days });
  }

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
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${employee.is_active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
          {employee.is_active ? "ทำงานอยู่" : "ลาออกแล้ว"}
        </span>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-neutral-200">
        {(["info", "leave", "payroll"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}
          >
            {t === "info" ? "ข้อมูล" : t === "leave" ? "ประวัติลา" : "ประวัติเงินเดือน"}
          </button>
        ))}
      </div>

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
                <option value="thai">ไทย (ลาสะสมสูงสุด 7 วัน)</option>
                <option value="foreign">ต่างด้าว (ลาสะสมสูงสุด 10 วัน)</option>
              </select>
            </Field>
            <Field label="สถานะ">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} className="rounded" />
                ยังทำงานอยู่
              </label>
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={isPending} className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
              {isPending ? "กำลังบันทึก…" : "บันทึกการเปลี่ยนแปลง"}
            </button>
            {saved && <span className="text-sm text-green-600">บันทึกแล้ว ✓</span>}
          </div>
        </div>
      )}

      {/* ─── Tab: ประวัติลา ─── */}
      {tab === "leave" && (
        <div className="space-y-4">
          {/* Summary chips */}
          {leaveSummary.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...leaveSummary.entries()].map(([code, { name, days }]) => (
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
                  <th className="px-3 py-2">จำนวน</th>
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
                    <td className="px-3 py-2 text-right">{r.total_days} วัน</td>
                    <td className="px-3 py-2 text-neutral-500">{r.reason ?? "–"}</td>
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
                <th className="px-3 py-2">งวด</th>
                <th className="px-3 py-2 text-right">เงินเดือน</th>
                <th className="px-3 py-2 text-right">นักขัตฤกษ์</th>
                <th className="px-3 py-2 text-right">OT</th>
                <th className="px-3 py-2 text-right">หัก</th>
                <th className="px-3 py-2 text-right font-semibold">สุทธิ</th>
              </tr>
            </thead>
            <tbody>
              {periods.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-neutral-400">ยังไม่มีรอบเงินเดือน</td></tr>
              )}
              {periods.map((p, i) => (
                <tr key={p.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                  <td className="px-3 py-2 text-neutral-700">
                    {MONTHS_TH[(p.period_month - 1) % 12]} {p.period_year + 543}
                    <span className="ml-1 text-xs text-neutral-400">{p.period_half === "first" ? "(ครึ่งแรก)" : "(ครึ่งหลัง)"}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-500" colSpan={5}>
                    <a href={`/owner/hr/payroll?period=${p.id}`} className="text-xs text-blue-500 hover:underline">ดูรายละเอียด →</a>
                  </td>
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

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      {children}
    </div>
  );
}
