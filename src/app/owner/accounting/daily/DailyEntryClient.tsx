"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import {
  bulkInsertEntries,
  deleteExpenseEntry,
  type CoaAccount,
  type ExpenseEntry,
} from "../actions";

type PendingRow = {
  id: number;
  note: string;
  coaCode: string;
  amountCash: string;
  amountTransfer: string;
};

function fmt(n: number) {
  if (n === 0) return "";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toDateLabel(date: string) {
  const [dy, dm, dd] = date.split("-");
  return `${parseInt(dd!)}/${parseInt(dm!)}/${parseInt(dy!) + 543}`;
}

function prevDate(date: string) {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function nextDate(date: string) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function DailyEntryClient({
  coa,
  initialEntries,
  date,
  isOwner,
}: {
  coa: CoaAccount[];
  initialEntries: ExpenseEntry[];
  date: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entries, setEntries] = useState<ExpenseEntry[]>(initialEntries);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const counter = useRef(0);

  // Sync entries when server passes new data after router.refresh()
  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const leafCoa = coa.filter((c) => c.group_code !== null);
  const groups = coa.filter((c) => c.group_code === null);

  function addRow() {
    setPending((prev) => [
      ...prev,
      { id: counter.current++, note: "", coaCode: "", amountCash: "", amountTransfer: "" },
    ]);
  }

  function updatePending(id: number, field: keyof Omit<PendingRow, "id">, value: string) {
    setPending((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removePending(id: number) {
    setPending((prev) => prev.filter((r) => r.id !== id));
  }

  function handleSave() {
    const rows = pending.flatMap((r) => {
      if (!r.coaCode) return [];
      const cash = parseFloat(r.amountCash.replace(/,/g, "")) || 0;
      const transfer = parseFloat(r.amountTransfer.replace(/,/g, "")) || 0;
      const result = [];
      if (cash > 0) result.push({ entry_date: date, coa_code: r.coaCode, amount: cash, note: r.note || undefined, payment_method: "cash" as const });
      if (transfer > 0) result.push({ entry_date: date, coa_code: r.coaCode, amount: transfer, note: r.note || undefined, payment_method: "transfer" as const });
      return result;
    });

    if (rows.length === 0) {
      setError("กรุณากรอกข้อมูลอย่างน้อย 1 รายการ (ต้องเลือกหมวดและใส่จำนวนเงิน)");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await bulkInsertEntries(rows);
        setPending([]);
        setSaveMsg(`บันทึกสำเร็จ ${rows.length} รายการ`);
        setTimeout(() => setSaveMsg(null), 3000);
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

  const savedCash = entries.filter((e) => e.payment_method === "cash").reduce((s, e) => s + e.amount, 0);
  const savedTransfer = entries.filter((e) => e.payment_method === "transfer").reduce((s, e) => s + e.amount, 0);
  const pendCash = pending.reduce((s, r) => s + (parseFloat(r.amountCash.replace(/,/g, "")) || 0), 0);
  const pendTransfer = pending.reduce((s, r) => s + (parseFloat(r.amountTransfer.replace(/,/g, "")) || 0), 0);
  const totalCash = savedCash + pendCash;
  const totalTransfer = savedTransfer + pendTransfer;

  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;

  return (
    <>
      {/* Print-only CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { font-size: 12px; }
          .print-title { display: block !important; }
        }
        .print-title { display: none; }
      `}</style>

      <div className="space-y-4">
        {/* Date navigation */}
        <div className="flex flex-wrap items-center gap-2 no-print">
          <a
            href={`/owner/accounting/daily?date=${prevDate(date)}`}
            className="rounded border border-neutral-300 px-2 py-1.5 text-sm hover:bg-neutral-50"
          >‹ วันก่อน</a>

          <input
            type="date"
            defaultValue={date}
            max={today}
            onChange={(e) => router.push(`/owner/accounting/daily?date=${e.target.value}`)}
            className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
          />

          {!isToday && (
            <a
              href={`/owner/accounting/daily?date=${nextDate(date)}`}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm hover:bg-neutral-50"
            >วันถัดไป ›</a>
          )}

          <span className="text-sm text-neutral-500">{toDateLabel(date)}</span>

          <div className="ml-auto flex gap-2">
            <button
              onClick={() => window.print()}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
            >พิมพ์</button>

            {pending.length > 0 && (
              <button
                onClick={handleSave}
                disabled={isPending}
                className="rounded-md bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
              >
                {isPending ? "กำลังบันทึก..." : `บันทึก (${pending.length} รายการ)`}
              </button>
            )}
          </div>
        </div>

        {/* Print header */}
        <div className="print-title font-kanit font-semibold text-lg">
          รายการค่าใช้จ่ายประจำวัน — {toDateLabel(date)}
        </div>

        {/* Main table */}
        <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-xs text-neutral-500">
                  <th className="px-3 py-2 text-left w-8">#</th>
                  <th className="px-3 py-2 text-left">รายละเอียด</th>
                  <th className="px-3 py-2 text-left w-44">หมวดบัญชี</th>
                  <th className="px-3 py-2 text-right w-32">เงินสด</th>
                  <th className="px-3 py-2 text-right w-32">โอน</th>
                  <th className="px-3 py-2 w-8 no-print"></th>
                </tr>
              </thead>
              <tbody>
                {/* Saved entries */}
                {entries.map((e, i) => (
                  <tr key={e.id} className="border-t border-neutral-100">
                    <td className="px-3 py-2 text-neutral-400 text-xs">{i + 1}</td>
                    <td className="px-3 py-2 text-neutral-700">{e.note || "–"}</td>
                    <td className="px-3 py-2 text-neutral-500 text-xs">
                      <span className="text-neutral-400">{e.group_name?.replace(/\s*\(.*\)/, "")} › </span>
                      {e.coa_name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-800">
                      {e.payment_method === "cash" ? fmt(e.amount) : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-800">
                      {e.payment_method === "transfer" ? fmt(e.amount) : ""}
                    </td>
                    <td className="px-3 py-2 no-print">
                      <button
                        onClick={() => handleDelete(e.id)}
                        disabled={isPending}
                        className="text-neutral-300 hover:text-red-500 disabled:opacity-30 text-xs"
                        title="ลบรายการ"
                      >✕</button>
                    </td>
                  </tr>
                ))}

                {/* Pending (unsaved) rows */}
                {pending.map((r, i) => (
                  <tr key={r.id} className="border-t border-blue-100 bg-blue-50/40">
                    <td className="px-3 py-2 text-neutral-400 text-xs">{entries.length + i + 1}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        placeholder="รายละเอียด / ชื่อร้านค้า..."
                        value={r.note}
                        onChange={(e) => updatePending(r.id, "note", e.target.value)}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={r.coaCode}
                        onChange={(e) => updatePending(r.id, "coaCode", e.target.value)}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs focus:border-blue-400 focus:outline-none"
                      >
                        <option value="">เลือกหมวด...</option>
                        {groups.map((g) => {
                          const children = leafCoa.filter((c) => c.group_code === g.code);
                          if (!children.length) return null;
                          return (
                            <optgroup key={g.code} label={g.name}>
                              {children.map((c) => (
                                <option key={c.code} value={c.code}>{c.name}</option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={r.amountCash}
                        onChange={(e) => updatePending(r.id, "amountCash", e.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-blue-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={r.amountTransfer}
                        onChange={(e) => updatePending(r.id, "amountTransfer", e.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-blue-400 focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5 no-print">
                      <button
                        onClick={() => removePending(r.id)}
                        className="text-neutral-300 hover:text-red-500 text-xs"
                        title="ลบแถวนี้"
                      >✕</button>
                    </td>
                  </tr>
                ))}

                {/* Add row */}
                <tr className="border-t border-neutral-100 no-print">
                  <td colSpan={6} className="px-3 py-2">
                    <button
                      onClick={addRow}
                      className="text-sm text-green-700 hover:text-green-800 font-medium"
                    >+ เพิ่มรายการ</button>
                  </td>
                </tr>

                {/* Totals */}
                {(entries.length > 0 || pending.length > 0) && (
                  <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold text-sm">
                    <td colSpan={3} className="px-3 py-2.5 text-right text-neutral-600">รวมทั้งสิ้น</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(totalCash) || "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(totalTransfer) || "–"}</td>
                    <td className="no-print"></td>
                  </tr>
                )}

                {(entries.length > 0 || pending.length > 0) && (
                  <tr className="border-t border-neutral-200 bg-neutral-100 text-xs text-neutral-500">
                    <td colSpan={3} className="px-3 py-1.5 text-right">รวมเงินสด + โอน</td>
                    <td colSpan={2} className="px-3 py-1.5 text-right tabular-nums font-semibold text-neutral-700">
                      {fmt(totalCash + totalTransfer)}
                    </td>
                    <td className="no-print"></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Status messages */}
        {error && <p className="text-sm text-red-600 no-print">{error}</p>}
        {saveMsg && <p className="text-sm text-green-700 font-medium no-print">{saveMsg}</p>}

        {/* Save button (bottom) */}
        {pending.length > 0 && (
          <div className="flex items-center justify-between no-print">
            <p className="text-xs text-neutral-500">
              * แถวสีฟ้า = ยังไม่ได้บันทึก กด "บันทึก" เพื่อยืนยัน
            </p>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="rounded-md bg-green-700 px-6 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
            >
              {isPending ? "กำลังบันทึก..." : `บันทึก ${pending.length} รายการ`}
            </button>
          </div>
        )}

        {entries.length === 0 && pending.length === 0 && (
          <p className="text-center text-sm text-neutral-400 py-6 no-print">
            ยังไม่มีรายการวันนี้ — กด "เพิ่มรายการ" เพื่อเริ่มบันทึก
          </p>
        )}
      </div>
    </>
  );
}
