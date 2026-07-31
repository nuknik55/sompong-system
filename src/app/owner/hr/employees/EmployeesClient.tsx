"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { upsertEmployee } from "../actions";
import type { Employee, Department, CompDayBalance, ProbationAlert } from "../actions";

const DAYS_TH = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
const EMP_TYPES: Record<string, string> = {
  full_time: "ประจำ",
  part_time_fixed: "พาร์ทไทม์ประจำ",
  part_time_oncall: "พาร์ทไทม์ตามเรียก",
  probation: "ทดลองงาน",
};

const DEPT_COLORS: string[] = [
  "bg-blue-50 text-blue-800 border-blue-200",
  "bg-green-50 text-green-800 border-green-200",
  "bg-orange-50 text-orange-800 border-orange-200",
  "bg-purple-50 text-purple-800 border-purple-200",
  "bg-rose-50 text-rose-800 border-rose-200",
  "bg-teal-50 text-teal-800 border-teal-200",
];

function thDate(d: string | null) {
  if (!d) return "–";
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${(y ?? 2500) + 543}`;
}

const BLANK_EMP: Omit<Employee, "id" | "department_name"> = {
  employee_code: "",
  full_name: "",
  nickname: "",
  phone: "",
  department_id: null,
  position: "",
  employment_type: "full_time",
  base_salary: 0,
  position_allowance: 0,
  social_security_monthly: 0,
  hire_date: null,
  weekly_day_off: "จันทร์",
  citizenship_type: "thai",
  is_active: true,
  sort_order: 999,
  al_quota_override: null,
  probation_end_date: null,
};

export function EmployeesClient({
  initialEmployees,
  departments,
  balances,
  probationAlerts,
  isOwner,
}: {
  initialEmployees: Employee[];
  departments: Department[];
  balances: CompDayBalance[];
  probationAlerts: ProbationAlert[];
  isOwner: boolean;
}) {
  const [employees, setEmployees] = useState(initialEmployees);
  const balanceMap = new Map(balances.map((b) => [b.employee_id, b]));
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Omit<Employee, "id" | "department_name">>(BLANK_EMP);
  const [filterActive, setFilterActive] = useState(true);
  const [isPending, startTransition] = useTransition();

  const deptColorMap = new Map(departments.map((d, i) => [d.id, DEPT_COLORS[i % DEPT_COLORS.length]!]));

  function openAdd() {
    setEditing(null);
    setForm(BLANK_EMP);
    setShowModal(true);
  }

  function openEdit(emp: Employee) {
    setEditing(emp);
    setForm({
      employee_code: emp.employee_code ?? "",
      full_name: emp.full_name,
      nickname: emp.nickname ?? "",
      phone: emp.phone ?? "",
      department_id: emp.department_id,
      position: emp.position ?? "",
      employment_type: emp.employment_type,
      base_salary: emp.base_salary,
      position_allowance: emp.position_allowance,
      social_security_monthly: emp.social_security_monthly,
      hire_date: emp.hire_date,
      weekly_day_off: emp.weekly_day_off ?? "จันทร์",
      citizenship_type: emp.citizenship_type,
      is_active: emp.is_active,
      sort_order: emp.sort_order,
      al_quota_override: emp.al_quota_override ?? null,
      probation_end_date: emp.probation_end_date ?? null,
    });
    setShowModal(true);
  }

  function handleSave() {
    startTransition(async () => {
      await upsertEmployee({
        ...(editing ? { id: editing.id } : {}),
        ...form,
        probation_end_date: form.employment_type === "probation" ? (form.probation_end_date ?? null) : null,
      } as Parameters<typeof upsertEmployee>[0]);
      setShowModal(false);
      // optimistic update
      const dept = departments.find((d) => d.id === form.department_id);
      const updated: Employee = {
        id: editing?.id ?? crypto.randomUUID(),
        ...form,
        department_name: dept?.name ?? null,
      };
      if (editing) {
        setEmployees((prev) => prev.map((e) => (e.id === editing.id ? updated : e)));
      } else {
        setEmployees((prev) => [...prev, updated]);
      }
    });
  }

  const visible = employees.filter((e) => filterActive ? e.is_active : !e.is_active);

  // Group by department
  const groups = new Map<string, { label: string; color: string; emps: Employee[] }>();
  groups.set("__none__", { label: "ไม่ระบุแผนก", color: "bg-neutral-50 text-neutral-700 border-neutral-200", emps: [] });
  for (const dept of departments.filter((d) => d.is_active)) {
    groups.set(dept.id, { label: dept.name, color: deptColorMap.get(dept.id) ?? DEPT_COLORS[0]!, emps: [] });
  }
  for (const emp of visible) {
    const key = emp.department_id ?? "__none__";
    if (!groups.has(key)) groups.set(key, { label: "แผนกอื่น", color: DEPT_COLORS[0]!, emps: [] });
    groups.get(key)!.emps.push(emp);
  }

  return (
    <>
      {/* Probation alerts */}
      {probationAlerts.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-800">พนักงานทดลองงานใกล้ครบกำหนด</p>
          <div className="flex flex-wrap gap-2">
            {probationAlerts.map((a) => (
              <Link
                key={a.id}
                href={`/owner/hr/employees/${a.id}?tab=info`}
                className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-white px-3 py-1.5 text-xs hover:bg-amber-50"
              >
                <span className="font-medium text-neutral-800">{a.full_name}</span>
                {a.nickname && <span className="text-neutral-400">({a.nickname})</span>}
                <span className={`ml-1 font-semibold ${a.days_remaining < 0 ? "text-red-600" : a.days_remaining <= 7 ? "text-orange-600" : "text-amber-700"}`}>
                  {a.days_remaining < 0 ? `เกินกำหนด ${Math.abs(a.days_remaining)} วัน` : a.days_remaining === 0 ? "ครบวันนี้" : `อีก ${a.days_remaining} วัน`}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setFilterActive(true)}
            className={`rounded-full px-3 py-1 transition-colors ${filterActive ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
          >
            ทำงานอยู่ ({employees.filter((e) => e.is_active).length})
          </button>
          <button
            onClick={() => setFilterActive(false)}
            className={`rounded-full px-3 py-1 transition-colors ${!filterActive ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
          >
            ลาออก ({employees.filter((e) => !e.is_active).length})
          </button>
        </div>
        <button
          onClick={openAdd}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + เพิ่มพนักงาน
        </button>
      </div>

      {/* Table per department */}
      <div className="space-y-6">
        {[...groups.entries()].map(([key, group]) => {
          if (group.emps.length === 0) return null;
          return (
            <div key={key}>
              <div className={`mb-1 inline-flex items-center rounded-md border px-3 py-1 text-xs font-semibold ${group.color}`}>
                {group.label} ({group.emps.length})
              </div>
              <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
                      <th className="px-3 py-2">รหัส</th>
                      <th className="px-3 py-2">ชื่อ (ชื่อเล่น)</th>
                      <th className="px-3 py-2">ตำแหน่ง</th>
                      <th className="px-3 py-2">วันหยุดประจำ</th>
                      <th className="px-3 py-2">วันบรรจุ</th>
                      <th className="px-3 py-2">ประเภท</th>
                      <th className="px-3 py-2 text-center">วันหยุดค้าง</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.emps.map((emp, i) => (
                      <tr
                        key={emp.id}
                        className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-neutral-500">{emp.employee_code ?? "–"}</td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/owner/hr/employees/${emp.id}`}
                            className="font-medium text-neutral-900 hover:text-blue-600 hover:underline"
                          >
                            {emp.full_name}
                          </Link>
                          {emp.nickname && (
                            <span className="ml-1 text-xs text-neutral-400">({emp.nickname})</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-neutral-700">{emp.position ?? "–"}</td>
                        <td className="px-3 py-2 text-neutral-600">{emp.weekly_day_off ?? "–"}</td>
                        <td className="px-3 py-2 text-neutral-500">{thDate(emp.hire_date)}</td>
                        <td className="px-3 py-2 text-xs">
                          <span className={emp.employment_type === "probation" ? "font-semibold text-amber-700" : "text-neutral-500"}>
                            {EMP_TYPES[emp.employment_type] ?? emp.employment_type}
                          </span>
                          {emp.employment_type === "probation" && emp.probation_end_date && (
                            <span className="ml-1 text-neutral-400">({thDate(emp.probation_end_date)})</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {(() => {
                            const b = balanceMap.get(emp.id);
                            if (!b) return <span className="text-xs text-neutral-300">–</span>;
                            const avail = b.earned - b.used;
                            return (
                              <div className="flex flex-col items-center gap-0.5">
                                {avail > 0 && (
                                  <span className="rounded bg-teal-100 px-1.5 py-0.5 text-xs font-semibold text-teal-700">ค้าง {avail} วัน</span>
                                )}
                                {b.pending_makeup > 0 && (
                                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-600">ต้องทดแทน {b.pending_makeup} วัน</span>
                                )}
                                {avail === 0 && b.pending_makeup === 0 && (
                                  <span className="text-xs text-neutral-300">–</span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => openEdit(emp)}
                            className="text-xs text-neutral-400 hover:text-neutral-700"
                          >
                            แก้ไข
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-400">ไม่มีพนักงาน</p>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold text-neutral-900">
                {editing ? "แก้ไขพนักงาน" : "เพิ่มพนักงานใหม่"}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="รหัสพนักงาน">
                  <input
                    className="input-base"
                    value={form.employee_code ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, employee_code: e.target.value }))}
                    placeholder="SP-SV 01"
                  />
                </Field>
                <Field label="แผนก">
                  <select
                    className="input-base"
                    value={form.department_id ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, department_id: e.target.value || null }))}
                  >
                    <option value="">– ไม่ระบุ –</option>
                    {departments.filter((d) => d.is_active).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label="ชื่อ-สกุล *" className="col-span-2">
                  <input
                    className="input-base"
                    value={form.full_name}
                    onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                    placeholder="อิทธิศักดิ์ กันทะมา"
                  />
                </Field>

                <Field label="ชื่อเล่น">
                  <input
                    className="input-base"
                    value={form.nickname ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
                    placeholder="ต้อม"
                  />
                </Field>
                <Field label="โทรศัพท์">
                  <input
                    className="input-base"
                    value={form.phone ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="097-216-8817"
                  />
                </Field>

                <Field label="ตำแหน่ง" className="col-span-2">
                  <input
                    className="input-base"
                    value={form.position ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
                    placeholder="กัปตัน บริการ"
                  />
                </Field>

                <Field label="ประเภทจ้าง">
                  <select
                    className="input-base"
                    value={form.employment_type}
                    onChange={(e) => setForm((f) => ({ ...f, employment_type: e.target.value as Employee["employment_type"], probation_end_date: e.target.value !== "probation" ? null : f.probation_end_date }))}
                  >
                    {Object.entries(EMP_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
                <Field label="สัญชาติ">
                  <select
                    className="input-base"
                    value={form.citizenship_type}
                    onChange={(e) => setForm((f) => ({ ...f, citizenship_type: e.target.value as "thai" | "foreign" }))}
                  >
                    <option value="thai">ไทย</option>
                    <option value="foreign">ต่างด้าว</option>
                  </select>
                </Field>

                <Field label="เงินเดือน (บาท)">
                  <input
                    type="number"
                    className="input-base"
                    value={form.base_salary}
                    onChange={(e) => setForm((f) => ({ ...f, base_salary: +e.target.value }))}
                  />
                </Field>
                <Field label="ค่าตำแหน่ง (บาท)">
                  <input
                    type="number"
                    className="input-base"
                    value={form.position_allowance}
                    onChange={(e) => setForm((f) => ({ ...f, position_allowance: +e.target.value }))}
                  />
                </Field>
                <Field label="ประกันสังคม (ต่อเดือน)">
                  <input
                    type="number"
                    className="input-base"
                    value={form.social_security_monthly}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setForm((f) => ({ ...f, social_security_monthly: +e.target.value }))}
                  />
                </Field>

                <Field label="วันบรรจุ">
                  <input
                    type="date"
                    className="input-base"
                    value={form.hire_date ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, hire_date: e.target.value || null }))}
                  />
                </Field>
                <Field label="วันหยุดประจำสัปดาห์">
                  <select
                    className="input-base"
                    value={form.weekly_day_off ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, weekly_day_off: e.target.value }))}
                  >
                    <option value="">– ไม่ระบุ –</option>
                    {DAYS_TH.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>

                <Field label="สถานะ" className="col-span-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                      className="rounded"
                    />
                    ยังทำงานอยู่ (ยกเลิกเครื่องหมายถ้าลาออกแล้ว)
                  </label>
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSave}
                disabled={!form.full_name.trim() || isPending}
                className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {isPending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .input-base {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 0.875rem;
          outline: none;
          background: white;
        }
        .input-base:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
      `}</style>
    </>
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
