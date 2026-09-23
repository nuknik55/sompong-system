"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Template, TemplateItem, IngredientForOrder } from "@/lib/inventory-data";
import {
  createTemplate, renameTemplate, deleteTemplate,
  addItemsToTemplate, removeItemsFromTemplate, updateTemplateItem,
  reorderTemplateItems,
} from "./actions";
import { buttonClass } from "@/components/ui/button";
import { TH_ROW } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page";
import { TAB_ROW, tabClass } from "@/components/ui/tabs";

type UpdateFields = {
  order_unit?: string | null;
  default_qty?: number | null;
  kitchen_unit?: string | null;
  freezer_unit?: string | null;
};

// ─── Row component ─────────────────────────────────────────────────────────────

function TemplateRow({
  row, index, totalCount, editMode, onUpdate, onRemove, onMove, isPending,
}: {
  row: TemplateItem;
  index: number;
  totalCount: number;
  editMode: boolean;
  onUpdate: (fields: UpdateFields) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  isPending: boolean;
}) {
  const [unitVal, setUnitVal] = useState(row.orderUnit ?? row.usageUnit ?? "");
  const [qtyVal, setQtyVal] = useState(row.defaultQty !== null ? String(row.defaultQty) : "");
  const [kitchenVal, setKitchenVal] = useState(row.kitchenUnit ?? row.usageUnit ?? "");
  const [freezerVal, setFreezerVal] = useState(row.freezerUnit ?? row.usageUnit ?? "");

  const inputCls = "rounded border border-neutral-200 px-1.5 py-1 text-xs w-16";
  const rowCls = `border-b border-neutral-100 last:border-0${index % 2 === 1 ? " bg-neutral-50" : ""}`;

  return (
    <tr className={rowCls}>
      {editMode && (
        <td className="px-2 py-2 w-10">
          <div className="flex flex-col gap-0.5 items-center">
            <button type="button" onClick={() => onMove("up")}
              disabled={index === 0 || isPending}
              className="text-xs text-neutral-500 hover:text-neutral-700 disabled:opacity-25 leading-none">▲</button>
            <button type="button" onClick={() => onMove("down")}
              disabled={index === totalCount - 1 || isPending}
              className="text-xs text-neutral-500 hover:text-neutral-700 disabled:opacity-25 leading-none">▼</button>
            <button type="button" onClick={onRemove} disabled={isPending}
              className="text-xs text-red-400 hover:text-danger disabled:opacity-40 leading-none">✕</button>
          </div>
        </td>
      )}
      <td className="px-3 py-2 text-sm text-neutral-800 min-w-[120px]">{row.ingredientName}</td>
      <td className="px-2 py-2">
        {editMode
          ? <input type="text" value={unitVal} onChange={(e) => setUnitVal(e.target.value)}
              onBlur={() => { const v = unitVal.trim() || null; if (v !== row.orderUnit) onUpdate({ order_unit: v }); }}
              placeholder={row.usageUnit ?? "หน่วย"} className={inputCls} />
          : <span className="text-sm text-neutral-500">{row.orderUnit ?? row.usageUnit ?? "—"}</span>}
      </td>
      <td className="px-2 py-2 text-right">
        {editMode
          ? <input type="number" min="0" step="any" value={qtyVal} onChange={(e) => setQtyVal(e.target.value)}
              onBlur={() => {
                const p = qtyVal.trim() === "" ? null : parseFloat(qtyVal);
                const clean = p !== null && !isNaN(p) ? p : null;
                if (clean !== row.defaultQty) onUpdate({ default_qty: clean });
              }}
              placeholder="—" className="rounded border border-neutral-200 px-1.5 py-1 text-xs w-14 text-right" />
          : <span className="text-sm text-neutral-500">{row.defaultQty ?? "—"}</span>}
      </td>
      <td className="px-2 py-2">
        {editMode
          ? <input type="text" value={kitchenVal} onChange={(e) => setKitchenVal(e.target.value)}
              onBlur={() => { const v = kitchenVal.trim() || null; if (v !== row.kitchenUnit) onUpdate({ kitchen_unit: v }); }}
              placeholder={row.usageUnit ?? "หน่วย"} className={inputCls} />
          : <span className="text-sm text-neutral-500">{row.kitchenUnit ?? row.usageUnit ?? "—"}</span>}
      </td>
      <td className="px-2 py-2">
        {editMode
          ? <input type="text" value={freezerVal} onChange={(e) => setFreezerVal(e.target.value)}
              onBlur={() => { const v = freezerVal.trim() || null; if (v !== row.freezerUnit) onUpdate({ freezer_unit: v }); }}
              placeholder={row.usageUnit ?? "หน่วย"} className={inputCls} />
          : <span className="text-sm text-neutral-500">{row.freezerUnit ?? row.usageUnit ?? "—"}</span>}
      </td>
    </tr>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function TemplateClient({
  templates,
  selectedTemplateId,
  initialItems,
  availableIngredients,
}: {
  templates: Template[];
  selectedTemplateId: string | null;
  initialItems: TemplateItem[];
  availableIngredients: IngredientForOrder[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [items, setItems] = useState<TemplateItem[]>(initialItems);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<IngredientForOrder[]>(availableIngredients);

  const currentTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addCategory, setAddCategory] = useState<string | null>(null);
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(currentTemplate?.name ?? "");

  const allCategories = [
    ...new Set(available.map((i) => i.category).filter((c): c is string => c !== null && c.trim() !== "")),
  ].sort();

  const filteredAvailable = available.filter((i) => {
    const matchSearch = !addSearch.trim() || i.name.toLowerCase().includes(addSearch.toLowerCase());
    const matchCat = !addCategory || i.category === addCategory;
    return matchSearch && matchCat;
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  // Same runner, same reason, as owner/stations/[id]/template (83cc517):
  // this screen moves rows on screen and then writes, and it reverted only
  // when the action RETURNED an error. A THROWN failure left the optimistic
  // change standing with no message — a template on screen that the database
  // does not have, which on an ordering screen means ordering the wrong
  // things. A returned error and a thrown one do the same two things here:
  // say so, and undo.
  const RETRY_MESSAGE = "บันทึกไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่";

  function runWrite<T extends { error?: string }>(
    fn: () => Promise<T>,
    opts?: { onOk?: (result: T) => void; revert?: () => void },
  ) {
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.error) { setError(result.error); opts?.revert?.(); return; }
        opts?.onOk?.(result);
      } catch {
        setError(RETRY_MESSAGE);
        opts?.revert?.();
      }
    });
  }

  function handleCreate() {
    if (!createName.trim()) return;
    setError(null);
    runWrite(() => createTemplate(createName.trim()), {
      onOk: (result) => {
        setShowCreate(false);
        setCreateName("");
        router.push(`/staff/inventory/template?t=${result.id}`);
      },
    });
  }

  function handleRename() {
    if (!currentTemplate) { setEditingName(false); return; }
    const trimmed = nameVal.trim();
    if (!trimmed || trimmed === currentTemplate.name) { setEditingName(false); return; }
    setError(null);
    // setEditingName(false) and the refresh ran unconditionally, so a
    // refused rename at least closed the editor and re-read the real name.
    // On a THROW neither ran: the editor stayed open with the typed name in
    // it and nothing said why. Both now happen either way.
    runWrite(() => renameTemplate(currentTemplate.id, trimmed), {
      onOk: () => { setEditingName(false); router.refresh(); },
      revert: () => { setEditingName(false); router.refresh(); },
    });
  }

  function handleDelete() {
    if (!currentTemplate) return;
    if (!confirm(`ลบ template "${currentTemplate.name}"?\n(รายการทั้งหมดในนี้จะหายไปด้วย)`)) return;
    setError(null);
    runWrite(() => deleteTemplate(currentTemplate.id), {
      onOk: () => {
        const remaining = templates.filter((t) => t.id !== currentTemplate.id);
        router.push(
          remaining.length > 0
            ? `/staff/inventory/template?t=${remaining[0].id}`
            : "/staff/inventory/template"
        );
      },
    });
  }

  function doRemove(ids: string[]) {
    setError(null);
    const removed = items.filter((r) => ids.includes(r.id));
    setItems((prev) => prev.filter((r) => !ids.includes(r.id)));
    setAvailable((a) => [
      ...a,
      ...removed.map((r) => ({
        id: r.ingredientId, name: r.ingredientName, nameMm: null,
        category: r.ingredientCategory, parLevel: null, safetyNote: null,
        purchaseUnitLabel: r.purchaseUnitLabel, usageUnit: r.usageUnit,
        customGroup: null, customUnit: null, defaultQty: null, kitchenUnit: null, freezerUnit: null,
      })),
    ]);
    runWrite(() => removeItemsFromTemplate(ids), {
      revert: () => {
        setItems((prev) => [...prev, ...removed]);
        setAvailable((prev) => prev.filter((a) => !removed.some((r) => r.ingredientId === a.id)));
      },
    });
  }

  function handleUpdateItem(id: string, fields: UpdateFields) {
    setError(null);
    runWrite(() => updateTemplateItem(id, fields), {
      onOk: () => setItems((prev) =>
        prev.map((r) => r.id !== id ? r : {
          ...r,
          ...(fields.order_unit !== undefined ? { orderUnit: fields.order_unit } : {}),
          ...(fields.default_qty !== undefined ? { defaultQty: fields.default_qty } : {}),
          ...(fields.kitchen_unit !== undefined ? { kitchenUnit: fields.kitchen_unit } : {}),
          ...(fields.freezer_unit !== undefined ? { freezerUnit: fields.freezer_unit } : {}),
        })
      ),
    });
  }

  function handleMove(fromIdx: number, direction: "up" | "down") {
    const toIdx = direction === "up" ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= items.length) return;
    const next = [...items];
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    const updated = next.map((item, i) => ({ ...item, sortOrder: i }));
    // Optimistic with no check at all before this: neither a returned error
    // nor a throw was handled, so a refused reorder simply stood on screen.
    const prevItems = items;
    setError(null);
    setItems(updated);
    runWrite(
      () => reorderTemplateItems([
        { id: updated[fromIdx].id, sort_order: updated[fromIdx].sortOrder },
        { id: updated[toIdx].id, sort_order: updated[toIdx].sortOrder },
      ]),
      { revert: () => setItems(prevItems) },
    );
  }

  function handleAdd() {
    if (!currentTemplate || addSelected.size === 0) return;
    const selectedIngIds = [...addSelected];
    setError(null);
    const optimistic: TemplateItem[] = selectedIngIds.map((id, i) => {
      const ing = available.find((a) => a.id === id)!;
      return {
        id: `temp-${id}`, templateId: currentTemplate.id, ingredientId: id,
        ingredientName: ing.name, ingredientCategory: ing.category,
        customGroup: null, orderUnit: null, defaultQty: null,
        sortOrder: items.length + i, usageUnit: ing.usageUnit,
        purchaseUnitLabel: ing.purchaseUnitLabel, kitchenUnit: null, freezerUnit: null,
      };
    });
    setItems((prev) => [...prev, ...optimistic]);
    setAvailable((prev) => prev.filter((a) => !addSelected.has(a.id)));
    setShowAdd(false);
    setAddSelected(new Set());
    setAddSearch("");
    setAddCategory(null);
    runWrite(() => addItemsToTemplate(currentTemplate.id, selectedIngIds), {
      revert: () => {
        setItems((prev) => prev.filter((r) => !r.id.startsWith("temp-")));
        setAvailable((prev) => [
          ...prev,
          ...optimistic.map((r) => ({
            id: r.ingredientId, name: r.ingredientName, nameMm: null,
            category: r.ingredientCategory, parLevel: null, safetyNote: null,
            purchaseUnitLabel: r.purchaseUnitLabel, usageUnit: r.usageUnit,
            customGroup: null, customUnit: null, defaultQty: null, kitchenUnit: null, freezerUnit: null,
          })),
        ]);
      },
      onOk: (result) => {
        if (!result.items) return;
        const realById = new Map(result.items.map((r) => [r.ingredientId, r]));
        setItems((prev) =>
          prev.map((r) => r.id.startsWith("temp-") ? (realById.get(r.ingredientId) ?? r) : r)
        );
      },
    });
  }

  // ── JSX ───────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 pb-12">

      {/* Header: the shared page header */}
      <PageHeader
        back={{ href: "/staff/inventory", label: "กลับ" }}
        title="Template"
        actions={
          <button type="button" onClick={() => { setShowCreate(true); setCreateName(""); }}
            className={buttonClass("primary")}>
            + สร้าง Template
          </button>
        }
      />

      {/* Template tabs */}
      {templates.length > 0 && (
        <div className={TAB_ROW}>
          {templates.map((t) => (
            <button key={t.id} type="button"
              onClick={() => router.push(`/staff/inventory/template?t=${t.id}`)}
              className={tabClass(t.id === selectedTemplateId)}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* No templates */}
      {templates.length === 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
          ยังไม่มี Template — กด &ldquo;+ สร้าง Template&rdquo; เพื่อเริ่ม
        </div>
      )}

      {/* Current template */}
      {currentTemplate && (
        <>
          {/* Template name + delete */}
          <div className="flex items-start justify-between gap-3">
            <div>
              {editingName ? (
                <input type="text" autoFocus value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  className="rounded border border-neutral-300 px-2 py-1 text-lg font-semibold text-neutral-900 focus:outline-none" />
              ) : (
                <button type="button"
                  onClick={() => { setEditingName(true); setNameVal(currentTemplate.name); }}
                  className={buttonClass("link")}>
                  {currentTemplate.name}
                  <span className="text-xs font-normal text-neutral-500">✎</span>
                </button>
              )}
              <p className="text-sm text-neutral-500 mt-0.5">{items.length} รายการ</p>
            </div>
            <button type="button" onClick={handleDelete} disabled={isPending}
              className={buttonClass("link", { danger: true, className: "mt-1" })}>
              ลบ template
            </button>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {/* Items table */}
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
              ยังไม่มีวัตถุดิบ — กด &ldquo;+ เพิ่มวัตถุดิบ&rdquo; ด้านล่าง
            </div>
          ) : (
            <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      {editMode && <th className="w-8 px-2 py-2" />}
                      <th className="px-3 py-2 text-left">วัตถุดิบ</th>
                      <th className="px-2 py-2 text-left">หน่วยสั่ง</th>
                      <th className="px-2 py-2 text-right">สั่งปกติ</th>
                      <th className="px-2 py-2 text-left">หน่วยครัว</th>
                      <th className="px-2 py-2 text-left">หน่วยตู้แช่</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, idx) => (
                      <TemplateRow
                        key={row.id}
                        row={row}
                        index={idx}
                        totalCount={items.length}
                        editMode={editMode}
                        onUpdate={(fields) => handleUpdateItem(row.id, fields)}
                        onRemove={() => {
                          if (confirm(`เอา "${row.ingredientName}" ออกจาก template?`)) doRemove([row.id]);
                        }}
                        onMove={(dir) => handleMove(idx, dir)}
                        isPending={isPending}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button type="button" onClick={() => setEditMode((v) => !v)}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  editMode
                    ? "border-primary/30 bg-primary-soft text-primary"
                    : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                }`}>
                {editMode ? "✓ เสร็จแล้ว" : "แก้ไข"}
              </button>
            )}
            <button type="button" onClick={() => setShowAdd(true)}
              className={buttonClass("secondary")}>
              + เพิ่มวัตถุดิบ
            </button>
          </div>
        </>
      )}

      {/* ─── Add ingredients modal ─── */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col max-h-[85vh]">
            <div className="border-b border-neutral-100 p-4 space-y-3">
              <h2 className="font-semibold text-neutral-800">เพิ่มวัตถุดิบ</h2>
              <input type="text" autoFocus placeholder="ค้นหาชื่อวัตถุดิบ..."
                value={addSearch} onChange={(e) => setAddSearch(e.target.value)}
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
              {allCategories.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  <button type="button" onClick={() => setAddCategory(null)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                      !addCategory ? "bg-primary-soft text-primary ring-1 ring-inset ring-primary/25" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                    }`}>
                    ทั้งหมด
                  </button>
                  {allCategories.map((cat) => (
                    <button key={cat} type="button"
                      onClick={() => setAddCategory(addCategory === cat ? null : cat)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                        addCategory === cat ? "bg-primary-soft text-primary ring-1 ring-inset ring-primary/25" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                      }`}>
                      {cat}
                    </button>
                  ))}
                </div>
              )}
              {addSelected.size > 0 && (
                <p className="text-xs text-info">เลือกแล้ว {addSelected.size} รายการ</p>
              )}
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-neutral-100">
              {filteredAvailable.length === 0 ? (
                <p className="p-4 text-sm text-neutral-500 text-center">ไม่พบรายการ</p>
              ) : filteredAvailable.map((ing) => (
                <label key={ing.id}
                  className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-neutral-50">
                  <input type="checkbox" checked={addSelected.has(ing.id)}
                    onChange={(e) => setAddSelected((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(ing.id); else n.delete(ing.id);
                      return n;
                    })}
                    className="h-4 w-4 rounded border-neutral-300 text-info" />
                  <div>
                    <p className="text-sm text-neutral-800">{ing.name}</p>
                    {ing.category && <p className="text-xs text-neutral-500">{ing.category}</p>}
                  </div>
                </label>
              ))}
            </div>
            <div className="border-t border-neutral-100 p-4 flex gap-2 justify-end">
              <button type="button"
                onClick={() => { setShowAdd(false); setAddSelected(new Set()); setAddSearch(""); setAddCategory(null); }}
                className={buttonClass("secondary")}>
                ยกเลิก
              </button>
              <button type="button" onClick={handleAdd} disabled={addSelected.size === 0}
                className={buttonClass("primary")}>
                เพิ่ม {addSelected.size} รายการ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Create template modal ─── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl space-y-4">
            <h2 className="font-semibold text-neutral-800">สร้าง Template ใหม่</h2>
            <input type="text" autoFocus placeholder="ชื่อ Template เช่น ครัวเช้า, รอบวันพุธ"
              value={createName} onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreate(false)}
                className={buttonClass("secondary")}>
                ยกเลิก
              </button>
              <button type="button" onClick={handleCreate} disabled={!createName.trim() || isPending}
                className={buttonClass("primary")}>
                {isPending ? "กำลังสร้าง..." : "สร้าง"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
