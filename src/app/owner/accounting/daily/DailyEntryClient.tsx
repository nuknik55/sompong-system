"use client";

import { useState, useTransition, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import {
  bulkInsertEntries,
  updateEntriesDisplayOrder,
  deleteExpenseEntry,
  updateExpenseEntry,
  type CoaAccount,
  type ExpenseEntry,
  type Supplier,
} from "../actions";

// ── Helpers ───────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!n) return "";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MONTHS_TH = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

function toThaiDate(date: string): string {
  const [dy, dm, dd] = date.split("-").map(Number);
  return `${dd} ${MONTHS_TH[(dm ?? 1) - 1]} ${(dy ?? 2568) + 543}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── SearchableSelect (COA) ────────────────────────────────────────────

function SearchableSelect({
  value,
  onChange,
  leafCoa,
  groups,
}: {
  value: string;
  onChange: (code: string) => void;
  leafCoa: CoaAccount[];
  groups: CoaAccount[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = leafCoa.find((c) => c.code === value);
  const filtered = query.trim()
    ? leafCoa.filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          (c.group_name ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : leafCoa;

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery("");
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        placeholder="หมวด..."
        value={open ? query : (selected?.name ?? "")}
        onClick={() => { setOpen(true); setQuery(""); }}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-56 max-h-60 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-xl">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-neutral-400">ไม่พบ</p>
          ) : (
            groups.map((g) => {
              const kids = filtered.filter((c) => c.group_code === g.code);
              if (!kids.length) return null;
              return (
                <div key={g.code}>
                  <div className="sticky top-0 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-500">{g.name}</div>
                  {kids.map((c) => (
                    <button key={c.code} type="button"
                      onMouseDown={() => { onChange(c.code); setOpen(false); setQuery(""); }}
                      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-blue-50 ${value === c.code ? "bg-blue-50 font-medium text-blue-700" : "text-neutral-700"}`}>
                      {c.name}
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── SupplierAutocomplete ──────────────────────────────────────────────

function SupplierAutocomplete({
  value,
  onChange,
  suppliers,
}: {
  value: string;
  onChange: (id: string) => void;
  suppliers: Supplier[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = suppliers.find((s) => s.id === value);

  const filtered = query.trim()
    ? suppliers.filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          (s.description ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : suppliers;

  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setQuery("");
      }
    };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-1">
        <input
          type="text"
          placeholder="ซัพ..."
          value={open ? query : (selected?.name ?? "")}
          onClick={() => { setOpen(true); setQuery(""); }}
          onFocus={() => { setOpen(true); setQuery(""); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
        />
        {value && (
          <button type="button" onMouseDown={() => { onChange(""); setQuery(""); }}
            className="shrink-0 text-neutral-400 hover:text-neutral-700 text-xs px-1">✕</button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-64 max-h-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-xl">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-neutral-400">ไม่พบ</p>
          ) : (
            filtered.map((s) => (
              <button key={s.id} type="button"
                onMouseDown={() => { onChange(s.id); setOpen(false); setQuery(""); }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-blue-50 ${value === s.id ? "bg-blue-50 font-medium text-blue-700" : "text-neutral-700"}`}>
                <span className="font-medium">{s.name}</span>
                {s.description && <span className="ml-1 text-xs text-neutral-400">— {s.description}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────

type PendingRow = {
  id: number;
  supplierId: string;
  detail: string;
  coaCode: string;
  amountCash: string;
  amountTransfer: string;
  insertAfter?: number;
};

type EditState = {
  id: string;
  supplierId: string;
  detail: string;
  coaCode: string;
  amountCash: string;
  amountTransfer: string;
};

// ── Main Component ────────────────────────────────────────────────────

export function DailyEntryClient({
  coa,
  initialEntries,
  date,
  isOwner,
  suppliers,
}: {
  coa: CoaAccount[];
  initialEntries: ExpenseEntry[];
  date: string;
  isOwner: boolean;
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [entries, setEntries] = useState<ExpenseEntry[]>(initialEntries);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fixCost, setFixCost] = useState("40000");
  const counter = useRef(0);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const savedScrollRef = useRef(0);

  // Restore scroll position after server refresh completes
  useEffect(() => {
    if (!isPending && savedScrollRef.current > 0) {
      window.scrollTo({ top: savedScrollRef.current, behavior: "instant" });
    }
  }, [isPending]);

  useEffect(() => { setEntries(initialEntries); }, [initialEntries]);
  useEffect(() => {
    const stored = localStorage.getItem("daily-fix-cost");
    if (stored !== null) setFixCost(stored);
  }, []);

  const leafCoa = coa.filter((c) => c.group_code !== null);
  const groups = coa.filter((c) => c.group_code === null);

  // Label for display/print: supplier name + detail
  function entryLabel(e: ExpenseEntry): string {
    const parts = [e.supplier_name, e.detail || e.note].filter(Boolean);
    return parts.join(" — ") || "–";
  }

  const printGroups = useMemo(() => {
    const map = new Map<string, { cash: number; transfer: number }>();
    for (const e of entries) {
      const key = e.bill_ref?.trim() || entryLabel(e);
      const prev = map.get(key) ?? { cash: 0, transfer: 0 };
      if (e.payment_method === "cash") map.set(key, { ...prev, cash: prev.cash + e.amount });
      else map.set(key, { ...prev, transfer: prev.transfer + e.amount });
    }
    return [...map.entries()].map(([label, t]) => ({ label, ...t }));
  }, [entries]);

  // ── Checkbox helpers ─────────────────────────────────────────────

  function toggleEntry(entry: ExpenseEntry) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const group = entry.bill_ref
        ? entries.filter((e) => e.bill_ref === entry.bill_ref)
        : [entry];
      const allSelected = group.every((e) => next.has(e.id));
      group.forEach((e) => (allSelected ? next.delete(e.id) : next.add(e.id)));
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) =>
      prev.size === entries.length ? new Set() : new Set(entries.map((e) => e.id))
    );
  }

  // ── Pending rows ─────────────────────────────────────────────────

  function addRow() {
    setPending((prev) => [
      ...prev,
      { id: counter.current++, supplierId: "", detail: "", coaCode: "", amountCash: "", amountTransfer: "" },
    ]);
  }

  function insertRowAfter(afterIndex: number) {
    setPending((prev) => [
      ...prev,
      { id: counter.current++, supplierId: "", detail: "", coaCode: "", amountCash: "", amountTransfer: "", insertAfter: afterIndex },
    ]);
  }

  function updateRow(id: number, field: keyof Omit<PendingRow, "id">, value: string) {
    setPending((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function removeRow(id: number) {
    setPending((prev) => prev.filter((r) => r.id !== id));
  }

  function handleSave() {
    type VisualItem = { kind: "saved"; id: string } | { kind: "pending"; row: PendingRow };
    const visual: VisualItem[] = [];
    for (let i = 0; i < entries.length; i++) {
      visual.push({ kind: "saved", id: entries[i]!.id });
      for (const r of pending.filter((p) => p.insertAfter === i)) {
        visual.push({ kind: "pending", row: r });
      }
    }
    for (const r of pending.filter((p) => p.insertAfter === undefined)) {
      visual.push({ kind: "pending", row: r });
    }

    const savedOrderMap = new Map<string, number>();
    const pendingOrderMap = new Map<number, number>();
    visual.forEach((item, idx) => {
      const order = idx + 1;
      if (item.kind === "saved") savedOrderMap.set(item.id, order);
      else pendingOrderMap.set(item.row.id, order);
    });

    const rows = pending.flatMap((r) => {
      if (!r.coaCode) return [];
      const cash = parseFloat(r.amountCash) || 0;
      const transfer = parseFloat(r.amountTransfer) || 0;
      const display_order = pendingOrderMap.get(r.id);
      const result = [];
      if (cash > 0) result.push({
        entry_date: date, coa_code: r.coaCode, amount: cash,
        note: r.detail || undefined,
        payment_method: "cash" as const,
        display_order,
        supplier_id: r.supplierId || undefined,
        detail: r.detail || undefined,
      });
      if (transfer > 0) result.push({
        entry_date: date, coa_code: r.coaCode, amount: transfer,
        note: r.detail || undefined,
        payment_method: "transfer" as const,
        display_order,
        supplier_id: r.supplierId || undefined,
        detail: r.detail || undefined,
      });
      return result;
    });
    if (!rows.length) { setError("กรุณาเลือกหมวดและใส่จำนวนเงิน"); return; }

    const displayOrderUpdates = entries.map((e) => ({
      id: e.id,
      display_order: savedOrderMap.get(e.id)!,
    }));

    setError(null);
    savedScrollRef.current = window.scrollY;
    startTransition(async () => {
      try {
        await Promise.all([
          bulkInsertEntries(rows),
          updateEntriesDisplayOrder(displayOrderUpdates),
        ]);
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

  // ── Edit saved entry ─────────────────────────────────────────────

  function startEdit(e: ExpenseEntry) {
    setEditing({
      id: e.id,
      supplierId: e.supplier_id ?? "",
      detail: e.detail ?? e.note ?? "",
      coaCode: e.coa_code,
      amountCash: e.payment_method === "cash" ? String(e.amount) : "",
      amountTransfer: e.payment_method === "transfer" ? String(e.amount) : "",
    });
  }

  function handleUpdate() {
    if (!editing) return;
    const cash = parseFloat(editing.amountCash) || 0;
    const transfer = parseFloat(editing.amountTransfer) || 0;
    const amount = cash > 0 ? cash : transfer;
    const payMethod: "cash" | "transfer" = cash > 0 ? "cash" : "transfer";
    if (!editing.coaCode || amount <= 0) { setError("กรุณาเลือกหมวดและใส่จำนวนเงิน"); return; }
    setError(null);
    savedScrollRef.current = window.scrollY;
    startTransition(async () => {
      try {
        await updateExpenseEntry(editing.id, {
          coa_code: editing.coaCode,
          amount,
          note: editing.detail || null,
          bill_ref: null,
          payment_method: payMethod,
          supplier_id: editing.supplierId || null,
          detail: editing.detail || null,
        });
        setEditing(null);
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "แก้ไขไม่สำเร็จ");
      }
    });
  }

  // ── Delete ───────────────────────────────────────────────────────

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

  // ── Export CSV ───────────────────────────────────────────────────

  function exportCsv() {
    const title = `รายการค่าใช้จ่าย ${toThaiDate(date)}`;
    const csvRows = [
      [title, "", "", "", ""],
      ["", "", "", "", ""],
      ["#", "รายละเอียด", "หมวดบัญชี", "เงินสด", "โอน"],
      ...entries.map((e, i) => [
        String(i + 1),
        entryLabel(e),
        e.coa_name,
        e.payment_method === "cash" ? String(e.amount) : "",
        e.payment_method === "transfer" ? String(e.amount) : "",
      ]),
      ["", "", "", "", ""],
      ["", "", "รวมทั้งสิ้น", String(savedCash), String(savedTransfer)],
    ];
    const csv = csvRows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `รายจ่าย-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── Totals ───────────────────────────────────────────────────────

  const savedCash = entries.filter((e) => e.payment_method === "cash").reduce((s, e) => s + e.amount, 0);
  const savedTransfer = entries.filter((e) => e.payment_method === "transfer").reduce((s, e) => s + e.amount, 0);
  const fixCostNum = parseInt(fixCost.replace(/[^0-9]/g, ""), 10) || 0;
  const pendCash = pending.reduce((s, r) => s + (parseFloat(r.amountCash) || 0), 0);
  const pendTransfer = pending.reduce((s, r) => s + (parseFloat(r.amountTransfer) || 0), 0);

  const today = new Date().toISOString().slice(0, 10);
  const isToday = date === today;
  const isEmpty = entries.length === 0 && pending.length === 0;

  // ── Render ───────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-show { display: block !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        .print-show { display: none; }
      `}</style>

      <div className="space-y-4">
        {/* Date strip */}
        <div className="flex flex-wrap items-center gap-2 no-print">
          <a href={`/owner/accounting/daily?date=${shiftDate(date, -1)}`}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
            ← วันก่อน
          </a>

          <button type="button"
            onClick={() => dateInputRef.current?.showPicker?.() ?? dateInputRef.current?.click()}
            className="relative flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50">
            <svg className="h-4 w-4 text-neutral-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <path d="M16 2v4M8 2v4M3 10h18"/>
            </svg>
            {toThaiDate(date)}
            <input ref={dateInputRef} type="date" value={date} max={today}
              onChange={(e) => router.push(`/owner/accounting/daily?date=${e.target.value}`)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full" tabIndex={-1} />
          </button>

          {!isToday && (
            <a href={`/owner/accounting/daily?date=${shiftDate(date, 1)}`}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
              วันถัดไป →
            </a>
          )}

          <div className="ml-auto flex gap-2">
            {selectedIds.size > 0 && (
              <a href={`/owner/accounting/daily/receipt?date=${date}&ids=${[...selectedIds].join(",")}`}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
                สร้างใบรับรอง ({selectedIds.size})
              </a>
            )}
            <button onClick={exportCsv} disabled={entries.length === 0}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              ดาวน์โหลด Excel
            </button>
            <button onClick={() => window.print()}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
              พิมพ์
            </button>
            {pending.length > 0 && (
              <button onClick={handleSave} disabled={isPending}
                className="rounded-lg bg-green-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">
                {isPending ? "กำลังบันทึก..." : `บันทึก (${pending.length} รายการ)`}
              </button>
            )}
          </div>
        </div>

        {/* ── Print-only section ──────────────────────────────────── */}
        <div className="print-show">
          <div className="mb-4 text-lg font-semibold">รายการค่าใช้จ่ายประจำวัน — {toThaiDate(date)}</div>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-neutral-400">
                <th className="text-left pb-1.5 pr-6 font-semibold">รายการ</th>
                <th className="text-right pb-1.5 px-4 font-semibold">เงินสด</th>
                <th className="text-right pb-1.5 pl-4 font-semibold">โอน</th>
              </tr>
            </thead>
            <tbody>
              {printGroups.map((g, i) => (
                <tr key={i} className="border-b border-neutral-200">
                  <td className="py-1.5 pr-6">{g.label}</td>
                  <td className="py-1.5 px-4 text-right tabular-nums">{fmt(g.cash) || "–"}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums">{fmt(g.transfer) || "–"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-300">
                <td className="pt-2 pb-1 pr-6 text-sm">รวมเงินสด</td>
                <td className="pt-2 pb-1 px-4 text-right tabular-nums text-sm">{fmt(savedCash) || "–"}</td>
                <td className="pt-2 pb-1 pl-4"></td>
              </tr>
              <tr className="border-t border-neutral-200">
                <td className="py-1 pr-6 text-sm">รวมเครดิต</td>
                <td className="py-1 px-4"></td>
                <td className="py-1 pl-4 text-right tabular-nums text-sm">{fmt(savedTransfer) || "–"}</td>
              </tr>
              <tr className="border-t-2 border-neutral-400 font-semibold" style={{ backgroundColor: "#fef9c3" }}>
                <td className="py-2 pr-6">รวม</td>
                <td colSpan={2} className="py-2 pl-4 text-right tabular-nums">{fmt(savedCash + savedTransfer)}</td>
              </tr>
              <tr className="border-t border-neutral-200">
                <td className="py-1.5 pr-6 text-sm">Fix cost</td>
                <td colSpan={2} className="py-1.5 pl-4 text-right tabular-nums text-sm">{fmt(fixCostNum) || "–"}</td>
              </tr>
              <tr className="border-t-2 border-neutral-800 font-bold">
                <td className="pt-2 pr-6">รวมสุทธิ</td>
                <td colSpan={2} className="pt-2 pl-4 text-right tabular-nums">{fmt(savedCash + savedTransfer + fixCostNum)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── Main table ──────────────────────────────────────────── */}
        <div className="no-print rounded-xl border border-neutral-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 border-b border-neutral-200 text-xs text-neutral-500">
                  <th className="px-2 py-2.5 w-8">
                    <input type="checkbox"
                      checked={entries.length > 0 && selectedIds.size === entries.length}
                      ref={(el) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < entries.length; }}
                      onChange={toggleAll} className="cursor-pointer" title="เลือกทั้งหมด" />
                  </th>
                  <th className="px-3 py-2.5 text-left w-8">#</th>
                  <th className="px-3 py-2.5 text-left w-40">ซัพ</th>
                  <th className="px-3 py-2.5 text-left">รายละเอียด</th>
                  <th className="px-3 py-2.5 text-left w-36">หมวดบัญชี</th>
                  <th className="px-3 py-2.5 text-right w-24">เงินสด</th>
                  <th className="px-3 py-2.5 text-right w-24">โอน</th>
                  <th className="px-3 py-2.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const savedNums: number[] = [];
                  let seq = 0;
                  for (let i = 0; i < entries.length; i++) {
                    seq++;
                    savedNums.push(seq);
                    seq += pending.filter((r) => r.insertAfter === i).length;
                  }

                  return entries.flatMap((e, i) => {
                    const pendingHere = pending.filter((r) => r.insertAfter === i);
                    const isLast = i === entries.length - 1;
                    const entryNum = savedNums[i]!;
                    const isEven = entryNum % 2 === 0;

                    const entryRow = editing?.id === e.id ? (
                      <tr key={e.id} className="border-t border-amber-100 bg-amber-50/50">
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleEntry(e)} className="cursor-pointer" />
                        </td>
                        <td className="px-3 py-2 text-neutral-400 text-xs">{entryNum}</td>
                        <td className="px-1.5 py-1.5 w-40">
                          <SupplierAutocomplete value={editing.supplierId}
                            onChange={(id) => setEditing({ ...editing, supplierId: id })}
                            suppliers={suppliers} />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input type="text" value={editing.detail}
                            onChange={(ev) => setEditing({ ...editing, detail: ev.target.value })}
                            placeholder="รายละเอียด..."
                            className="w-full rounded border border-amber-300 px-2 py-1 text-sm focus:outline-none focus:border-amber-500" autoFocus />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <SearchableSelect value={editing.coaCode}
                            onChange={(code) => setEditing({ ...editing, coaCode: code })}
                            leafCoa={leafCoa} groups={groups} />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input type="text" inputMode="decimal" placeholder="0" value={editing.amountCash}
                            onChange={(ev) => setEditing({ ...editing, amountCash: ev.target.value.replace(/[^0-9.]/g, "") })}
                            className="w-full rounded border border-amber-300 px-2 py-1 text-sm text-right tabular-nums focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input type="text" inputMode="decimal" placeholder="0" value={editing.amountTransfer}
                            onChange={(ev) => setEditing({ ...editing, amountTransfer: ev.target.value.replace(/[^0-9.]/g, "") })}
                            className="w-full rounded border border-amber-300 px-2 py-1 text-sm text-right tabular-nums focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <div className="flex gap-1">
                            <button onClick={handleUpdate} disabled={isPending}
                              className="rounded bg-amber-500 px-2 py-0.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">บันทึก</button>
                            <button onClick={() => setEditing(null)}
                              className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200">ยกเลิก</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={e.id} className={`border-t border-neutral-100 group ${selectedIds.has(e.id) ? "bg-blue-50/60" : isEven ? "bg-neutral-50/60 hover:bg-neutral-100/60" : "bg-white hover:bg-neutral-50"}`}>
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleEntry(e)} className="cursor-pointer" />
                        </td>
                        <td className="px-3 py-2 text-neutral-400 text-xs">{entryNum}</td>
                        <td className="px-3 py-2 text-xs text-neutral-500 truncate max-w-[10rem]">
                          {e.supplier_name ? (
                            <span className="font-medium text-neutral-700">{e.supplier_name}</span>
                          ) : "–"}
                        </td>
                        <td className="px-3 py-2 text-neutral-700 text-sm">{e.detail || e.note || "–"}</td>
                        <td className="px-3 py-2 text-xs">
                          <span className="text-neutral-400">{e.group_name?.replace(/\s*\(.*\)/, "")} › </span>
                          <span className="text-neutral-600">{e.coa_name}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-800">{e.payment_method === "cash" ? fmt(e.amount) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-800">{e.payment_method === "transfer" ? fmt(e.amount) : ""}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={() => startEdit(e)}
                            className="rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-500 hover:border-amber-300 hover:text-amber-600 active:bg-amber-50">แก้ไข</button>
                          <button onClick={() => handleDelete(e.id)} disabled={isPending}
                            className="ml-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-100 active:bg-red-200 disabled:opacity-30">ลบ</button>
                        </td>
                      </tr>
                    );

                    const pendingRows = pendingHere.map((r, pi) => (
                      <tr key={r.id} className="border-t border-blue-100 bg-blue-50/30">
                        <td className="px-2 py-2" />
                        <td className="px-3 py-2 text-neutral-400 text-xs">{entryNum + 1 + pi}</td>
                        <td className="px-1.5 py-1.5 w-40">
                          <SupplierAutocomplete value={r.supplierId} onChange={(id) => updateRow(r.id, "supplierId", id)} suppliers={suppliers} />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input type="text" placeholder="รายละเอียด..." value={r.detail}
                            onChange={(ev) => updateRow(r.id, "detail", ev.target.value)}
                            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5 w-36">
                          <SearchableSelect value={r.coaCode} onChange={(code) => updateRow(r.id, "coaCode", code)} leafCoa={leafCoa} groups={groups} />
                        </td>
                        <td className="px-1.5 py-1.5 w-24">
                          <input type="text" inputMode="decimal" placeholder="0" value={r.amountCash}
                            onChange={(ev) => updateRow(r.id, "amountCash", ev.target.value.replace(/[^0-9.]/g, ""))}
                            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-blue-400 focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5 w-24">
                          <input type="text" inputMode="decimal" placeholder="0" value={r.amountTransfer}
                            onChange={(ev) => updateRow(r.id, "amountTransfer", ev.target.value.replace(/[^0-9.]/g, ""))}
                            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-blue-400 focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <button onClick={() => removeRow(r.id)}
                            className="rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-400 hover:border-red-300 hover:text-red-500">ลบ</button>
                        </td>
                      </tr>
                    ));

                    const insertStrip = !isLast ? (
                      <tr key={`ins-${i}`} className="group/ins">
                        <td colSpan={8} className="px-0 py-0">
                          <div className="relative flex items-center justify-center" style={{ height: "20px" }}>
                            <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-neutral-200 group-hover/ins:bg-blue-300 transition-colors" />
                            <button type="button" onClick={() => insertRowAfter(i)} title="แทรกรายการ"
                              className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs font-bold text-neutral-400 shadow-sm opacity-50 group-hover/ins:opacity-100 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-500 active:bg-blue-100 transition-all">
                              +
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null;

                    return [entryRow, ...pendingRows, insertStrip].filter(Boolean);
                  });
                })()}

                {/* Bottom pending rows */}
                {pending.filter((r) => r.insertAfter === undefined).map((r, i) => (
                  <tr key={r.id} className="border-t border-blue-100 bg-blue-50/30">
                    <td className="px-2 py-2" />
                    <td className="px-3 py-2 text-neutral-400 text-xs">{
                      (() => {
                        let s = 0;
                        for (let ei = 0; ei < entries.length; ei++) {
                          s++;
                          s += pending.filter((pr) => pr.insertAfter === ei).length;
                        }
                        return s + 1 + i;
                      })()
                    }</td>
                    <td className="px-1.5 py-1.5 w-40">
                      <SupplierAutocomplete value={r.supplierId} onChange={(id) => updateRow(r.id, "supplierId", id)} suppliers={suppliers} />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <input type="text" placeholder="รายละเอียด..." value={r.detail}
                        onChange={(ev) => updateRow(r.id, "detail", ev.target.value)}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none" />
                    </td>
                    <td className="px-1.5 py-1.5 w-36">
                      <SearchableSelect value={r.coaCode} onChange={(code) => updateRow(r.id, "coaCode", code)} leafCoa={leafCoa} groups={groups} />
                    </td>
                    <td className="px-1.5 py-1.5 w-24">
                      <input type="text" inputMode="decimal" placeholder="0" value={r.amountCash}
                        onChange={(ev) => updateRow(r.id, "amountCash", ev.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-blue-400 focus:outline-none" />
                    </td>
                    <td className="px-1.5 py-1.5 w-24">
                      <input type="text" inputMode="decimal" placeholder="0" value={r.amountTransfer}
                        onChange={(ev) => updateRow(r.id, "amountTransfer", ev.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-blue-400 focus:outline-none" />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <button onClick={() => removeRow(r.id)}
                        className="rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-400 hover:border-red-300 hover:text-red-500">ลบ</button>
                    </td>
                  </tr>
                ))}

                {/* Add row */}
                <tr className="border-t border-neutral-100">
                  <td colSpan={8} className="px-3 py-2.5">
                    <button onClick={addRow} className="text-sm font-medium text-green-700 hover:text-green-800">
                      + เพิ่มรายการ
                    </button>
                  </td>
                </tr>

                {/* Totals */}
                {!isEmpty && (
                  <>
                    <tr className="border-t-2 border-neutral-300 bg-neutral-50 font-semibold text-sm">
                      <td colSpan={5} className="px-3 py-2.5 text-right text-neutral-600">รวมทั้งสิ้น</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmt(savedCash + pendCash) || "–"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmt(savedTransfer + pendTransfer) || "–"}</td>
                      <td></td>
                    </tr>
                    <tr className="border-t border-neutral-200 bg-neutral-100 text-xs text-neutral-500">
                      <td colSpan={5} className="px-3 py-2 text-right">รวมเงินสด + โอน</td>
                      <td colSpan={2} className="px-3 py-2 text-right tabular-nums font-semibold text-neutral-700">
                        {fmt(savedCash + pendCash + savedTransfer + pendTransfer)}
                      </td>
                      <td></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Fix cost */}
        {!isEmpty && (
          <div className="no-print flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
            <span className="font-medium text-neutral-700">Fix cost</span>
            <input type="text" inputMode="numeric" value={fixCost}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, "");
                setFixCost(raw);
                localStorage.setItem("daily-fix-cost", raw);
              }}
              className="w-32 rounded border border-neutral-300 bg-white px-3 py-1.5 text-right tabular-nums focus:border-blue-400 focus:outline-none" />
            <span className="text-neutral-400">บาท</span>
            <span className="ml-auto text-neutral-500">
              รวมสุทธิ:{" "}
              <span className="font-semibold tabular-nums text-neutral-900">{fmt(savedCash + savedTransfer + fixCostNum)}</span>
            </span>
          </div>
        )}

        {error && <p className="text-sm text-red-600 no-print">{error}</p>}
        {saveMsg && <p className="text-sm font-medium text-green-700 no-print">{saveMsg}</p>}

        {pending.length > 0 && (
          <div className="flex items-center justify-between no-print">
            <p className="text-xs text-blue-600">แถวสีฟ้า = ยังไม่ได้บันทึก</p>
            <button onClick={handleSave} disabled={isPending}
              className="rounded-lg bg-green-700 px-6 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">
              {isPending ? "กำลังบันทึก..." : `บันทึก ${pending.length} รายการ`}
            </button>
          </div>
        )}

        {isEmpty && (
          <p className="py-6 text-center text-sm text-neutral-400 no-print">
            ยังไม่มีรายการ — กด &ldquo;+ เพิ่มรายการ&rdquo; เพื่อเริ่มบันทึก
          </p>
        )}
      </div>
    </>
  );
}
