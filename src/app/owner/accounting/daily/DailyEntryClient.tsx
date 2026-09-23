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
import { isDailyEditable, resolveEditPaymentMethod, splitByPaymentMethod } from "./payment-split";
import { bangkokToday, shiftDay } from "@/lib/bangkok-date";
import { capexWarning, capexWarningText } from "../capex-hint";
import { buttonClass } from "@/components/ui/button";
import { TH_ROW } from "@/components/ui/table";

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

// setDate/getDate read the browser's zone and toISOString writes UTC, which
// agree only east of Greenwich. shiftDay is the same arithmetic in UTC
// throughout (src/lib/bangkok-date.ts).
const shiftDate = shiftDay;

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
        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-info/30 focus:outline-none"
      />
      {open && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-56 max-h-60 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-xl">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-neutral-500">ไม่พบ</p>
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
                      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 ${value === c.code ? "bg-primary-soft font-medium text-primary" : "text-neutral-700"}`}>
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
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-info/30 focus:outline-none"
        />
        {value && (
          <button type="button" onMouseDown={() => { onChange(""); setQuery(""); }}
            className="shrink-0 text-neutral-500 hover:text-neutral-700 text-xs px-1">✕</button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-0.5 w-64 max-h-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-xl">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-neutral-500">ไม่พบ</p>
          ) : (
            filtered.map((s) => (
              <button key={s.id} type="button"
                onMouseDown={() => { onChange(s.id); setOpen(false); setQuery(""); }}
                className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 ${value === s.id ? "bg-primary-soft font-medium text-primary" : "text-neutral-700"}`}>
                <span className="font-medium">{s.name}</span>
                {s.description && <span className="ml-1 text-xs text-neutral-500">— {s.description}</span>}
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
  /** The method the entry already has, so a save need not assert one. */
  paymentMethod: string;
  amountCash: string;
  amountTransfer: string;
};

// ── Main Component ────────────────────────────────────────────────────

