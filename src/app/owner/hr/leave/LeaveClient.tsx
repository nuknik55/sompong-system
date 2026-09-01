"use client";

import { useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { upsertLeaveRequest, deleteLeaveRequest } from "../actions";
import type { LeaveRequest, Employee, LeaveType, LeaveQuotaRow } from "../actions";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const STATUS_LABEL: Record<string, string> = { all: "ทั้งหมด", approved: "อนุมัติ" };
const STATUS_COLOR: Record<string, string> = {
  pending: "text-amber-700 bg-amber-50 border-amber-200",
  approved: "text-green-700 bg-green-50 border-green-200",
  rejected: "text-red-700 bg-red-50 border-red-200",
};

function thDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${(y ?? 2500) + 543}`;
}

function calcDays(from: string, to: string) {
  if (!from || !to) return 0;
  const d1 = new Date(from);
  const d2 = new Date(to);
  return Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1;
}

const BLANK = {
  employee_id: "",
  leave_type_id: "",
  date_from: "",
  date_to: "",
  reason: "",
};

export function LeaveClient({
  initialRequests,
  employees,
  leaveTypes,
  quotas,
  defaultYear,
  defaultMonth,
  defaultStatus,
}: {
  initialRequests: LeaveRequest[];
  employees: Employee[];
  leaveTypes: LeaveType[];
  quotas: LeaveQuotaRow[];
  defaultYear: number;
  defaultMonth?: number;
  defaultStatus: string;
}) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showQuota, setShowQuota] = useState(false);

  // columns = leave types that have a quota and appear in at least one employee's usage
  const quotaCols = quotas[0]?.usage ?? [];

  const year = defaultYear;
  const monthFilter = defaultMonth;
  const statusFilter = defaultStatus;

  function handleSave() {
    if (!form.employee_id || !form.leave_type_id || !form.date_from || !form.date_to) return;
    if (form.date_to < form.date_from) return;
    const total_days = calcDays(form.date_from, form.date_to);
    startTransition(async () => {
      setError(null);
      try {
        await upsertLeaveRequest({ ...form, total_days });
        const emp = employees.find((e) => e.id === form.employee_id);
        const lt = leaveTypes.find((l) => l.id === form.leave_type_id);
        const newReq: LeaveRequest = {
          id: crypto.randomUUID(),
          employee_id: form.employee_id,
          employee_name: emp?.full_name ?? "",
          employee_nickname: emp?.nickname ?? null,
          leave_type_id: form.leave_type_id,
          leave_type_code: lt?.code ?? "",
          leave_type_name: lt?.name_th ?? "",
          date_from: form.date_from,
          date_to: form.date_to,
          total_days,
          reason: form.reason || null,
          status: "approved",
          submitted_at: new Date().toISOString(),
        };
        setRequests((prev) => [newReq, ...prev]);
        setForm(BLANK);
        setShowForm(false);
      } catch (err) {
        // requireHR() redirects, and Next signals a redirect by throwing —
        // unstable_rethrow lets that through instead of showing it as an error.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "บันทึกการลาไม่สำเร็จ");
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      setError(null);
      try {
        await deleteLeaveRequest(id);
        setRequests((prev) => prev.filter((r) => r.id !== id));
        setConfirmDelete(null);
      } catch (err) {
        // requireHR() redirects, and Next signals a redirect by throwing —
        // unstable_rethrow lets that through instead of showing it as an error.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "บันทึกการลาไม่สำเร็จ");
      }
    });
  }

  const visible = requests.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    const fromDate = new Date(r.date_from);
    if (fromDate.getFullYear() !== year) return false;
    if (monthFilter && fromDate.getMonth() + 1 !== monthFilter) return false;
    return true;
  });

  function navigate(params: Record<string, string>) {
    const sp = new URLSearchParams({
      year: String(year),
      ...(monthFilter ? { month: String(monthFilter) } : {}),
      status: statusFilter,
      ...params,
    });
    router.push(`/owner/hr/leave?${sp.toString()}`);
  }

  return (
    <>
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* Year */}
          <div className="flex items-center gap-1">
            <button onClick={() => navigate({ year: String(year - 1) })} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">◀</button>
            <span className="font-medium">{year + 543}</span>
            <button onClick={() => navigate({ year: String(year + 1) })} className="rounded px-2 py-1 text-neutral-500 hover:bg-neutral-100">▶</button>
          </div>
          {/* Month */}
          <select
            className="rounded border border-neutral-200 px-2 py-1 text-sm"
            value={monthFilter ?? ""}
            onChange={(e) => {
              const val = e.target.value;
              const params: Record<string, string> = {};
              if (val) params.month = val;
              navigate(params);
            }}
          >
            <option value="">ทุกเดือน</option>
            {MONTHS_TH.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {quotaCols.length > 0 && (
            <button
              onClick={() => setShowQuota((v) => !v)}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              {showQuota ? "ซ่อนสิทธิการลาประจำปี" : "แสดงสิทธิการลาประจำปี"}
            </button>
          )}
          <button onClick={() => setShowForm(true)} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
            + บันทึกใบลา
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="mb-4 overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
              <th className="px-3 py-2">พนักงาน</th>
              <th className="px-3 py-2">ประเภทลา</th>
              <th className="px-3 py-2">วันที่</th>
              <th className="px-3 py-2 text-center">จำนวน</th>
              <th className="px-3 py-2">เหตุผล</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-neutral-400">ไม่มีรายการ</td></tr>
            )}
            {visible.map((r, i) => (
              <tr key={r.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                <td className="px-3 py-2">
                  <span className="font-medium text-neutral-900">{r.employee_nickname ?? r.employee_name.split(" ")[0]}</span>
                  <span className="ml-1 text-xs text-neutral-400">{r.employee_name}</span>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">{r.leave_type_code}</span>
                  <span className="ml-1 text-xs text-neutral-500">{r.leave_type_name}</span>
                </td>
                <td className="px-3 py-2 text-neutral-700">
                  {thDate(r.date_from)}
                  {r.date_from !== r.date_to && <> – {thDate(r.date_to)}</>}
                </td>
                <td className="px-3 py-2 text-center font-medium">{r.total_days}</td>
                <td className="px-3 py-2 text-neutral-500">{r.reason ?? "–"}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[r.status] ?? ""}`}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <button onClick={() => setConfirmDelete(r.id)} className="text-xs text-neutral-400 hover:text-red-600">ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Quota section */}
      {quotaCols.length > 0 && showQuota && (
        <div className="mb-4 rounded-lg border border-neutral-200 bg-white">
          <div className="px-4 py-3 text-sm font-semibold text-neutral-700 border-b border-neutral-100">
            สิทธิ์การลาประจำปี {defaultYear + 543}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 text-left">
                  <th className="px-3 py-2 font-medium text-neutral-600 min-w-[100px]">พนักงาน</th>
                  {quotaCols.map((col) => (
                    <th key={col.leave_type_id} className="px-3 py-2 text-center font-medium text-neutral-600 min-w-[80px]">
                      <div>{col.leave_type_code}</div>
                      <div className="font-normal text-neutral-400 text-[10px]">{col.leave_type_name}</div>
                      {col.h1_quota !== undefined
                        ? <div className="font-normal text-neutral-400 text-[10px]">ครึ่งแรก / ครึ่งหลัง</div>
                        : <div className="font-normal text-neutral-400 text-[10px]">สิทธิ์ {col.annual_quota} วัน</div>
                      }
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quotas.map((row, ri) => (
                  <tr key={row.employee_id} className={`border-b border-neutral-50 last:border-0 ${ri % 2 === 0 ? "bg-white" : "bg-neutral-50/40"}`}>
                    <td className="px-3 py-2 font-medium text-neutral-800">
                      {row.employee_nickname ?? row.employee_name.split(" ")[0]}
                      <span className="ml-1 text-[10px] text-neutral-400">{row.employee_name}</span>
                    </td>
                    {row.usage.map((u) => {
                      const isAL = u.h1_quota !== undefined;
                      if (isAL) {
                        const halves = [
                          { q: u.h1_quota ?? 0, used: u.h1_used ?? 0 },
                          { q: u.h2_quota ?? 0, used: u.h2_used ?? 0 },
                        ];
                        return (
                          <td key={u.leave_type_id} className="px-3 py-1.5 text-center space-y-1">
                            {halves.map(({ q, used }, hi) => {
                              const pct = q > 0 ? used / q : 0;
                              const barCls = pct >= 1 ? "bg-red-500" : pct >= 0.8 ? "bg-orange-400" : pct >= 0.5 ? "bg-amber-400" : "bg-green-400";
                              const textCls = pct >= 1 ? "text-red-700 font-semibold" : "text-neutral-700";
                              return (
                                <div key={hi}>
                                  <div className={`text-xs ${textCls}`}>{used}/{q}</div>
                                  <div className="mt-0.5 h-1 w-full rounded-full bg-neutral-200">
                                    <div className={`h-1 rounded-full ${barCls} transition-all`} style={{ width: `${Math.min(pct * 100, 100)}%` }} />
                                  </div>
                                </div>
                              );
                            })}
                          </td>
                        );
                      }
                      const pct = u.annual_quota > 0 ? u.used_days / u.annual_quota : 0;
                      const barCls = pct >= 1 ? "bg-red-500" : pct >= 0.8 ? "bg-orange-400" : pct >= 0.5 ? "bg-amber-400" : "bg-green-400";
                      const textCls = pct >= 1 ? "text-red-700 font-semibold" : pct >= 0.8 ? "text-orange-700" : "text-neutral-700";
                      return (
                        <td key={u.leave_type_id} className="px-3 py-2 text-center">
                          <div className={`text-xs ${textCls}`}>
                            {u.used_days} / {u.annual_quota}
                          </div>
                          <div className="mt-0.5 h-1 w-full rounded-full bg-neutral-200">
                            <div
                              className={`h-1 rounded-full ${barCls} transition-all`}
                              style={{ width: `${Math.min(pct * 100, 100)}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-neutral-400">เหลือ {Math.max(u.annual_quota - u.used_days, 0)}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">บันทึกใบลา</h2>
              <button onClick={() => setShowForm(false)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <Field label="พนักงาน *">
                <select className="input-base" value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">– เลือกพนักงาน –</option>
                  {employees.map((e) => <option key={e.id} value={e.id}>{e.nickname ? `${e.nickname} (${e.full_name})` : e.full_name}</option>)}
                </select>
              </Field>
              <Field label="ประเภทลา *">
                <select className="input-base" value={form.leave_type_id} onChange={(e) => setForm((f) => ({ ...f, leave_type_id: e.target.value }))}>
                  <option value="">– เลือกประเภท –</option>
                  {leaveTypes.filter((lt) => lt.code !== "CDW" && lt.code !== "CDP").map((lt) => <option key={lt.id} value={lt.id}>{lt.code} — {lt.name_th}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="วันที่เริ่ม *">
                  <input type="date" className="input-base" value={form.date_from} onChange={(e) => setForm((f) => ({ ...f, date_from: e.target.value, date_to: f.date_to || e.target.value }))} />
                </Field>
                <Field label="วันที่สิ้นสุด *">
                  <input type="date" className="input-base" value={form.date_to} onChange={(e) => setForm((f) => ({ ...f, date_to: e.target.value }))} />
                </Field>
              </div>
              {form.date_from && form.date_to && (
                <p className="text-sm text-neutral-500">รวม {calcDays(form.date_from, form.date_to)} วัน</p>
              )}
              <Field label="เหตุผล">
                <textarea className="input-base h-16 resize-none" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="เหตุผลการลา..." />
              </Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">
              <button onClick={() => setShowForm(false)} className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">ยกเลิก</button>
              <button
                onClick={handleSave}
                disabled={!form.employee_id || !form.leave_type_id || !form.date_from || !form.date_to || isPending}
                className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {isPending ? "กำลังบันทึก…" : "บันทึก (อนุมัติอัตโนมัติ)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 font-kanit text-base font-semibold text-neutral-900">ลบรายการลา?</h3>
            <p className="mb-4 text-sm text-neutral-500">ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">ยกเลิก</button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={isPending} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                ลบถาวร
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .input-base { width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; font-size: 0.875rem; outline: none; background: white; }
        .input-base:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
      `}</style>
    </>
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
