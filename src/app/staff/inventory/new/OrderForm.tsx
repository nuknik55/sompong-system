"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrderSession } from "../actions";
import type { Station, IngredientForOrder } from "@/lib/inventory-data";

type Props = { stations: Station[]; ingredients: IngredientForOrder[] };

type RowState = {
  kitchenQty: string;
  freezerQty: string;
  qty: string;
  packCount: string;
  qtyPerPack: string;
  usePack: boolean;
};

const EMPTY_ROW: RowState = {
  kitchenQty: "", freezerQty: "", qty: "",
  packCount: "", qtyPerPack: "", usePack: false,
};

export function OrderForm({ stations, ingredients }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [stationId, setStationId] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Group by category, preserving order from DB
  const categories: { label: string; items: IngredientForOrder[] }[] = [];
  const seen = new Map<string, IngredientForOrder[]>();
  for (const ing of ingredients) {
    const cat = ing.category ?? "ไม่ระบุหมวด";
    if (!seen.has(cat)) seen.set(cat, []);
    seen.get(cat)!.push(ing);
  }
  for (const [label, items] of seen) categories.push({ label, items });

  function setRow<K extends keyof RowState>(id: string, field: K, value: RowState[K]) {
    setRows((prev) => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_ROW), [field]: value } }));
  }

  function toggleCategory(cat: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }

  const filledCount = ingredients.filter((ing) => {
    const r = rows[ing.id];
    if (!r) return false;
    return r.kitchenQty.trim() || r.freezerQty.trim() || r.qty.trim() || r.packCount.trim();
  }).length;

  function resolveQtyOrdered(row: RowState): number {
    if (row.usePack) {
      const packs = parseFloat(row.packCount) || 0;
      const perPack = parseFloat(row.qtyPerPack) || 0;
      return packs * perPack;
    }
    return parseFloat(row.qty) || 0;
  }

  function handleSubmit() {
    setError(null);
    const items = ingredients
      .map((ing) => {
        const row = rows[ing.id] ?? EMPTY_ROW;
        const kitchenQty = row.kitchenQty.trim() !== "" ? parseFloat(row.kitchenQty) : null;
        const freezerQty = row.freezerQty.trim() !== "" ? parseFloat(row.freezerQty) : null;
        const qtyOrdered = resolveQtyOrdered(row);
        const packCount = row.usePack && row.packCount.trim() ? parseFloat(row.packCount) : null;
        const qtyPerPack = row.usePack && row.qtyPerPack.trim() ? parseFloat(row.qtyPerPack) : null;
        return {
          ingredientId: ing.id,
          ingredientName: ing.name,
          remainingKitchenQty: kitchenQty !== null && !isNaN(kitchenQty) ? kitchenQty : null,
          remainingKitchenUnit: ing.usageUnit,
          remainingFreezerQty: freezerQty !== null && !isNaN(freezerQty) ? freezerQty : null,
          remainingFreezerUnit: ing.usageUnit,
          packCount,
          qtyPerPack,
          qtyOrdered,
          orderUnit: ing.purchaseUnitLabel ?? ing.usageUnit,
          note: null,
        };
      })
      .filter((i) => i.qtyOrdered > 0 || i.remainingKitchenQty !== null || i.remainingFreezerQty !== null);

    startTransition(async () => {
      const result = await createOrderSession(stationId || null, note.trim() || null, items);
      if (result.error) { setError(result.error); return; }
      router.push(`/staff/inventory/${result.sessionId}`);
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => router.push("/staff/inventory")}
          className="text-sm text-neutral-500 hover:text-neutral-900">← กลับ</button>
        <h1 className="text-lg font-semibold text-neutral-900">เช็คของ + สั่งของ</h1>
      </div>

      {/* Session meta */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-32">
            <label className="mb-1 block text-xs font-medium text-neutral-500">สถานี</label>
            <select value={stationId} onChange={(e) => setStationId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
              <option value="">— ไม่ระบุ —</option>
              {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-32">
            <label className="mb-1 block text-xs font-medium text-neutral-500">หมายเหตุ</label>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น รอบเช้า, เร่งด่วน"
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {/* Ingredient accordion */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            กรอกรายการที่ต้องการ
            {filledCount > 0 && <span className="ml-1 font-medium text-neutral-800">({filledCount} รายการ)</span>}
          </p>
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={() => setOpenCategories(new Set(categories.map((c) => c.label)))}
              className="text-neutral-500 hover:text-neutral-900">เปิดทั้งหมด</button>
            <span className="text-neutral-300">|</span>
            <button type="button" onClick={() => setOpenCategories(new Set())}
              className="text-neutral-500 hover:text-neutral-900">ปิดทั้งหมด</button>
          </div>
        </div>

        {categories.map(({ label, items }) => {
          const isOpen = openCategories.has(label);
          const catFilled = items.filter((i) => {
            const r = rows[i.id];
            return r && (r.kitchenQty.trim() || r.freezerQty.trim() || r.qty.trim() || r.packCount.trim());
          }).length;

          return (
            <div key={label} className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
              <button type="button" onClick={() => toggleCategory(label)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-neutral-50">
                <span className="text-sm font-semibold" style={{ color: "#2F5A16" }}>
                  {label}
                  <span className="ml-2 text-xs font-normal text-neutral-400">({items.length})</span>
                  {catFilled > 0 && <span className="ml-2 text-xs font-medium" style={{ color: "#2F5A16" }}>✓ {catFilled}</span>}
                </span>
                <span className="text-neutral-400 text-xs">{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="border-t border-neutral-100">
                  {items.map((ing) => {
                    const row = rows[ing.id] ?? EMPTY_ROW;
                    const orderUnit = ing.purchaseUnitLabel ?? ing.usageUnit ?? "";
                    const usageUnit = ing.usageUnit ?? "";
                    const parHint = ing.parLevel !== null ? `≈${ing.parLevel}` : "";

                    return (
                      <div key={ing.id} className="border-b border-neutral-100 last:border-0 px-4 py-3 space-y-2">
                        {/* Name row */}
                        <div>
                          <span className="text-sm font-medium text-neutral-800">{ing.name}</span>
                          {ing.nameMm && <span className="ml-2 text-xs text-neutral-400">{ing.nameMm}</span>}
                          {ing.safetyNote && (
                            <div className="text-xs text-red-600 mt-0.5">⚠ {ing.safetyNote}</div>
                          )}
                        </div>

                        {/* Input row */}
                        <div className="flex flex-wrap gap-x-4 gap-y-2 items-end">
                          {/* เหลือ (ครัว) */}
                          <label className="flex flex-col gap-0.5">
                            <span className="text-xs text-neutral-400">เหลือ (ครัว)</span>
                            <div className="flex items-center gap-1">
                              <input type="number" min="0" step="any" value={row.kitchenQty}
                                onChange={(e) => setRow(ing.id, "kitchenQty", e.target.value)}
                                placeholder="0"
                                className="w-20 rounded border border-neutral-300 px-2 py-1 text-right text-sm" />
                              <span className="text-xs text-neutral-400">{usageUnit}</span>
                            </div>
                          </label>

                          {/* เหลือ (ตู้แช่) */}
                          <label className="flex flex-col gap-0.5">
                            <span className="text-xs text-neutral-400">เหลือ (ตู้แช่)</span>
                            <div className="flex items-center gap-1">
                              <input type="number" min="0" step="any" value={row.freezerQty}
                                onChange={(e) => setRow(ing.id, "freezerQty", e.target.value)}
                                placeholder="0"
                                className="w-20 rounded border border-neutral-300 px-2 py-1 text-right text-sm" />
                              <span className="text-xs text-neutral-400">{usageUnit}</span>
                            </div>
                          </label>

                          {/* สั่ง */}
                          {!row.usePack ? (
                            <label className="flex flex-col gap-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-neutral-400">สั่ง</span>
                                {orderUnit !== usageUnit && (
                                  <button type="button" onClick={() => setRow(ing.id, "usePack", true)}
                                    className="text-xs text-blue-500 hover:underline">แพ็ค</button>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <input type="number" min="0" step="any" value={row.qty}
                                  onChange={(e) => setRow(ing.id, "qty", e.target.value)}
                                  placeholder={parHint || "0"}
                                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-right text-sm" />
                                <span className="text-xs text-neutral-400">{orderUnit}</span>
                              </div>
                            </label>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-neutral-400">สั่ง (แพ็ค)</span>
                                <button type="button" onClick={() => setRow(ing.id, "usePack", false)}
                                  className="text-xs text-neutral-400 hover:underline">ยกเลิก</button>
                              </div>
                              <div className="flex items-center gap-1 flex-wrap">
                                <input type="number" min="0" step="any" value={row.packCount}
                                  onChange={(e) => setRow(ing.id, "packCount", e.target.value)}
                                  placeholder={parHint || "0"}
                                  className="w-16 rounded border border-neutral-300 px-2 py-1 text-right text-sm" />
                                <span className="text-xs text-neutral-400">แพ็ค ×</span>
                                <input type="number" min="0" step="any" value={row.qtyPerPack}
                                  onChange={(e) => setRow(ing.id, "qtyPerPack", e.target.value)}
                                  placeholder="ต่อแพ็ค"
                                  className="w-16 rounded border border-neutral-300 px-2 py-1 text-right text-sm" />
                                <span className="text-xs text-neutral-400">{orderUnit}</span>
                                {row.packCount && row.qtyPerPack && (
                                  <span className="text-xs text-neutral-500">
                                    = {(parseFloat(row.packCount) * parseFloat(row.qtyPerPack)).toFixed(2)} {orderUnit}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-3 pb-8">
        <button type="button" onClick={() => router.push("/staff/inventory")}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
          ยกเลิก
        </button>
        <button type="button" onClick={handleSubmit} disabled={isPending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
          {isPending ? "กำลังส่ง..." : `ส่งให้หัวหน้าตรวจ${filledCount > 0 ? ` (${filledCount} รายการ)` : ""}`}
        </button>
      </div>
    </div>
  );
}