export function DailyEntryClient({
  coa,
  entries,
  date,
  suppliers,
  capexThreshold,
}: {
  coa: CoaAccount[];
  entries: ExpenseEntry[];
  date: string;
  suppliers: Supplier[];
  /** Amount above which a supply or maintenance row is asked about (item 9). 0 = off. */
  capexThreshold: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // The entries list is rendered straight from the server prop, deliberately NOT
  // mirrored into state. Unsaved user input lives in pending (rows typed but
  // not yet saved) and editing (the row currently being edited); neither is
  // derived from this prop, so a refresh cannot destroy typed work here the way
  // it could in ChargesSection. Every mutation goes server action ->
  // router.refresh() -> new prop.
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

  // react-hooks/set-state-in-effect is suppressed on the line below. This is
  // the second instance of this exact exception in the codebase; the first,
  // with the full reasoning, is in
  // src/app/owner/accounting/daily/receipt/ReceiptClient.tsx.
  //
  // Short version: localStorage exists only in the browser, this component is
  // server-rendered first, and a useState initialiser would run on the server
  // (no localStorage) and again on the client during hydration (localStorage
  // present) — the two renders disagree and React reports a hydration
  // mismatch. The effect is the correct place for a browser-only read, not a
  // workaround for one.
  //
  // The cost is one frame showing the "40000" default before the saved value
  // replaces it.
  //
  // ReceiptClient's note says useSyncExternalStore with a server snapshot
  // becomes worth doing if this pattern appears a third time. This is the
  // second. If you are here writing the third, do that instead of adding
  // another disable.
  useEffect(() => {
    const stored = localStorage.getItem("daily-fix-cost");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only read; see above
    if (stored !== null) setFixCost(stored);
  }, []);

  const leafCoa = coa.filter((c) => c.group_code !== null);
  const groups = coa.filter((c) => c.group_code === null);

  // ── The CapEx question (queue item 9) ───────────────────────────────────
  //
  // A WARNING, never a refusal: it asks whether a large purchase in the
  // equipment and supplies groups is a new asset, and the person answers by
  // choosing an account. Saving is untouched — no disabled button, no
  // confirm step, and nothing is reclassified. Rows already saved are never
  // revisited; this looks only at what is being typed or edited.
  //
  // The cash and transfer halves of one row are ONE purchase split across two
  // payment methods (that is what the two boxes mean here), so they are added
  // up before the comparison — otherwise a ฿29,853 sealer paid half each way
  // would slip under a ฿20,000 threshold twice.
  const coaOf = (code: string) => leafCoa.find((c) => c.code === code);
  const rowTotal = (cash: string, transfer: string) => (parseFloat(cash) || 0) + (parseFloat(transfer) || 0);
  const capexRows = pending
    .map((r) => ({ row: r, account: coaOf(r.coaCode), total: rowTotal(r.amountCash, r.amountTransfer) }))
    .filter((x) => capexWarning({ amount: x.total, groupCode: x.account?.group_code, threshold: capexThreshold }));
  const editingIsCapex =
    editing != null &&
    capexWarning({
      amount: rowTotal(editing.amountCash, editing.amountTransfer),
      groupCode: coaOf(editing.coaCode)?.group_code,
      threshold: capexThreshold,
    });
  const capexNotice =
    capexRows.length === 0 ? null : (
      <div className="no-print rounded-lg border border-pending/60 bg-pending-soft px-3 py-2 text-xs text-pending-ink">
        <p>{capexWarningText(capexThreshold)}</p>
        <ul className="mt-1 space-y-0.5">
          {capexRows.map((x) => (
            <li key={x.row.id} className="tabular-nums">
              • {x.account?.name ?? x.row.coaCode} — {x.total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
            </li>
          ))}
        </ul>
        <p className="mt-1 text-pending-ink">บันทึกได้ตามปกติ — ระบบไม่เปลี่ยนหมวดให้เอง</p>
      </div>
    );

  // Label for display/print: supplier name + detail
  function entryLabel(e: ExpenseEntry): string {
    const parts = [e.supplier_name, e.detail || e.note].filter(Boolean);
    return parts.join(" — ") || "–";
  }

  // The printed sheet is a payment instruction: เงินสด is settled, โอน is what
  // Nik still has to send. An accrual entry — GP withheld before payout, or a
  // POS discount — is neither, so it is summed separately and shown as a
  // footnote rather than inside either column. Until this used
  // splitByPaymentMethod it fell into โอน by an else-branch.
  const printSplit = useMemo(
    () => splitByPaymentMethod(entries, (e) => e.bill_ref?.trim() || entryLabel(e)),
    [entries],
  );
  const printGroups = useMemo(
    () => printSplit.groups.filter((g) => g.buckets.cash > 0 || g.buckets.transfer > 0),
    [printSplit],
  );
  const printAccrual = printSplit.totals.accrual;
  const printAccrualCount = useMemo(
    () => printSplit.groups.filter((g) => g.buckets.accrual > 0 && g.buckets.cash === 0 && g.buckets.transfer === 0).length,
    [printSplit],
  );

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
        const [bulkResult] = await Promise.all([
          bulkInsertEntries(rows),
          updateEntriesDisplayOrder(displayOrderUpdates),
        ]);
        if (bulkResult.status === "error") { setError(bulkResult.message); return; }
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
    // The dialog has only เงินสด and โอน boxes, so it can neither show nor
    // express an accrual entry: it would open with both blank and save as a
    // transfer. These are written and replaced wholesale by the POS import,
    // so hand-editing one would survive only until the next run anyway.
    if (!isDailyEditable(e)) {
      setError("รายการนี้เป็นค่าใช้จ่ายที่ไม่ต้องจ่าย (GP/ส่วนลดจาก POS) แก้ไขที่หน้านำเข้ารายได้");
      return;
    }
    setError(null);
    setEditing({
      id: e.id,
      supplierId: e.supplier_id ?? "",
      detail: e.detail ?? e.note ?? "",
      coaCode: e.coa_code,
      paymentMethod: e.payment_method,
      amountCash: e.payment_method === "cash" ? String(e.amount) : "",
      amountTransfer: e.payment_method === "transfer" ? String(e.amount) : "",
    });
  }

  function handleUpdate() {
    if (!editing) return;
    const cash = parseFloat(editing.amountCash) || 0;
    const transfer = parseFloat(editing.amountTransfer) || 0;
    const amount = cash > 0 ? cash : transfer;
    // Never assert a method the user did not express. The old rule resolved
    // anything that was not cash to "transfer", which silently moved an
    // accrual entry onto the pay-out list.
    const payMethod = resolveEditPaymentMethod(cash, transfer, editing.paymentMethod);
    if (!editing.coaCode || amount <= 0) { setError("กรุณาเลือกหมวดและใส่จำนวนเงิน"); return; }
    setError(null);
    savedScrollRef.current = window.scrollY;
    startTransition(async () => {
      try {
        const result = await updateExpenseEntry(editing.id, {
          coa_code: editing.coaCode,
          amount,
          note: editing.detail || null,
          bill_ref: null,
          payment_method: payMethod,
          supplier_id: editing.supplierId || null,
          detail: editing.detail || null,
        });
        if (result.status === "error") { setError(result.message); return; }
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
        const result = await deleteExpenseEntry(id);
        if (result.status === "error") { setError(result.message); return; }
        router.refresh();
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

  const today = bangkokToday();
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
            className={buttonClass("secondary")}>
            ← วันก่อน
          </a>

          <button type="button"
            onClick={() => dateInputRef.current?.showPicker?.() ?? dateInputRef.current?.click()}
            className={buttonClass("secondary", { className: "relative" })}>
            <svg className="h-4 w-4 text-neutral-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
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
              className={buttonClass("secondary")}>
              วันถัดไป →
            </a>
          )}

          <div className="ml-auto flex gap-2">
            {selectedIds.size > 0 && (
              <a href={`/owner/accounting/daily/receipt?date=${date}&ids=${[...selectedIds].join(",")}`}
                className={buttonClass("primary", { size: "sm" })}>
                สร้างใบรับรอง ({selectedIds.size})
              </a>
            )}
            <button onClick={exportCsv} disabled={entries.length === 0}
              className={buttonClass("secondary")}>
              ดาวน์โหลด Excel
            </button>
            <button onClick={() => window.print()}
              className={buttonClass("secondary")}>
              พิมพ์
            </button>
            {pending.length > 0 && (
              <button onClick={handleSave} disabled={isPending}
                className={buttonClass("primary")}>
                {isPending ? "กำลังบันทึก..." : `บันทึก (${pending.length} รายการ)`}
              </button>
            )}
            {capexNotice && <div className="basis-full">{capexNotice}</div>}
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
                  <td className="py-1.5 px-4 text-right tabular-nums">{fmt(g.buckets.cash) || "–"}</td>
                  <td className="py-1.5 pl-4 text-right tabular-nums">{fmt(g.buckets.transfer) || "–"}</td>
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
              {printAccrual > 0 && (
                <tr className="border-t border-neutral-200 text-neutral-500">
                  <td className="py-1.5 pr-6 text-sm">
                    ไม่รวมรายการที่ไม่ต้องจ่าย {printAccrualCount} รายการ (GP/ส่วนลด/ยอดรายเดือน)
                  </td>
                  <td colSpan={2} className="py-1.5 pl-4 text-right tabular-nums text-sm">{fmt(printAccrual)}</td>
                </tr>
              )}
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
                <tr className={TH_ROW}>
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
                      <tr key={e.id} className="border-t border-amber-100 bg-pending-soft/50">
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleEntry(e)} className="cursor-pointer" />
                        </td>
                        <td className="px-3 py-2 text-neutral-500 text-xs">{entryNum}</td>
                        <td className="px-1.5 py-1.5 w-40">
                          <SupplierAutocomplete value={editing.supplierId}
                            onChange={(id) => setEditing({ ...editing, supplierId: id })}
                            suppliers={suppliers} />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input type="text" value={editing.detail}
                            onChange={(ev) => setEditing({ ...editing, detail: ev.target.value })}
                            placeholder="รายละเอียด..."
                            className="w-full rounded border border-pending/60 px-2 py-1 text-sm focus:outline-none focus:border-amber-500" autoFocus />
                          {/* An edited entry is asked the same question as a new one. */}
                          {editingIsCapex && (
                            <p className="mt-1 text-[11px] leading-snug text-pending-ink">{capexWarningText(capexThreshold)}</p>
                          )}
                        </td>
                        <td className="px-1.5 py-1.5">
                          <SearchableSelect value={editing.coaCode}
                            onChange={(code) => setEditing({ ...editing, coaCode: code })}
                            leafCoa={leafCoa} groups={groups} />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input type="text" inputMode="decimal" placeholder="0" value={editing.amountCash}
                            onChange={(ev) => setEditing({ ...editing, amountCash: ev.target.value.replace(/[^0-9.]/g, "") })}
                            className="w-full rounded border border-pending/60 px-2 py-1 text-sm text-right tabular-nums focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input type="text" inputMode="decimal" placeholder="0" value={editing.amountTransfer}
                            onChange={(ev) => setEditing({ ...editing, amountTransfer: ev.target.value.replace(/[^0-9.]/g, "") })}
                            className="w-full rounded border border-pending/60 px-2 py-1 text-sm text-right tabular-nums focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <div className="flex gap-1">
                            <button onClick={handleUpdate} disabled={isPending}
                              className={buttonClass("primary", { size: "sm" })}>บันทึก</button>
                            <button onClick={() => setEditing(null)}
                              className={buttonClass("secondary", { size: "sm" })}>ยกเลิก</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={e.id} className={`border-t border-neutral-100 group ${selectedIds.has(e.id) ? "bg-primary-soft/70" : isEven ? "bg-neutral-50/60 hover:bg-neutral-100/60" : "bg-white hover:bg-neutral-50"}`}>
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleEntry(e)} className="cursor-pointer" />
                        </td>
                        <td className="px-3 py-2 text-neutral-500 text-xs">{entryNum}</td>
                        <td className="px-3 py-2 text-xs text-neutral-500 truncate max-w-[10rem]">
                          {e.supplier_name ? (
                            <span className="font-medium text-neutral-700">{e.supplier_name}</span>
                          ) : "–"}
                        </td>
                        <td className="px-3 py-2 text-neutral-700 text-sm">{e.detail || e.note || "–"}</td>
                        <td className="px-3 py-2 text-xs">
                          <span className="text-neutral-500">{e.group_name?.replace(/\s*\(.*\)/, "")} › </span>
                          <span className="text-neutral-600">{e.coa_name}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-800">{e.payment_method === "cash" ? fmt(e.amount) : ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-800">{e.payment_method === "transfer" ? fmt(e.amount) : ""}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={() => startEdit(e)}
                            className={buttonClass("secondary", { size: "sm" })}>แก้ไข</button>
                          <button onClick={() => handleDelete(e.id)} disabled={isPending}
                            className={buttonClass("link", { size: "sm", dangerHover: true, className: "ml-3" })}>ลบ</button>
                        </td>
                      </tr>
                    );

                    const pendingRows = pendingHere.map((r, pi) => (
                      <tr key={r.id} className="border-t border-blue-100 bg-info-soft/30">
                        <td className="px-2 py-2" />
                        <td className="px-3 py-2 text-neutral-500 text-xs">{entryNum + 1 + pi}</td>
                        <td className="px-1.5 py-1.5 w-40">
                          <SupplierAutocomplete value={r.supplierId} onChange={(id) => updateRow(r.id, "supplierId", id)} suppliers={suppliers} />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <input type="text" placeholder="รายละเอียด..." value={r.detail}
                            onChange={(ev) => updateRow(r.id, "detail", ev.target.value)}
                            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-info/30 focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5 w-36">
                          <SearchableSelect value={r.coaCode} onChange={(code) => updateRow(r.id, "coaCode", code)} leafCoa={leafCoa} groups={groups} />
                        </td>
                        <td className="px-1.5 py-1.5 w-24">
                          <input type="text" inputMode="decimal" placeholder="0" value={r.amountCash}
                            onChange={(ev) => updateRow(r.id, "amountCash", ev.target.value.replace(/[^0-9.]/g, ""))}
                            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-info/30 focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5 w-24">
                          <input type="text" inputMode="decimal" placeholder="0" value={r.amountTransfer}
                            onChange={(ev) => updateRow(r.id, "amountTransfer", ev.target.value.replace(/[^0-9.]/g, ""))}
                            className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-info/30 focus:outline-none" />
                        </td>
                        <td className="px-1.5 py-1.5">
                          <button onClick={() => removeRow(r.id)}
                            className={buttonClass("link", { size: "sm", dangerHover: true })}>ลบ</button>
                        </td>
                      </tr>
                    ));

                    const insertStrip = !isLast ? (
                      <tr key={`ins-${i}`} className="group/ins">
                        <td colSpan={8} className="px-0 py-0">
                          <div className="relative flex items-center justify-center" style={{ height: "20px" }}>
                            <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-neutral-200 group-hover/ins:bg-primary/40 transition-colors" />
                            <button type="button" onClick={() => insertRowAfter(i)} title="แทรกรายการ"
                              className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs font-bold text-neutral-500 shadow-sm opacity-50 group-hover/ins:opacity-100 hover:border-primary/40 hover:bg-primary-soft hover:text-primary active:bg-primary-soft transition-all">
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
                  <tr key={r.id} className="border-t border-blue-100 bg-info-soft/30">
                    <td className="px-2 py-2" />
                    <td className="px-3 py-2 text-neutral-500 text-xs">{
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
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm focus:border-info/30 focus:outline-none" />
                    </td>
                    <td className="px-1.5 py-1.5 w-36">
                      <SearchableSelect value={r.coaCode} onChange={(code) => updateRow(r.id, "coaCode", code)} leafCoa={leafCoa} groups={groups} />
                    </td>
                    <td className="px-1.5 py-1.5 w-24">
                      <input type="text" inputMode="decimal" placeholder="0" value={r.amountCash}
                        onChange={(ev) => updateRow(r.id, "amountCash", ev.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-info/30 focus:outline-none" />
                    </td>
                    <td className="px-1.5 py-1.5 w-24">
                      <input type="text" inputMode="decimal" placeholder="0" value={r.amountTransfer}
                        onChange={(ev) => updateRow(r.id, "amountTransfer", ev.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:border-info/30 focus:outline-none" />
                    </td>
                    <td className="px-1.5 py-1.5">
                      <button onClick={() => removeRow(r.id)}
                        className={buttonClass("link", { size: "sm", dangerHover: true })}>ลบ</button>
                    </td>
                  </tr>
                ))}

                {/* Add row */}
                <tr className="border-t border-neutral-100">
                  <td colSpan={8} className="px-3 py-2.5">
                    <button onClick={addRow} className="text-sm font-medium text-success-ink hover:text-success-ink">
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
          <div className="no-print flex flex-wrap items-center gap-3 rounded-lg border border-pending/60 bg-pending-soft px-4 py-3 text-sm">
            <span className="font-medium text-neutral-700">Fix cost</span>
            <input type="text" inputMode="numeric" value={fixCost}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9]/g, "");
                setFixCost(raw);
                localStorage.setItem("daily-fix-cost", raw);
              }}
              className="w-32 rounded border border-neutral-300 bg-white px-3 py-1.5 text-right tabular-nums focus:border-info/30 focus:outline-none" />
            <span className="text-neutral-500">บาท</span>
            <span className="ml-auto text-neutral-500">
              รวมสุทธิ:{" "}
              <span className="font-semibold tabular-nums text-neutral-900">{fmt(savedCash + savedTransfer + fixCostNum)}</span>
            </span>
          </div>
        )}

        {error && <p className="text-sm text-danger no-print">{error}</p>}
        {saveMsg && <p className="text-sm font-medium text-success-ink no-print">{saveMsg}</p>}

        {capexNotice}

        {pending.length > 0 && (
          <div className="flex items-center justify-between no-print">
            <p className="text-xs text-info">แถวสีฟ้า = ยังไม่ได้บันทึก</p>
            <button onClick={handleSave} disabled={isPending}
              className={buttonClass("primary")}>
              {isPending ? "กำลังบันทึก..." : `บันทึก ${pending.length} รายการ`}
            </button>
          </div>
        )}

        {isEmpty && (
          <p className="py-6 text-center text-sm text-neutral-500 no-print">
            ยังไม่มีรายการ — กด &ldquo;+ เพิ่มรายการ&rdquo; เพื่อเริ่มบันทึก
          </p>
        )}
      </div>
    </>
  );
}
