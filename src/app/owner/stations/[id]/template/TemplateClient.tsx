"use client";

import { useState, useTransition } from "react";
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

type UpdateFields = {
  custom_unit?: string | null;
  default_qty?: number | null;
  kitchen_unit?: string | null;
  freezer_unit?: string | null;
};

function SortableRow({
  row,
  index,
  checked,
  onCheck,
  onUpdate,
  onRemove,
  isPending,
}: {
  row: StationTemplateRow;
  index: number;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onUpdate: (fields: UpdateFields) => void;
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

  const [unitVal, setUnitVal] = useState(row.customUnit ?? row.usageUnit ?? "");
  const [qtyVal, setQtyVal] = useState(row.defaultQty !== null ? String(row.defaultQty) : "");
  const [kitchenUnitVal, setKitchenUnitVal] = useState(row.kitchenUnit ?? "");
  const [freezerUnitVal, setFreezerUnitVal] = useState(row.freezerUnit ?? "");

  function commitUnit() {
    const val = unitVal.trim() || null;
    if (val !== row.customUnit) onUpdate({ custom_unit: val });
  }
  function commitQty() {
    const parsed = qtyVal.trim() === "" ? null : parseFloat(qtyVal);
    const clean = parsed !== null && !isNaN(parsed) ? parsed : null;
    if (clean !== row.defaultQty) onUpdate({ default_qty: clean });
  }
  function commitKitchenUnit() {
    const val = kitchenUnitVal.trim() || null;
    if (val !== row.kitchenUnit) onUpdate({ kitchen_unit: val });
  }
  function commitFreezerUnit() {
    const val = freezerUnitVal.trim() || null;
    if (val !== row.freezerUnit) onUpdate({ freezer_unit: val });
  }

  const inputCls = "rounded border border-neutral-200 px-1.5 py-1 text-xs w-14";

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b border-neutral-100 last:border-0 transition-colors ${
        checked
          ? "bg-blue-50"
          : index % 2 === 0
          ? "bg-white hover:bg-neutral-100"
          : "bg-neutral-100 hover:bg-neutral-200"
      }`}
    >
      {/* Drag handle */}
      <td
        className="px-2 py-2 text-neutral-400 cursor-grab touch-none select-none"
        {...attributes}
        {...listeners}
      >
        ≡
      </td>
      {/* Checkbox */}
      <td className="px-2 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-300 text-blue-600"
        />
      </td>
      {/* Name */}
      <td className="px-2 py-2 text-sm text-neutral-800 min-w-[100px]">{row.ingredientName}</td>
      {/* หน่วยสั่ง */}
      <td className="px-2 py-2">
        <input
          type="text"
          value={unitVal}
          onChange={(e) => setUnitVal(e.target.value)}
          onBlur={commitUnit}
          placeholder={row.usageUnit ?? "หน่วย"}
          className={inputCls}
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
          className="rounded border border-neutral-200 px-1.5 py-1 text-xs w-14 text-right"
        />
      </td>
      {/* หน่วยครัว */}
      <td className="px-2 py-2">
        <input
          type="text"
          value={kitchenUnitVal}
          onChange={(e) => setKitchenUnitVal(e.target.value)}
          onBlur={commitKitchenUnit}
          placeholder={row.usageUnit ?? "หน่วย"}
          className={inputCls}
        />
      </td>
      {/* หน่วยตู้แช่ */}
      <td className="px-2 py-2">
        <input
          type="text"
          value={freezerUnitVal}
          onChange={(e) => setFreezerUnitVal(e.target.value)}
          onBlur={commitFreezerUnit}
          placeholder={row.usageUnit ?? "หน่วย"}
          className={inputCls}
        />
      </td>
      {/* Remove */}
      <td className="px-2 py-2">
        <button
          type="button"
          onClick={onRemove}
          disabled={isPending}
          className="text-xs text-red-400 hover:text-red-700 disabled:opacity-40"
        >
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
  stationBaseHref,
  stationHrefSuffix,
  backHref,
}: {
  station: Station;
  allStations: Station[];
  initialRows: StationTemplateRow[];
  availableIngredients: IngredientForOrder[];
  stationBaseHref: string;
  stationHrefSuffix: string;
  backHref: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<StationTemplateRow[]>(initialRows);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Add ingredients modal
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [available, setAvailable] = useState<IngredientForOrder[]>(availableIngredients);

  // Copy from station modal
  const [showCopy, setShowCopy] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");

  // Bulk move group modal
  const [showBulkGroup, setShowBulkGroup] = useState(false);
  const [bulkGroupName, setBulkGroupName] = useState("");

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
    const removed = rows.filter((r) => ids.includes(r.id));
    // Optimistic remove
    setRows((prev) => prev.filter((r) => !ids.includes(r.id)));
    setAvailable((a) => [
      ...a,
      ...removed.map((r) => ({
        id: r.ingredientId,
        name: r.ingredientName,
        nameMm: null,
        category: r.ingredientCategory,
        parLevel: null,
        safetyNote: null,
        purchaseUnitLabel: r.purchaseUnitLabel,
        usageUnit: r.usageUnit,
        customGroup: null,
        customUnit: null,
        defaultQty: null,
        kitchenUnit: null,
        freezerUnit: null,
      })),
    ]);
    setChecked(new Set());
    startTransition(async () => {
      const result = await removeFromTemplate(station.id, ids);
      if (result.error) {
        setError(result.error);
        // Revert
        setRows((prev) => [...prev, ...removed]);
        setAvailable((prev) => prev.filter((a) => !removed.some((r) => r.ingredientId === a.id)));
      }
    });
  }

  function handleUpdateRow(id: string, fields: UpdateFields) {
    setError(null);
    startTransition(async () => {
      const result = await updateTemplateRow(station.id, id, fields);
      if (result.error) { setError(result.error); return; }
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          return {
            ...r,
            ...(fields.custom_unit !== undefined ? { customUnit: fields.custom_unit } : {}),
            ...(fields.default_qty !== undefined ? { defaultQty: fields.default_qty } : {}),
            ...(fields.kitchen_unit !== undefined ? { kitchenUnit: fields.kitchen_unit } : {}),
            ...(fields.freezer_unit !== undefined ? { freezerUnit: fields.freezer_unit } : {}),
          };
        })
      );
    });
  }

  function handleRenameGroup(oldKey: string | null, newName: string) {
    const newGroup = newName.trim() || null;
    if (newGroup === oldKey) return;
    setError(null);
    // Optimistic
    setRows((prev) =>
      prev.map((r) => {
        const key = r.customGroup !== null ? r.customGroup : (r.ingredientCategory ?? null);
        return key === oldKey ? { ...r, customGroup: newGroup } : r;
      })
    );
    startTransition(async () => {
      const result = await renameGroup(station.id, oldKey, newGroup);
      if (result.error) setError(result.error);
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
    // Optimistic
    setRows((prev) => prev.map((r) => checked.has(r.id) ? { ...r, customGroup: newGroup } : r));
    setChecked(new Set());
    setShowBulkGroup(false);
    startTransition(async () => {
      const result = await bulkMoveGroup(station.id, [...checked], newGroup);
      if (result.error) setError(result.error);
    });
  }

  function handleAdd() {
    if (addSelected.size === 0) return;
    const selectedIngIds = [...addSelected];
    setError(null);

    // Build optimistic rows immediately
    const optimisticRows: StationTemplateRow[] = selectedIngIds.map((id, i) => {
      const ing = available.find((a) => a.id === id)!;
      return {
        id: `temp-${id}`,
        stationId: station.id,
        ingredientId: id,
        ingredientName: ing.name,
        ingredientCategory: ing.category,
        customGroup: null,
        customUnit: null,
        defaultQty: null,
        sortOrder: rows.length + i,
        usageUnit: ing.usageUnit,
        purchaseUnitLabel: ing.purchaseUnitLabel,
        kitchenUnit: null,
        freezerUnit: null,
      };
    });

    setRows((prev) => [...prev, ...optimisticRows]);
    setAvailable((prev) => prev.filter((a) => !addSelected.has(a.id)));
    setShowAdd(false);
    setAddSelected(new Set());
    setAddSearch("");

    startTransition(async () => {
      const result = await addToTemplate(station.id, selectedIngIds);
      if (result.error) {
        setError(result.error);
        // Revert
        setRows((prev) => prev.filter((r) => !r.id.startsWith("temp-")));
        setAvailable((prev) => [
          ...prev,
          ...optimisticRows.map((r) => ({
            id: r.ingredientId,
            name: r.ingredientName,
            nameMm: null,
            category: r.ingredientCategory,
            parLevel: null,
            safetyNote: null,
            purchaseUnitLabel: r.purchaseUnitLabel,
            usageUnit: r.usageUnit,
            customGroup: null,
            customUnit: null,
            defaultQty: null,
            kitchenUnit: null,
            freezerUnit: null,
          })),
        ]);
        return;
      }
      // Replace temp rows with real rows returned from server
      if (result.rows) {
        const realByIngId = new Map(result.rows.map((r) => [r.ingredientId, r]));
        setRows((prev) =>
          prev.map((r) => {
            if (!r.id.startsWith("temp-")) return r;
            return realByIngId.get(r.ingredientId) ?? r;
          })
        );
      }
    });
  }

  function handleCopy() {
    if (!copyFrom) return;
    const srcName = allStations.find((s) => s.id === copyFrom)?.name ?? "";
    if (!confirm(`คัดลอก template จากสถานี "${srcName}"?\n(จะเพิ่มรายการที่ยังไม่มีใน template ปัจจุบัน)`)) return;
    setError(null);
    setShowCopy(false);
    setCopyFrom("");
    startTransition(async () => {
      const result = await copyFromStation(station.id, copyFrom);
      if (result.error) { setError(result.error); return; }
      router.refresh();
    });
  }

  const filteredAvailable = available.filter(
    (i) => !addSearch.trim() || i.name.toLowerCase().includes(addSearch.trim().toLowerCase())
  );

  return (
    <div className="space-y-4 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <a href={backHref} className="text-sm text-neutral-400 hover:text-neutral-700">
            ← กลับ
          </a>
          <h1 className="text-lg font-semibold text-neutral-900">Template: {station.name}</h1>
          <p className="text-sm text-neutral-500">{rows.length} รายการ</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setShowCopy(true)}
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
          >
            คัดลอกจากสถานีอื่น
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            + สร้าง Template
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Station switcher */}
      <div className="flex gap-1 flex-wrap">
        {allStations.map((s) => (
          <a
            key={s.id}
            href={`${stationBaseHref}/${s.id}${stationHrefSuffix}`}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              s.id === station.id
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            {s.name}
          </a>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
          ยังไม่มีวัตถุดิบใน template — กด &ldquo;+ สร้าง Template&rdquo; หรือ &ldquo;คัดลอกจากสถานีอื่น&rdquo;
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {groups.map(({ key, label, rows: groupRows }) => (
                <div
                  key={String(key)}
                  className="rounded-lg border border-neutral-200 bg-white overflow-hidden"
                >
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-100 text-xs text-neutral-400">
                          <th className="w-6 px-2 py-1"></th>
                          <th className="w-8 px-2 py-1"></th>
                          <th className="px-2 py-1 text-left">วัตถุดิบ</th>
                          <th className="px-2 py-1 text-left">หน่วยสั่ง</th>
                          <th className="px-2 py-1 text-right">สั่งปกติ</th>
                          <th className="px-2 py-1 text-left">หน่วยครัว</th>
                          <th className="px-2 py-1 text-left">หน่วยตู้แช่</th>
                          <th className="w-8 px-2 py-1"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupRows.map((row, idx) => (
                          <SortableRow
                            key={row.id}
                            row={row}
                            index={idx}
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
          <button
            type="button"
            onClick={handleBulkMove}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            ย้ายไปกลุ่มอื่น
          </button>
          <button
            type="button"
            onClick={handleBulkRemove}
            disabled={isPending}
            className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            เอาออก
          </button>
          <button
            type="button"
            onClick={() => setChecked(new Set())}
            className="text-xs text-neutral-400 hover:text-neutral-700"
          >
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
              <button
                type="button"
                onClick={() => setShowBulkGroup(false)}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={commitBulkMove}
                disabled={isPending}
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                ย้าย
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add / Create Template modal ───────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col max-h-[80vh]">
            <div className="border-b border-neutral-100 p-4 space-y-3">
              <h2 className="font-semibold text-neutral-800">สร้าง Template</h2>
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
                  <label
                    key={ing.id}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      checked={addSelected.has(ing.id)}
                      onChange={(e) =>
                        setAddSelected((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(ing.id) : next.delete(ing.id);
                          return next;
                        })
                      }
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
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setAddSelected(new Set());
                  setAddSearch("");
                }}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={addSelected.size === 0}
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {`เพิ่ม ${addSelected.size} รายการ`}
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
            <p className="text-sm text-neutral-500">
              เลือกสถานีต้นทาง — รายการที่ยังไม่มีใน template นี้จะถูกเพิ่มเข้ามา
            </p>
            <select
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="">— เลือกสถานี —</option>
              {allStations
                .filter((s) => s.id !== station.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowCopy(false);
                  setCopyFrom("");
                }}
                className="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={isPending || !copyFrom}
                className="rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              >
                {isPending ? "กำลังคัดลอก..." : "คัดลอก"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
