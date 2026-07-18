"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { deleteExpenseEntry, type ExpenseEntry } from "./actions";

function formatBaht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt(n: number) {
  return n ? n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
}

const MONTHS_TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                   "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

function getThaiMonth(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 2568) + 543}`;
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function highlight(text: string, query: string) {
  if (!query || !text.toLowerCase().includes(query.toLowerCase())) {
    return <span>{text}</span>;
  }
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export function AccountingEntryClient({
  initialEntries,
  yearMonth,
  isOwner,
}: {
  initialEntries: ExpenseEntry[];
  yearMonth: string;
  isOwner: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [entries, setEntries] = useState<ExpenseEntry[]>(initialEntries);
  const [search, setSearch] = useState("");
  const [filterGroup, setFilterGroup] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleDelete(id: string) {
    if (!confirm("ยืนยันการลบรายการนี้?")) return;
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

  const allGroups = [...new Set(entries.map((e) => e.group_name).filter(Boolean))] as string[];

  const q = search.toLowerCase();
  const filtered = entries.filter((e) => {
    const matchSearch = !q ||
      (e.note ?? "").toLowerCase().includes(q) ||
      e.coa_name.toLowerCase().includes(q);
    const matchGroup = !filterGroup || e.group_name === filterGroup;
    return matchSearch && matchGroup;
  });

  const byDate = new Map<string, ExpenseEntry[]>();
  for (const e of filtered) {
    const arr = byDate.get(e.entry_date) ?? [];
    arr.push(e);
    byDate.set(e.entry_date, arr);
  }
  const sortedDates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0);
  const monthTotal = entries.reduce((s, e) => s + e.amount, 0);
  const isFiltering = !!(search || filterGroup);

  const today = new Date().toISOString().slice(0, 10);
  const isCurrentMonth = yearMonth === today.slice(0, 7);
  const prevMonth = shiftMonth(yearMonth, -1);
  const nextMonth = shiftMonth(yearMonth, 1);

  return (
    <div className="space-y-4">
      {/* Month navigator + total */}
      <div className="flex flex-wrap items-center gap-3">
        <a href={`/owner/accounting?month=${prevMonth}`}
          className="rounded border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-50">‹</a>
        <span className="font-medium text-neutral-800">{getThaiMonth(yearMonth)}</span>
        {!isCurrentMonth && (
          <a href={`/owner/accounting?month=${nextMonth}`}
            className="rounded border border-neutral-300 px-2.5 py-1 text-sm hover:bg-neutral-50">›</a>
        )}
        <div className="ml-auto flex items-center gap-2 text-sm">
          {isFiltering ? (
            <>
              <span className="text-neutral-500">ผลค้นหา:</span>
              <span className="font-semibold text-neutral-900">{formatBaht(filteredTotal)} บาท</span>
              <span className="text-neutral-400 text-xs">/ เดือน {formatBaht(monthTotal)}</span>
            </>
          ) : (
            <>
              <span className="text-neutral-500">ยอดรวมเดือน:</span>
              <span className="font-semibold text-neutral-900">{formatBaht(monthTotal)} บาท</span>
            </>
          )}
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="ค้นหาในเดือนนี้ เช่น กุ้ง มัน ไม้กวาด..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-48 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        />
        <select
          value={filterGroup}
          onChange={(e) => setFilterGroup(e.target.value)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none text-neutral-700"
        >
          <option value="">ทุกหมวด</option>
          {allGroups.map((g) => (
            <option key={g} value={g}>{g.replace(/\s*\(.*\)/, "")}</option>
          ))}
        </select>
        {isFiltering && (
          <button
            onClick={() => { setSearch(""); setFilterGroup(""); }}
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-50"
          >
            ล้าง
          </button>
        )}
        <a
          href={`/owner/accounting/daily?date=${today}`}
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          + บันทึกวันนี้
        </a>
      </div>

      {isFiltering && (
        <p className="text-xs text-neutral-500">
          พบ <span className="font-medium text-neutral-700">{filtered.length} รายการ</span> จากทั้งหมด {entries.length} รายการ
          {search && <> ที่มีคำว่า &ldquo;<span className="font-medium">{search}</span>&rdquo;</>}
        </p>
      )}

      {/* Entries */}
      {sortedDates.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">
          {isFiltering ? "ไม่พบรายการที่ค้นหา" : "ยังไม่มีรายการในเดือนนี้"}
        </p>
      ) : (
        <div className="space-y-3">
          {sortedDates.map((d) => {
            const dayEntries = byDate.get(d) ?? [];
            const dayCash = dayEntries.filter((e) => e.payment_method === "cash").reduce((s, e) => s + e.amount, 0);
            const dayTransfer = dayEntries.filter((e) => e.payment_method === "transfer").reduce((s, e) => s + e.amount, 0);
            const dayTotal = dayCash + dayTransfer;
            const [dy, dm, dd] = d.split("-");
            const dateLabel = `${parseInt(dd!)} / ${parseInt(dm!)} / ${parseInt(dy!) + 543}`;
            return (
              <div key={d} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                {/* Date header */}
                <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50 px-3 py-2">
                  <a
                    href={`/owner/accounting/daily?date=${d}`}
                    className="text-sm font-semibold text-neutral-700 hover:text-blue-600 hover:underline"
                    title="คลิกเพื่อแก้ไขรายการของวันนี้"
                  >
                    {dateLabel}
                  </a>
                  <span className="tabular-nums text-sm font-medium text-neutral-600">{formatBaht(dayTotal)} บาท</span>
                </div>
                {/* Entry table */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-100 text-xs text-neutral-400">
                      <th className="px-3 py-1.5 text-left">รายละเอียด</th>
                      <th className="px-3 py-1.5 text-left w-40">หมวดบัญชี</th>
                      <th className="px-3 py-1.5 text-right w-28">เงินสด</th>
                      <th className="px-3 py-1.5 text-right w-28">โอน</th>
                      <th className="w-8 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayEntries.map((e) => (
                      <tr key={e.id} className="group border-t border-neutral-100 last:border-0 hover:bg-neutral-50/50">
                        <td className="px-3 py-2 text-neutral-700">
                          {e.note ? highlight(e.note, search) : <span className="text-neutral-300">–</span>}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className="text-neutral-400">{e.group_name?.replace(/\s*\(.*\)/, "")} › </span>
                          <span className="text-neutral-600">{e.coa_name}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-800">
                          {e.payment_method === "cash" ? formatBaht(e.amount) : ""}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-800">
                          {e.payment_method === "transfer" ? formatBaht(e.amount) : ""}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(e.id)}
                            disabled={isPending}
                            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-400 hover:bg-red-100 active:bg-red-200 disabled:opacity-30"
                            title="ลบรายการ"
                          >
                            ลบ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {/* Day totals row */}
                  {(dayCash > 0 || dayTransfer > 0) && (
                    <tfoot>
                      <tr className="border-t border-neutral-200 bg-neutral-50 text-xs text-neutral-500">
                        <td colSpan={2} className="px-3 py-1.5 text-right font-medium">รวม</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-neutral-700">
                          {fmt(dayCash)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium text-neutral-700">
                          {fmt(dayTransfer)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
