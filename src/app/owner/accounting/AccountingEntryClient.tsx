"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import { addExpenseEntry, deleteExpenseEntry, type CoaAccount, type ExpenseEntry } from "./actions";

function formatBaht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getThaiMonth(yearMonth: string) {
  const MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${(y ?? 2568) + 543}`;
}

export function AccountingEntryClient({
  coa,
  initialEntries,
  yearMonth,
  isOwner,
}: {
  coa: CoaAccount[];
  initialEntries: ExpenseEntry[];
  yearMonth: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entries, setEntries] = useState<ExpenseEntry[]>(initialEntries);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [coaCode, setCoaCode] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "transfer">("cash");

  // Filter to only leaf accounts (has group_code)
  const leafCoa = coa.filter((c) => c.group_code !== null);
  const groups = coa.filter((c) => c.group_code === null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = parseFloat(amount.replace(/,/g, ""));
    if (!coaCode || isNaN(amountNum) || amountNum <= 0) {
      setError("กรุณาเลือกหมวดบัญชีและกรอกจำนวนเงิน");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await addExpenseEntry({ entry_date: date, coa_code: coaCode, amount: amountNum, note, payment_method: payMethod });
        setAmount("");
        setNote("");
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteExpenseEntry(id);
        setEntries((prev) => prev.filter((e) => e.id !== id));
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  // Group entries by date for display
  const byDate = new Map<string, ExpenseEntry[]>();
  for (const e of entries) {
    const arr = byDate.get(e.entry_date) ?? [];
    arr.push(e);
    byDate.set(e.entry_date, arr);
  }
  const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  const monthTotal = entries.reduce((s, e) => s + e.amount, 0);

  // Month navigation
  const [y, m] = yearMonth.split("-").map(Number);
  const prevMonth = new Date(y!, m! - 2, 1).toISOString().slice(0, 7);
  const nextMonth = new Date(y!, m!, 1).toISOString().slice(0, 7);
  const isCurrentMonth = yearMonth === today.slice(0, 7);

  return (
    <div className="space-y-6">
      {/* Month navigator */}
      <div className="flex items-center gap-3">
        <a href={`/owner/accounting?month=${prevMonth}`}
          className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">‹</a>
        <span className="font-medium text-neutral-800">{getThaiMonth(yearMonth)}</span>
        {!isCurrentMonth && (
          <a href={`/owner/accounting?month=${nextMonth}`}
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">›</a>
        )}
        <span className="ml-auto text-sm text-neutral-500">ยอดรวมเดือน:</span>
        <span className="font-semibold text-neutral-900">{formatBaht(monthTotal)} บาท</span>
      </div>

      {/* Entry form */}
      <form onSubmit={handleSubmit} className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
        <p className="text-sm font-medium text-neutral-700">บันทึกรายจ่าย</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block text-xs text-neutral-500">วันที่</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="mb-1 block text-xs text-neutral-500">ช่องทางชำระ</label>
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as "cash" | "transfer")}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="cash">เงินสด</option>
              <option value="transfer">โอน</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-neutral-500">หมวดบัญชี</label>
            <select
              value={coaCode}
              onChange={(e) => setCoaCode(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              required
            >
              <option value="">เลือกหมวดบัญชี...</option>
              {groups.map((g) => {
                const children = leafCoa.filter((c) => c.group_code === g.code);
                if (children.length === 0) return null;
                return (
                  <optgroup key={g.code} label={g.name}>
                    {children.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-1">
            <label className="mb-1 block text-xs text-neutral-500">จำนวนเงิน (บาท)</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
              required
            />
          </div>
          <div className="col-span-1 sm:col-span-2">
            <label className="mb-1 block text-xs text-neutral-500">หมายเหตุ (ถ้ามี)</label>
            <input
              type="text"
              placeholder="รายละเอียดเพิ่มเติม..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="col-span-2 sm:col-span-1 flex items-end">
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
            >
              {isPending ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {/* Entries list grouped by date */}
      {sortedDates.length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-8">ยังไม่มีรายการในเดือนนี้</p>
      ) : (
        <div className="space-y-4">
          {sortedDates.map((d) => {
            const dayEntries = byDate.get(d) ?? [];
            const dayTotal = dayEntries.reduce((s, e) => s + e.amount, 0);
            const [dy, dm, dd] = d.split("-");
            const dateLabel = `${parseInt(dd!)} / ${parseInt(dm!)} / ${parseInt(dy!) + 543}`;
            return (
              <div key={d} className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                <div className="flex items-center justify-between bg-neutral-50 px-3 py-2">
                  <span className="text-sm font-medium text-neutral-700">{dateLabel}</span>
                  <span className="text-sm tabular-nums text-neutral-500">{formatBaht(dayTotal)} บาท</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {dayEntries.map((e) => (
                      <tr key={e.id} className="border-t border-neutral-100 last:border-0">
                        <td className="px-3 py-2 text-neutral-500 text-xs w-16">
                          {e.payment_method === "cash" ? "💵" : "🏦"}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-neutral-400 text-xs mr-1">{e.group_name?.replace(/\s*\(.*\)/,"")}</span>
                          <span className="text-neutral-800">{e.coa_name}</span>
                          {e.note && <span className="ml-2 text-xs text-neutral-400">{e.note}</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-neutral-800">
                          {formatBaht(e.amount)}
                        </td>
                        <td className="px-3 py-2 w-10">
                          <button
                            type="button"
                            onClick={() => handleDelete(e.id)}
                            disabled={isPending}
                            className="text-neutral-300 hover:text-red-500 disabled:opacity-30 text-xs"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
