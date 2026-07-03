"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  createIngredient,
  deleteCategory,
  deleteIngredient,
  getIngredientHistory,
  updateIngredient,
  type IngredientFields,
  type PriceHistoryEntry,
} from "@/app/owner/ingredients/actions";
import { CategorySelect } from "@/components/category-select";
import { Plus, Save, Search, ChevronLeft, ChevronRight } from "lucide-react";

export type UsageMap = Record<string, { menus: { id: string; name: string }[]; preps: { id: string; name: string }[] }>;

export type IngredientRow = {
  id: string;
  name: string;
  category: string | null;
  purchase_unit_label: string | null;
  purchase_cost: number | null;
  receive_qty: number;
  yield_qty: number | null;
  usage_unit: string | null;
  par_level: number | null;
};

function formatBaht(n: number | null) {
  if (n == null) return "-";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emptyForm(): IngredientFields {
  return {
    name: "",
    category: "",
    purchase_unit_label: "",
    purchase_cost: null,
    receive_qty: 1,
    yield_qty: null,
    usage_unit: "",
  };
}

function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  className = "",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  className?: string;
}) {
  return (
    <input
      type="text"
      inputMode="decimal"
      value={value ?? ""}
      onChange={(e) => {
        const sanitized = sanitizeDecimal(e.target.value);
        onChange(sanitized === "" ? null : Number(sanitized));
      }}
      className={`rounded-md border border-neutral-300 px-2 py-1.5 text-sm ${className}`}
    />
  );
}

const PAGE_SIZE = 25;

