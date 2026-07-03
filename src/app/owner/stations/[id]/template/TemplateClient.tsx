"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Station, StationTemplateRow, IngredientForOrder } from "@/lib/inventory-data";
import {
  addToTemplate,
  removeFromTemplate,
  updateTemplateRow,
  renameGroup,
  reorderTemplateRows,
  bulkMoveGroup,
  copyFromStation,
} from "./actions";

// ─── Sortable row ─────────────────────────────────────────────────────────────

function SortableRow({
  row,
  checked,
  onCheck,
  onUpdate,
  onRemove,
  isPending,
}: {
  row: StationTemplateRow;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onUpdate: (fields: { custom_unit?: string | null; default_qty?: number | null }) => void;
  onRemove: () => void;
  isPending: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const effectiveUnit = row.customUnit ?? row.usageUnit ?? "";
  const [unitVal, setUnitVal] = useState(effectiveUnit);
  const [qtyVal, setQtyVal] = useState(row.defaultQty !== null ? String(row.defaultQty) : "");

  function commitUnit() {
    const val = unitVal.trim() || null;
    if (val !== row.customUnit) onUpdate({ custom_unit: val });
  }
  function commitQty() {
    const parsed = qtyVal.trim() === "" ? null : parseFloat(qtyVal);
    if (parsed !== row.defaultQty) onUpdate({ default_qty: parsed !== null && !isNaN(parsed) ? parsed : null });
  }

  return (
    <tr ref={setNodeRef} style={style} className={`border-b border-neutral-100 last:border-0 ${checked ? "bg-blue-50" : "hover:bg-neutral-50"}`}>
      {/* Drag handle */}
      <td className="px-2 py-2 text-neutral-400 cursor-grab touch-none select-none" {...attributes} {...listeners}>
        ≡
      </td>
      {/* Checkbox */}
      <td className="px-2 py-2">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-300 text-blue-600" />
      </td>
      {/* Name */}
      <td className="px-2 py-2 text-sm text-neutral-800">{row.ingredientName}</td>
      {/* หน่วย */}
      <td className="px-2 py-2">
        <input
          type="text"
          value={unitVal}
          onChange={(e) => setUnitVal(e.target.value)}
          onBlur={commitUnit}
          placeholder={row.usageUnit ?? "หน่วย"}
          className="w-20 rounded border border-neutral-200 px-1.5 py-1 text-xs"
        />
      </td>
      {/* สั่งปกติ */}
      <td className="px-2 py-2">
        <input
          type="number"
          min="0"
          step="any"
          value={qtyVal}
          onChange={(e) => setQtyVal(e.target.value)}
          onBlur={commitQty}
          placeholder="—"
          className="w-16 rounded border border-neutral-200 px-1.5 py-1 text-xs text-right"
        />
      </td>
      {/* Remove */}
      <td className="px-2 py-2">
        <button type="button" onClick={onRemove} disabled={isPending}
          className="text-xs text-red-400 hover:text-red-700 disabled:opacity-40">
          ✕
        </button>
      </td>
    </tr>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function TemplateClient({
  station,
  allStations,
  initialRows,
  availableIngredients,
}: {
  station: Station;
  allStations: Station[];
  initialRows: StationTemplateRow[];
  availableIngredients: IngredientForOrder[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<StationTemplateRow[]>(initialRows);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Add ingredients modal state
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [available, setAvailable] = useState<IngredientForOrder[]>(availableIngredients);

  // Copy from station modal
  const [showCopy, setShowCopy] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");

  // Bulk move group
  const [showBulkGroup, setShowBulkGroup] = useState(false);
  const [bulkGroupName, setBulkGroupName] = useState("");

  // DnD sensors (pointer + touch for mobile)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  // Group rows by custom_group (fallback to ingredientCategory)
  const groups: { key: string | null; label: string; rows: StationTemplateRow[] }[] = [];
  const seen = new Map<string | null, StationTemplateRow[]>();
  for (const r of rows) {
    const key = r.customGroup !== null ? r.customGroup : (r.ingredientCategory ?? null);
    const existing = seen.get(key);
    if (existing) existing.push(r);
    else seen.set(key, [r]);
  }
  for (const [key, groupRows] of seen) {
    groups.push({ key, label: key ?? "ไม่ระบุกลุ่ม", rows: groupRows });
  }

  const checkedCount = checked.size;

  function toggleCheck(id: string, val: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      val ? next.add(id) : next.delete(id);
      return next;
    });
  }

  function handleRemoveSingle(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (!confirm(`เอา "${row.ingredientName}" ออกจาก template?`)) return;
    doRemove([id]);
  }

  function doRemove(ids: string[]) {
    setError(null);
    startTransition(async () => {
      const result = await removeFromTemplate(station.id, ids);
      if (result.error) { setError(result.error); return; }
      setRows((prev) => {
        const removed = prev.filter((r) => ids.includes(r.id));
        setAvailable((a) => [...a, ...removed.map((r) => ({
          id: r.ingredientId, name: r.ingredientName, nameMm: null,
          category: r.ingredientCategory, parLevel: null, safetyNote: null,
          purchaseUnitLabel: r.purchaseUnitLabel, usageUnit: r.usageUnit,
          customGroup: null, customUnit: null, defaultQty: null,
        }))]);
        return prev.filter((r) => !ids.includes(r.id));
      });
      setChecked(new Set());
    });
  }

  function handleUpdateRow(id: string, fields: { custom_unit?: string | null; default_qty?: number | null }) {
    setError(null);
    startTransition(async () => {
      const result = await updateTemplateRow(station.id, id, fields);
      if (result.error) { setError(result.error); return; }
      setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...fields } : r));
    });
  }

  function handleRenameGroup(oldKey: string | null, newName: string) {
    const newGroup = newName.trim() || null;
    if (newGroup === oldKey) return;
    setError(null);
    startTransition(async () => {
      const result = await renameGroup(station.id, oldKey, newGroup);
      if (result.error) { setError(result.error); return; }
      setRows((prev) => prev.map((r) => {
        const key = r.customGroup !== null ? r.customGroup : (r.ingredientCategory ?? null);
        return key === oldKey ? { ...r, customGroup: newGroup } : r;
      }));
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((prev) => {
      const oldIdx = prev.findIndex((r) => r.id === active.id);
      const newIdx = prev.findIndex((r) => r.id === over.id);
      const next = arrayMove(prev, oldIdx, newIdx).map((r, i) => ({ ...r, sortOrder: i }));
      startTransition(async () => {
        await reorderTemplateRows(station.id, next.map((r) => ({ id: r.id, sort_order: r.sortOrder })));
      });
      return next;
    });
  }

  function handleBulkRemove() {
    if (!confirm(`เอา ${checkedCount} รายการออกจาก template?`)) return;
    doRemove([...checked]);
  }

  function handleBulkMove() {
    setShowBulkGroup(true);
    setBulkGroupName("");
  }

  function commitBulkMove() {
    const newGroup = bulkGroupName.trim() || null;
    setError(null);
    startTransition(async () => {
      const result = await bulkMoveGroup(station.id, [...checked], newGroup);
      if (result.error) { setError(result.error); return; }
      setRows((prev) => prev.map((r) => checked.has(r.id) ? { ...r, customGroup: newGroup } : r));
      setChecked(new Set());
      setShowBulkGroup(false);
    });
  }

  function handleAdd() {
    if (addSelected.size === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await addToTemplate(station.id, [...addSelected]);
      if (result.error) { setError(result.error); return; }
      // refresh to get new rows with proper IDs
      router.refresh();
      setShowAdd(false);
      setAddSelected(new Set());
      setAddSearch("");
    });
  }

  function handleCopy() {
    if (!copyFrom) return;
    if (!confirm(`คัดลอก template จากสถานี "${allStations.find((s) => s.id === copyFrom)?.name}"?\n(จะเพิ่มรายการที่ยังไม่มีใน template ปัจจุบัน)`)) return;
    setError(null);
    startTransition(async () => {
      const result = await copyFromStation(station.id, copyFrom);
      if (result.error) { setError(result.error); return; }
      setShowCopy(false);
      router.refresh();
    });
  }

  const filteredAvailable = available.filter((i) =>
    !addSearch.trim() || i.name.toLowerCase().includes(addSearch.trim().toLowerCase())
  );

  return (
    <div className="space-y-4 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <a href="/owner/stations" className="text-sm text-neutral-400 hover:text-neutral-700">← สถานีทั้งหมด</a>
          </div>
          <h1 className="text-lg font-semibold text-neutral-900">Template: {station.name}</h1>
          <p className="text-sm text-neutral-500">{rows.length} รายการ</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => setShowCopy(true)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
            คัดลอกจากสถานีอื่น
          </button>
          <button type="button" onClick={() => setShowAdd(true)}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800">
            + เพิ่มวัตถุดิบ
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Station switcher */}
      <div className="flex gap-1 flex-wrap">
        {allStations.map((s) => (
          <a key={s.id} href={`/owner/stations/${s.id}/template`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              s.id === station.id
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}>
            {s.name}
          </a>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
          ยังไม่มีวัตถุดิบใน template กด "+ เพิ่มวัตถุดิบ" หรือ "คัดลอกจากสถานีอื่น"
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {groups.map(({ key, label, rows: groupRows }) => (
                <div key={String(key)} className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                  {/* Group header */}
                  <div className="flex items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
                    <input
                      type="text"
                      defaultValue={label === "ไม่ระบุกลุ่ม" ? "" : label}
                      placeholder="ชื่อกลุ่ม..."
                      onBlur={(e) => handleRenameGroup(key, e.target.value)}
                      className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-neutral-700 hover:border-neutral-300 focus:border-neutral-400 focus:bg-white focus:outline-none"
                    />
                    <span className="text-xs text-neutral-400">{groupRows.length} รายการ</span>
                  </div>
                  {/* Rows */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-100 text-xs text-neutral-400">
                        <th className="w-6 px-2 py-1"></th>
                        <th className="w-8 px-2 py-1"></th>
                        <th className="px-2 py-1 text-left">วัตถุดิบ</th>
                        <th className="px-2 py-1 text-left">หน่วย</th>
                        <th className="px-2 py-1 text-right">สั่งปกติ</th>
                        <th className="w-8 px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupRows.map((row) => (
                        <SortableRow
                          key={row.id}
                          row={row}
                          checked={checked.has(row.id)}
                          onCheck={(v) => toggleCheck(row.id, v)}
                          onUpdate={(fields) => handleUpdateRow(row.id, fields)}
                          onRemove={() => handleRemoveSingle(row.id)}
                          isPending={isPending}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* ─── Floating bulk action bar ───────────────────────────────── */}
      {checkedCount >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-neutral-200 bg-white px-5 py-3 shadow-xl text-sm">
          <span className="font-medium text-neutral-700">เลือก {checkedCount} รายการ</span>
          <button type="button" onClick={handleBulkMove}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
            ย้ายไปกลุ่มอื่น
          </button>
          <button type="button" onClick={handleBulkRemove} disabled={isPending}
            className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50">
            เอาออก
          </button>
          <button type="button" onClick={() => setChecked(new Set())}
            className="text-xs text-neutral-400 hover:text-neutral-700">
            ยกเลิก
          </button>
        </div>
      )}

      {/* ─── Bulk move group modal ──────────────────────────────────── */}
      {showBulkGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-4">
            <h2 className="font-semibold text-neutral-800">ย้ายไปกลุ่ม</h2>
            <input
              type="text"
              autoFocus
              placeholder="ชื่อกลุ่มใหม่ (เว้นว่าง = ไม่ระบุกลุ่ม)"
              value={bulkGroupName}
              onChange={(e) => setBulkGroupName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitBulkMove()}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowBulkGroup(false)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
                ยกเลิก
              </button>
              <button type="button" onClick={commitBulkMove} disabled={isPending}
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
                ย้าย
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add ingredients modal ──────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col max-h-[80vh]">
            <div className="border-b border-neutral-100 p-4 space-y-3">
              <h2 className="font-semibold text-neutral-800">เพิ่มวัตถุดิบ</h2>
              <input
                type="text"
                autoFocus
                placeholder="ค้นหาชื่อวัตถุดิบ..."
                value={addSearch}
                onChange={(e) => setAddSearch(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
              {addSelected.size > 0 && (
                <p className="text-xs text-blue-600">เลือกแล้ว {addSelected.size} รายการ</p>
              )}
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-neutral-100">
              {filteredAvailable.length === 0 ? (
                <p className="p-4 text-sm text-neutral-400 text-center">ไม่พบรายการ</p>
              ) : (
                filteredAvailable.map((ing) => (
                  <label key={ing.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-neutral-50">
                    <input
                      type="checkbox"
                      checked={addSelected.has(ing.id)}
                      onChange={(e) => setAddSelected((prev) => {
                        const next = new Set(prev);
                        e.target.checked ? next.add(ing.id) : next.delete(ing.id);
                        return next;
                      })}
                      className="h-4 w-4 rounded border-neutral-300 text-blue-600"
                    />
                    <div>
                      <p className="text-sm text-neutral-800">{ing.name}</p>
                      {ing.category && <p className="text-xs text-neutral-400">{ing.category}</p>}
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="border-t border-neutral-100 p-4 flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowAdd(false); setAddSelected(new Set()); setAddSearch(""); }}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
                ยกเลิก
              </button>
              <button type="button" onClick={handleAdd} disabled={isPending || addSelected.size === 0}
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
                {isPending ? "กำลังเพิ่ม..." : `เพิ่ม ${addSelected.size} รายการ`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Copy from station modal ────────────────────────────────── */}
      {showCopy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-4">
            <h2 className="font-semibold text-neutral-800">คัดลอกจากสถานีอื่น</h2>
            <p className="text-sm text-neutral-500">เลือกสถานีต้นทาง — รายการที่ยังไม่มีใน template นี้จะถูกเพิ่มเข้ามา</p>
            <select
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">— เลือกสถานี —</option>
              {allStations.filter((s) => s.id !== station.id).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowCopy(false); setCopyFrom(""); }}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100">
                ยกเลิก
              </button>
              <button type="button" onClick={handleCopy} disabled={isPending || !copyFrom}
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
                {isPending ? "กำลังคัดลอก..." : "คัดลอก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
