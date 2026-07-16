"use client";

import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { deleteExpenseEntry, type ExpenseEntry } from "./actions";

function formatBaht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getThaiMonth(yearMonth: string) {
  const MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const [y, m] = yearMonth.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${(y ?? 2568) + 543}`;
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

  // Unique groups for filter dropdown
  const allGroups = [...new Set(entries.map((e) => e.group_name).filter(Boolean))] as string[];

  // Filter entries
  const q = search.toLowerCase();
  const filtered = entries.filter((e) => {
    const matchSearch = !q ||
      (e.note ?? "").toLowerCase().includes(q) ||
      e.coa_name.toLowerCase().includes(q);
    const matchGroup = !filterGroup || e.group_name === filterGroup;
    return matchSearch && matchGroup;
  });

  // Group by date
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
  const [y, m] = yearMonth.split("-").map(Number);
  const prevMonth = new Date(y!, m! - 2, 1).toISOString().slice(0, 7);
  const nextMonth = new Date(y!, m!, 1).toISOString().slice(0, 7);
  const isCurrentMonth = yearMonth === today.slice(0, 7);

  return (
    <div className="space-y-4">
      {/* Month navigator */}
      <div className="flex flex-wrap items-center gap-3">
        <a href={`/owner/accounting?month=${prevMonth}`}
          className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">‹</a>
        <span className="font-medium text-neutral-800">{getThaiMonth(yearMonth)}</span>
        {!isCurrentMonth && (
          <a href={`/owner/accounting?month=${nextMonth}`}
            className="rounded border border-neutral-300 px-2 py-1 text-sm hover:bg-neutral-50">›</a>
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

      {/* Search + filter bar */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="ค้นหารายละเอียด เช่น จาน กุ้ง ไม้กวาด..."
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
            ล้างตัวกรอง
          </button>
        )}
        <a
          href={`/owner/accounting/daily?date=${today}`}
          className="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          + บันทึกวันนี้
        </a>
      </div>

      {/* Result count when filtering */}
      {isFiltering && (
        <p className="text-xs text-neutral-500">
          พบ <span className="font-medium text-neutral-700">{filtered.length} รายการ</span> จากทั้งหมด {entries.length} รายการ
          {search && <> ที่มีคำว่า &ldquo;<span className="font-medium">{search}</span>&rdquo;</>}
        </p>
      )}

      {/* Entries */}
      {sortedDates.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">
          {isFiltering ? `ไม่พบรายการที่ค้นหา` : "ยังไม่มีรายการในเดือนนี้"}
        </p>
      ) : (
        <div className="space-y-3">
          {sortedDates.map((d) => {
            const dayEntries = byDate.get(d) ?? [];
            const dayTotal = dayEntries.reduce((s, e) => s + e.amount, 0);
            const [dy, dm, dd] = d.split("-");
            const dateLabel = `${parseInt(dd!)} / ${parseInt(dm!)} / ${parseInt(dy!) + 543}`;
            return (
              <div key={d} className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                <div className="flex items-center justify-between bg-neutral-50 px-3 py-2">
                  <a
                    href={`/owner/accounting/daily?date=${d}`}
                    className="text-sm font-medium text-neutral-700 hover:text-blue-600 hover:underline"
                    title="คลิกเพื่อแก้ไขรายการของวันนี้"
                  >
                    {dateLabel}
                  </a>
                  <span className="tabular-nums text-sm text-neutral-500">{formatBaht(dayTotal)} บาท</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {dayEntries.map((e) => (
                      <tr key={e.id} className="group border-t border-neutral-100 last:border-0 hover:bg-neutral-50/50">
                        <td className="w-12 px-3 py-2 text-xs text-neutral-400">
                          {e.payment_method === "cash" ? "สด" : "โอน"}
                        </td>
                        <td className="px-3 py-2">
                          <span className="mr-1 text-xs text-neutral-400">
                            {e.group_name?.replace(/\s*\(.*\)/, "")} ›{" "}
                          </span>
                          <span className="text-neutral-800">{e.coa_name}</span>
                          {e.note && (
                            <span className="ml-2 text-xs text-neutral-500">
                              {highlight(e.note, search)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-neutral-800">
                          {formatBaht(e.amount)}
                        </td>
                        <td className="w-10 px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleDelete(e.id)}
                            disabled={isPending}
                            className="text-xs text-neutral-300 opacity-0 hover:text-red-500 disabled:opacity-30 group-hover:opacity-100"
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

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