export function IngredientManager({
  ingredients,
  unitCosts,
  usageMap = {},
  submitMode = "save",
}: {
  ingredients: IngredientRow[];
  unitCosts: Record<string, number | null>;
  usageMap?: UsageMap;
  submitMode?: "save" | "pending";
}) {
  const [rows, setRows] = useState(ingredients);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("ทั้งหมด");
  const [newForm, setNewForm] = useState<IngredientFields>(emptyForm());
  const [showNewForm, setShowNewForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowStatus, setRowStatus] = useState<Record<string, "saved" | "pending">>({});
  const [newFormPending, setNewFormPending] = useState(false);

  const knownCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.category) set.add(r.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "th"));
  }, [rows]);

  const filterOptions = useMemo(() => ["ทั้งหมด", "ไม่มีหมวด", ...knownCategories], [knownCategories]);

  const filtered = rows.filter((r) => {
    const cat = r.category ?? "ไม่มีหมวด";
    if (filterCategory !== "ทั้งหมด" && cat !== filterCategory) return false;
    if (search.trim() && !r.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  // Reset to page 0 whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [search, filterCategory]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function patchRow(id: string, patch: Partial<IngredientRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function saveRow(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setError(null);
    setRowStatus((prev) => { const next = { ...prev }; delete next[id]; return next; });
    startTransition(async () => {
      try {
        const result = await updateIngredient(id, row.name, {
          name: row.name,
          category: row.category,
          purchase_unit_label: row.purchase_unit_label,
          purchase_cost: row.purchase_cost,
          receive_qty: row.receive_qty,
          yield_qty: row.yield_qty,
          usage_unit: row.usage_unit,
          par_level: row.par_level,
        });
        setRowStatus((prev) => ({ ...prev, [id]: result.status }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function removeRow(id: string, name: string) {
    const confirmMsg = submitMode === "pending"
      ? `ส่งขอลบวัตถุดิบ "${name}" เพื่อรอ Admin อนุมัติ?`
      : `ลบวัตถุดิบ "${name}" แน่ใจหรือไม่? ลบแล้วกู้คืนไม่ได้`;
    if (!confirm(confirmMsg)) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteIngredient(id, name);
        if (result.status === "saved") {
          setRows((prev) => prev.filter((r) => r.id !== id));
        } else {
          setRowStatus((prev) => ({ ...prev, [id]: "pending" }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }

  function submitNew() {
    if (!newForm.name.trim()) {
      setError("กรุณาใส่ชื่อวัตถุดิบ");
      return;
    }
    setError(null);
    setNewFormPending(false);
    startTransition(async () => {
      try {
        const result = await createIngredient(newForm.name, newForm);
        if (result.status === "pending") {
          setNewFormPending(true);
          setNewForm(emptyForm());
          setShowNewForm(false);
          return;
        }
        setNewForm(emptyForm());
        setShowNewForm(false);
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "เพิ่มไม่สำเร็จ");
      }
    });
  }

  const PaginationControls = () =>
    totalPages > 1 ? (
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
          ก่อนหน้า
        </button>
        <span className="text-sm text-neutral-500">
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages - 1}
          onClick={() => setPage((p) => p + 1)}
          className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
        >
          ถัดไป
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="พิมพ์ค้นหาชื่อวัตถุดิบ..."
              className="w-full rounded-md border border-neutral-300 py-2 pl-9 pr-3 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm sm:w-48"
            >
              {filterOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {filterCategory !== "ทั้งหมด" && filterCategory !== "ไม่มีหมวด" && (
              <button
                type="button"
                onClick={() => {
                  const count = rows.filter((r) => r.category === filterCategory).length;
                  if (!confirm(`ลบหมวด "${filterCategory}" และเอา ${count} รายการออกจากหมวดนี้?\n(วัตถุดิบยังอยู่ในระบบ แค่ไม่มีหมวด)`)) return;
                  startTransition(async () => {
                    try {
                      await deleteCategory(filterCategory);
                      setRows((prev) => prev.map((r) => r.category === filterCategory ? { ...r, category: null } : r));
                      setFilterCategory("ทั้งหมด");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "ลบหมวดไม่สำเร็จ");
                    }
                  });
                }}
                className="shrink-0 rounded-md border border-red-300 px-2.5 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                ลบหมวดนี้
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-3 py-2 text-sm font-medium text-white hover:bg-brand-green/90"
            onClick={() => { setShowNewForm((v) => !v); setNewFormPending(false); }}
          >
            {showNewForm ? "ยกเลิก" : <><Plus className="h-4 w-4" />เพิ่มวัตถุดิบใหม่</>}
          </button>
          {newFormPending && <p className="text-xs text-amber-600">⏳ ส่งขออนุมัติแล้ว — รอ Admin ตรวจสอบ</p>}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* New ingredient form */}
      {showNewForm && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-4">
          <Field label="ชื่อวัตถุดิบ *">
            <input
              value={newForm.name}
              onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="หมวด">
            <CategorySelect
              value={newForm.category ?? ""}
              categories={knownCategories}
              onChange={(v) => setNewForm((f) => ({ ...f, category: v }))}
            />
          </Field>
          <Field label="หน่วยซื้อ (เช่น ลัง(20ถุง))">
            <input
              value={newForm.purchase_unit_label ?? ""}
              onChange={(e) => setNewForm((f) => ({ ...f, purchase_unit_label: e.target.value }))}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <Field label="ราคาซื้อ ต่อหน่วยซื้อ (บาท)">
            <NumberInput
              value={newForm.purchase_cost}
              onChange={(v) => setNewForm((f) => ({ ...f, purchase_cost: v }))}
              className="w-full"
            />
          </Field>
          <Field label="จำนวนรับ (กี่หน่วยซื้อ)">
            <NumberInput
              value={newForm.receive_qty}
              onChange={(v) => setNewForm((f) => ({ ...f, receive_qty: v ?? 1 }))}
              className="w-full"
            />
          </Field>
          <Field label="จำนวนตัดแต่ง / yield (รวมเป็นหน่วยใช้จริง)">
            <NumberInput
              value={newForm.yield_qty}
              onChange={(v) => setNewForm((f) => ({ ...f, yield_qty: v }))}
              className="w-full"
            />
          </Field>
          <Field label="หน่วยใช้จริง (เช่น กรัม)">
            <input
              value={newForm.usage_unit ?? ""}
              onChange={(e) => setNewForm((f) => ({ ...f, usage_unit: e.target.value }))}
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              disabled={isPending}
              onClick={submitNew}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {submitMode === "pending" ? "ส่งขออนุมัติ" : "บันทึกวัตถุดิบใหม่"}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-neutral-400">
        พบ {filtered.length} รายการ (จากทั้งหมด {rows.length})
        {totalPages > 1 && ` — หน้า ${page + 1} / ${totalPages}`}
      </p>

      {/* ── Desktop table ─────────────────────────────────────────── */}
      <div className="hidden md:block overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              <th className="px-2 py-2">ชื่อ</th>
              <th className="px-2 py-2">หมวด</th>
              <th className="px-2 py-2">หน่วยซื้อ</th>
              <th className="px-2 py-2">ราคาซื้อ</th>
              <th className="px-2 py-2">จำนวนรับ</th>
              <th className="px-2 py-2">จำนวนตัดแต่ง</th>
              <th className="px-2 py-2">หน่วยใช้จริง</th>
              <th className="px-2 py-2 text-right">ต้นทุน/หน่วยใช้จริง</th>
              <th className="px-2 py-2 text-right">Par</th>
              <th className="px-2 py-2"></th>
              <th className="px-2 py-2"></th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const usage = usageMap[row.id];
              const usageCount = (usage?.menus.length ?? 0) + (usage?.preps.length ?? 0);
              const isIncomplete = row.purchase_cost == null || !row.usage_unit?.trim();
              return (
                <>
                  <tr
                    key={row.id}
                    className={`border-b border-neutral-100 last:border-0 transition-colors ${isIncomplete ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-brand-green/5"}`}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        value={row.name}
                        onChange={(e) => patchRow(row.id, { name: e.target.value })}
                        className="w-36 rounded border border-neutral-200 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5 min-w-[140px]">
                      <CategorySelect
                        value={row.category ?? ""}
                        categories={knownCategories}
                        onChange={(v) => {
                          patchRow(row.id, { category: v });
                          startTransition(async () => {
                            try {
                              const result = await updateIngredient(row.id, row.name, { category: v });
                              setRowStatus((prev) => ({ ...prev, [row.id]: result.status }));
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
                            }
                          });
                        }}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={row.purchase_unit_label ?? ""}
                        onChange={(e) => patchRow(row.id, { purchase_unit_label: e.target.value })}
                        className="w-28 rounded border border-neutral-200 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput
                        value={row.purchase_cost}
                        onChange={(v) => patchRow(row.id, { purchase_cost: v })}
                        className="w-20"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput
                        value={row.receive_qty}
                        onChange={(v) => patchRow(row.id, { receive_qty: v ?? 1 })}
                        className="w-16"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput
                        value={row.yield_qty}
                        onChange={(v) => patchRow(row.id, { yield_qty: v })}
                        className="w-20"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={row.usage_unit ?? ""}
                        onChange={(e) => patchRow(row.id, { usage_unit: e.target.value })}
                        className="w-20 rounded border border-neutral-200 px-1.5 py-1"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-neutral-500">
                      {formatBaht(unitCosts[row.id] ?? null)}
                    </td>
                    <td className="px-2 py-1.5">
                      <NumberInput
                        value={row.par_level}
                        onChange={(v) => patchRow(row.id, { par_level: v })}
                        className="w-16 text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <div className="flex flex-col items-end gap-0.5">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => saveRow(row.id)}
                          className="inline-flex items-center gap-1 rounded bg-brand-green px-2 py-1 text-xs text-white hover:bg-brand-green/90 disabled:opacity-50"
                        >
                          <Save className="h-3 w-3" />
                          {submitMode === "pending" ? "ส่งขออนุมัติ" : "บันทึก"}
                        </button>
                        {rowStatus[row.id] === "saved" && <span className="text-xs text-green-600">✓ บันทึกสำเร็จ</span>}
                        {rowStatus[row.id] === "pending" && <span className="text-xs text-amber-600">⏳ ส่งแล้ว</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                        className="whitespace-nowrap text-xs text-neutral-500 underline hover:text-neutral-800"
                      >
                        {expandedId === row.id ? "ปิด" : `ใช้ใน ${usageCount} จุด / ประวัติ`}
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => removeRow(row.id, row.name)}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr className="border-b border-neutral-100 bg-neutral-50">
                      <td colSpan={11} className="px-4 py-3">
                        <IngredientDetail ingredientId={row.id} usage={usage} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile cards ──────────────────────────────────────────── */}
      <div className="space-y-3 md:hidden">
        {pageRows.map((row) => {
          const usage = usageMap[row.id];
          const usageCount = (usage?.menus.length ?? 0) + (usage?.preps.length ?? 0);
          const isIncomplete = row.purchase_cost == null || !row.usage_unit?.trim();
          return (
            <div
              key={row.id}
              className={`rounded-lg border border-neutral-200 p-3 shadow-sm ${isIncomplete ? "bg-amber-50" : "bg-white"}`}
            >
              {/* Row 1: Name + Category */}
              <div className="mb-2 flex gap-2">
                <input
                  value={row.name}
                  onChange={(e) => patchRow(row.id, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm font-medium"
                />
                <div className="w-32 shrink-0">
                  <CategorySelect
                    value={row.category ?? ""}
                    categories={knownCategories}
                    onChange={(v) => {
                      patchRow(row.id, { category: v });
                      startTransition(async () => {
                        try {
                          const result = await updateIngredient(row.id, row.name, { category: v });
                          setRowStatus((prev) => ({ ...prev, [row.id]: result.status }));
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
                        }
                      });
                    }}
                  />
                </div>
              </div>

              {/* Row 2: หน่วยซื้อ + ราคาซื้อ */}
              <div className="mb-2 grid grid-cols-2 gap-2">
                <label className="block space-y-0.5">
                  <span className="text-xs text-neutral-500">หน่วยซื้อ</span>
                  <input
                    value={row.purchase_unit_label ?? ""}
                    onChange={(e) => patchRow(row.id, { purchase_unit_label: e.target.value })}
                    className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-xs text-neutral-500">ราคาซื้อ (บาท)</span>
                  <NumberInput
                    value={row.purchase_cost}
                    onChange={(v) => patchRow(row.id, { purchase_cost: v })}
                    className="w-full"
                  />
                </label>
              </div>

              {/* Row 3: จำนวนรับ + ตัดแต่ง + หน่วยใช้จริง */}
              <div className="mb-2 grid grid-cols-3 gap-2">
                <label className="block space-y-0.5">
                  <span className="text-xs text-neutral-500">จำนวนรับ</span>
                  <NumberInput
                    value={row.receive_qty}
                    onChange={(v) => patchRow(row.id, { receive_qty: v ?? 1 })}
                    className="w-full"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-xs text-neutral-500">ตัดแต่ง</span>
                  <NumberInput
                    value={row.yield_qty}
                    onChange={(v) => patchRow(row.id, { yield_qty: v })}
                    className="w-full"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-xs text-neutral-500">หน่วยใช้จริง</span>
                  <input
                    value={row.usage_unit ?? ""}
                    onChange={(e) => patchRow(row.id, { usage_unit: e.target.value })}
                    className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </div>

              {/* Computed cost */}
              <p className="mb-2 text-xs text-neutral-500">
                ต้นทุน/หน่วยใช้จริง:{" "}
                <span className="font-medium tabular-nums text-neutral-700">
                  {formatBaht(unitCosts[row.id] ?? null)} บาท
                </span>
              </p>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => saveRow(row.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {submitMode === "pending" ? "ส่งขออนุมัติ" : "บันทึก"}
                </button>
                {rowStatus[row.id] === "saved" && <span className="text-xs text-green-600">✓ บันทึกสำเร็จ</span>}
                {rowStatus[row.id] === "pending" && <span className="text-xs text-amber-600">⏳ ส่งขออนุมัติแล้ว</span>}
                <button
                  type="button"
                  onClick={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                  className="text-xs text-neutral-500 underline hover:text-neutral-800"
                >
                  {expandedId === row.id ? "ปิดรายละเอียด" : `ใช้ใน ${usageCount} จุด / ประวัติ`}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => removeRow(row.id, row.name)}
                  className="ml-auto text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  ลบ
                </button>
              </div>

              {/* Expandable detail */}
              {expandedId === row.id && (
                <div className="mt-3 rounded-md bg-neutral-50 p-3">
                  <IngredientDetail ingredientId={row.id} usage={usage} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <PaginationControls />
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function IngredientDetail({
  ingredientId,
  usage,
}: {
  ingredientId: string;
  usage?: { menus: { id: string; name: string }[]; preps: { id: string; name: string }[] };
}) {
  const [history, setHistory] = useState<PriceHistoryEntry[] | null>(null);

  useEffect(() => {
    getIngredientHistory(ingredientId).then(setHistory);
  }, [ingredientId]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="mb-1 text-xs font-medium text-neutral-500">ใช้ในเมนู ({usage?.menus.length ?? 0})</p>
        <ul className="space-y-0.5 text-sm">
          {(usage?.menus ?? []).map((m) => (
            <li key={m.id}>
              <Link href={`/staff/menu/${m.id}`} className="text-blue-600 hover:underline">
                {m.name}
              </Link>
            </li>
          ))}
          {!usage?.menus.length && <li className="text-neutral-400">ไม่มี</li>}
        </ul>
        <p className="mt-3 mb-1 text-xs font-medium text-neutral-500">ใช้ในของเตรียม ({usage?.preps.length ?? 0})</p>
        <ul className="space-y-0.5 text-sm">
          {(usage?.preps ?? []).map((p) => (
            <li key={p.id}>
              <Link href={`/staff/prep/${p.id}`} className="text-blue-600 hover:underline">
                {p.name}
              </Link>
            </li>
          ))}
          {!usage?.preps.length && <li className="text-neutral-400">ไม่มี</li>}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-neutral-500">ประวัติการแก้ราคา (ล่าสุด 20 ครั้ง)</p>
        {history == null ? (
          <p className="text-sm text-neutral-400">กำลังโหลด...</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-neutral-400">ยังไม่มีประวัติการแก้ไข</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {history.map((h) => (
              <li key={h.id} className="border-b border-neutral-200 pb-1 last:border-0">
                <span className="text-neutral-400">{formatDate(h.changedAt)}</span> โดย{" "}
                <span className="font-medium">{h.changedByName}</span>
                <div className="text-neutral-600">
                  ราคาซื้อ: {h.oldPurchaseCost ?? "-"} → {h.newPurchaseCost ?? "-"} บาท
                  {(h.oldReceiveQty !== h.newReceiveQty || h.oldYieldQty !== h.newYieldQty) && (
                    <>
                      {" "}| จำนวนรับ: {h.oldReceiveQty ?? "-"} → {h.newReceiveQty ?? "-"} | ตัดแต่ง:{" "}
                      {h.oldYieldQty ?? "-"} → {h.newYieldQty ?? "-"}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
