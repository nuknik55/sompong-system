"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPayrollPeriod, closePayrollPeriod, upsertPayrollEntry } from "../actions";
import type { PayrollPeriod, PayrollEntry } from "../actions";

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function fmt(n: number) {
  if (n === 0) return "–";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function periodLabel(p: PayrollPeriod) {
  return `${MONTHS_TH[p.period_month - 1]} ${p.period_year + 543} ${p.period_half === "first" ? "(1)" : "(2)"}`;
}

function calcGross(e: PayrollEntry) {
  return e.base_salary + e.position_allowance + e.special_bonus + e.holiday_pay + e.ot_pay + e.other_amount + e.meal_allowance + e.tip_amount;
}
function calcNet(e: PayrollEntry) {
  return calcGross(e) - e.social_security_deduction - e.leave_deduction - e.advance_deduction - e.adjustment;
}

type EditCell = { employeeId: string; field: keyof PayrollEntry };

export function PayrollClient({
  periods,
  initialEntries,
  selectedPeriodId,
}: {
  periods: PayrollPeriod[];
  initialEntries: PayrollEntry[];
  selectedPeriodId: string | null;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [editCell, setEditCell] = useState<EditCell | null>(null);
  const [cellValue, setCellValue] = useState("");
  const [isPending, startTransition] = useTransition();

  // New period form
  const today = new Date();
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [newPeriod, setNewPeriod] = useState({
    period_year: today.getFullYear(),
    period_month: today.getMonth() + 1,
    period_half: "first" as "first" | "second",
    pay_date: "",
  });

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  function handleCellClick(employeeId: string, field: keyof PayrollEntry, currentVal: number) {
    setEditCell({ employeeId, field });
    setCellValue(String(currentVal));
  }

  function handleCellSave() {
    if (!editCell || !selectedPeriodId) return;
    const val = parseFloat(cellValue) || 0;
    const entry = entries.find((e) => e.employee_id === editCell.employeeId);
    if (!entry) return;

    const updated = { ...entry, [editCell.field]: val };
    setEntries((prev) => prev.map((e) => (e.employee_id === editCell.employeeId ? updated : e)));
    setEditCell(null);

    startTransition(async () => {
      await upsertPayrollEntry({
        id: updated.id,
        payroll_period_id: selectedPeriodId,
        employee_id: updated.employee_id,
        base_salary: updated.base_salary,
        position_allowance: updated.position_allowance,
        special_bonus: updated.special_bonus,
        holiday_pay: updated.holiday_pay,
        ot_pay: updated.ot_pay,
        social_security_deduction: updated.social_security_deduction,
        leave_deduction: updated.leave_deduction,
        advance_deduction: updated.advance_deduction,
        adjustment: updated.adjustment,
        other_amount: updated.other_amount,
        meal_allowance: updated.meal_allowance,
        tip_amount: updated.tip_amount,
        note: updated.note,
      });
    });
  }

  function handleCreatePeriod() {
    startTransition(async () => {
      const id = await createPayrollPeriod(newPeriod);
      setShowNewPeriod(false);
      router.push(`/owner/hr/payroll?period=${id}`);
    });
  }

  function handleClose() {
    if (!selectedPeriodId) return;
    startTransition(async () => {
      await closePayrollPeriod(selectedPeriodId);
      router.refresh();
    });
  }

  // Export Excel
  function handleExport() {
    import("xlsx").then((XLSX) => {
      const rows = entries.map((e) => ({
        แผนก: e.department_name ?? "",
        รหัส: e.employee_code ?? "",
        ชื่อ: e.employee_name,
        เงินเดือน: e.base_salary,
        ค่าตำแหน่ง: e.position_allowance,
        พิเศษ: e.special_bonus,
        นักขัตฤกษ์: e.holiday_pay,
        ล่วงเวลา: e.ot_pay,
        ประกันสังคม: e.social_security_deduction,
        "ขาด/ลา/สาย": e.leave_deduction,
        ยืม: e.advance_deduction,
        ปรับ: e.adjustment,
        อื่นๆ: e.other_amount,
        ข้าวพนง: e.meal_allowance,
        ทิป: e.tip_amount,
        รวม: calcGross(e),
        สุทธิ: calcNet(e),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "เงินเดือน");
      const periodStr = selectedPeriod ? `${selectedPeriod.period_year + 543}-${String(selectedPeriod.period_month).padStart(2, "0")}-${selectedPeriod.period_half === "first" ? "1" : "2"}` : "payroll";
      XLSX.writeFile(wb, `เงินเดือน_${periodStr}.xlsx`);
    });
  }

  // Group by department
  const groups = new Map<string, PayrollEntry[]>();
  for (const e of entries) {
    const key = e.department_name ?? "ไม่ระบุแผนก";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const COLS: { field: keyof PayrollEntry; label: string; deduction?: boolean }[] = [
    { field: "base_salary", label: "เงินเดือน" },
    { field: "position_allowance", label: "ค่าตำแหน่ง" },
    { field: "special_bonus", label: "พิเศษ" },
    { field: "holiday_pay", label: "นักขัตฤกษ์" },
    { field: "ot_pay", label: "OT" },
    { field: "social_security_deduction", label: "ประกัน", deduction: true },
    { field: "leave_deduction", label: "ขาด/ลา/สาย", deduction: true },
    { field: "advance_deduction", label: "ยืม", deduction: true },
    { field: "adjustment", label: "ปรับ", deduction: true },
    { field: "other_amount", label: "อื่นๆ" },
    { field: "meal_allowance", label: "ข้าวพนง" },
  ];

  const totalNet = entries.reduce((s, e) => s + calcNet(e), 0);
  const totalGross = entries.reduce((s, e) => s + calcGross(e), 0);

  return (
    <>
      {/* Period list + controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {periods.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/owner/hr/payroll?period=${p.id}`)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${p.id === selectedPeriodId ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"} ${p.is_closed ? "opacity-60" : ""}`}
            >
              {periodLabel(p)}
              {p.is_closed && " 🔒"}
            </button>
          ))}
          <button
            onClick={() => setShowNewPeriod(true)}
            className="rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-600"
          >
            + รอบใหม่
          </button>
        </div>
        <div className="ml-auto flex gap-2">
          {selectedPeriod && !selectedPeriod.is_closed && (
            <button onClick={handleClose} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
              ปิดงวด 🔒
            </button>
          )}
          {entries.length > 0 && (
            <button onClick={handleExport} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
              Export Excel
            </button>
          )}
        </div>
      </div>

      {!selectedPeriodId && (
        <p className="py-10 text-center text-neutral-400">เลือกงวด หรือสร้างงวดใหม่</p>
      )}

      {/* Payroll table */}
      {selectedPeriodId && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-800 text-neutral-100">
                <th className="sticky left-0 z-10 bg-neutral-800 px-3 py-2 text-left">ชื่อ</th>
                {COLS.map((c) => (
                  <th key={c.field} className={`px-2 py-2 text-right ${c.deduction ? "text-red-200" : ""}`}>{c.label}</th>
                ))}
                <th className="px-2 py-2 text-right font-semibold">รวม</th>
                <th className="px-2 py-2 text-right font-semibold text-yellow-200">สุทธิ</th>
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([dept, deptEntries]) => (
                <>
                  <tr key={`dept-${dept}`} className="bg-neutral-100">
                    <td colSpan={COLS.length + 3} className="px-3 py-1 text-xs font-semibold text-neutral-600">{dept}</td>
                  </tr>
                  {deptEntries.map((entry, i) => {
                    const gross = calcGross(entry);
                    const net = calcNet(entry);
                    const isClosed = selectedPeriod?.is_closed;
                    return (
                      <tr key={entry.employee_id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                        <td className="sticky left-0 z-10 border-r border-neutral-100 bg-inherit px-3 py-1.5">
                          <div className="font-medium text-neutral-900">{entry.employee_name}</div>
                          {entry.employee_code && <div className="font-mono text-[10px] text-neutral-400">{entry.employee_code}</div>}
                        </td>
                        {COLS.map((c) => {
                          const isEditing = editCell?.employeeId === entry.employee_id && editCell?.field === c.field;
                          const val = entry[c.field] as number;
                          return (
                            <td key={c.field} className="px-1 py-1 text-right">
                              {isEditing ? (
                                <input
                                  type="number"
                                  autoFocus
                                  className="w-20 rounded border border-neutral-300 px-1 py-0.5 text-right text-xs focus:outline-none focus:ring-1 focus:ring-neutral-400"
                                  value={cellValue}
                                  onChange={(e) => setCellValue(e.target.value)}
                                  onBlur={handleCellSave}
                                  onKeyDown={(e) => { if (e.key === "Enter") handleCellSave(); if (e.key === "Escape") setEditCell(null); }}
                                />
                              ) : (
                                <button
                                  disabled={!!isClosed}
                                  onClick={() => !isClosed && handleCellClick(entry.employee_id, c.field, val)}
                                  className={`w-full rounded px-2 py-0.5 text-right transition-colors ${c.deduction && val > 0 ? "text-red-600" : "text-neutral-700"} ${!isClosed ? "hover:bg-neutral-100" : "cursor-default"}`}
                                >
                                  {val === 0 ? "–" : fmt(val)}
                                </button>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5 text-right font-medium text-neutral-700">{fmt(gross)}</td>
                        <td className="px-2 py-1.5 text-right font-bold text-neutral-900">{fmt(net)}</td>
                      </tr>
                    );
                  })}
                </>
              ))}

              {entries.length === 0 && (
                <tr><td colSpan={COLS.length + 3} className="py-8 text-center text-neutral-400">ไม่มีพนักงาน — เพิ่มพนักงานที่หน้าพนักงานก่อน</td></tr>
              )}

              {/* Totals */}
              {entries.length > 0 && (
                <tr className="border-t-2 border-neutral-300 bg-neutral-100 font-semibold">
                  <td className="sticky left-0 z-10 bg-neutral-100 px-3 py-2">รวมทั้งหมด ({entries.length} คน)</td>
                  {COLS.map((c) => (
                    <td key={c.field} className="px-2 py-2 text-right text-neutral-600">
                      {fmt(entries.reduce((s, e) => s + (e[c.field] as number), 0))}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">{fmt(totalGross)}</td>
                  <td className="px-2 py-2 text-right text-neutral-900">{fmt(totalNet)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* New Period Modal */}
      {showNewPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">สร้างรอบเงินเดือน</h2>
              <button onClick={() => setShowNewPeriod(false)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">ปี (พ.ศ.)</label>
                  <input type="number" className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm" value={newPeriod.period_year + 543} onChange={(e) => setNewPeriod((f) => ({ ...f, period_year: +e.target.value - 543 }))} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">เดือน</label>
                  <select className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm" value={newPeriod.period_month} onChange={(e) => setNewPeriod((f) => ({ ...f, period_month: +e.target.value }))}>
                    {MONTHS_TH.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">งวด</label>
                <select className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm" value={newPeriod.period_half} onChange={(e) => setNewPeriod((f) => ({ ...f, period_half: e.target.value as "first" | "second" }))}>
                  <option value="first">ครึ่งแรก (1–15)</option>
                  <option value="second">ครึ่งหลัง (16–สิ้นเดือน)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600">วันที่จ่าย</label>
                <input type="date" className="w-full rounded border border-neutral-200 px-2 py-1.5 text-sm" value={newPeriod.pay_date} onChange={(e) => setNewPeriod((f) => ({ ...f, pay_date: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-neutral-100 px-5 py-3">
              <button onClick={() => setShowNewPeriod(false)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">ยกเลิก</button>
              <button onClick={handleCreatePeriod} disabled={isPending} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
                {isPending ? "กำลังสร้าง…" : "สร้าง"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
