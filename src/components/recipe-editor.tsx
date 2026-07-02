"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { saveRecipeItems, type SavedItem } from "@/app/staff/actions";
import { IngredientCombobox } from "@/components/ingredient-combobox";
import { Plus, Save } from "lucide-react";

export type IngredientOption = {
  id: string;
  name: string;
  category: string | null;
  usage_unit: string | null;
  is_prep: boolean;
};

export type RecipeItem = SavedItem;

type Props = {
  target: "menu" | "prep";
  parentId: string;
  parentName?: string;
  initialItems: RecipeItem[];
  ingredients: IngredientOption[];
  unitCosts: Record<string, number | null>;
  qFactorPct?: number;
  sellingPrice?: number;
  canEditPrice?: boolean;
  onSavePrice?: (menuId: string, newPrice: number) => Promise<void>;
  readOnly?: boolean;          // staff: no editing at all
  submitMode?: "save" | "pending";  // editor: pending approval flow
  showCosts?: boolean;         // false for staff: hides all cost/profit figures
};

function formatBaht(n: number) {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function newRowId() {
  return `new-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function RecipeEditor({
  target,
  parentId,
  parentName,
  initialItems,
  ingredients,
  unitCosts,
  qFactorPct = 0,
  sellingPrice,
  canEditPrice = false,
  onSavePrice,
  readOnly = false,
  submitMode = "save",
  showCosts = true,
}: Props) {
  const [items, setItems] = useState(initialItems);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedPrice, setSavedPrice] = useState(sellingPrice ?? 0);
  const [priceInput, setPriceInput] = useState(String(sellingPrice ?? ""));
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "pending">("idle");

  const priceDirty = canEditPrice && priceInput !== String(savedPrice);
  const overallDirty = dirty || priceDirty;

  useEffect(() => {
    if (!overallDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [overallDirty]);

  const ingredientById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const lineCost = (item: RecipeItem) => {
    if (!item.ingredient_id) return 0;
    const cost = unitCosts[item.ingredient_id];
    if (cost == null) return 0;
    return cost * (item.quantity || 0);
  };
  const hasMissingCost = items.some((it) => it.ingredient_id && unitCosts[it.ingredient_id] == null);
  const hasIncompleteRow = items.some((it) => !it.ingredient_id);
  const ingredientCost = items.reduce((sum, it) => sum + lineCost(it), 0);
  const qFactorAmount = ingredientCost * (qFactorPct / 100);
  const totalCost = ingredientCost + qFactorAmount;
  const effectivePrice = canEditPrice ? Number(priceInput) || 0 : sellingPrice;
  const foodCostPct = effectivePrice && effectivePrice > 0 ? (totalCost / effectivePrice) * 100 : null;

  function patchLocal(id: string, patch: Partial<RecipeItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setDirty(true);
    setSaveStatus("idle");
  }

  function addRow() {
    setItems((prev) => [...prev, { id: newRowId(), ingredient_id: null, quantity: 0, unit: null }]);
    setDirty(true);
    setSaveStatus("idle");
  }

  function removeRow(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (!id.startsWith("new-")) setDeletedIds((prev) => [...prev, id]);
    setDirty(true);
    setSaveStatus("idle");
  }

  function handleSave() {
    setSaveError(null);
    setSaveStatus("idle");
    startTransition(async () => {
      try {
        const result = await saveRecipeItems(
          target,
          parentId,
          items,
          deletedIds,
          parentName ? { parentName } : undefined
        );

        if (result.status === "pending") {
          setDirty(false);
          setDeletedIds([]);
          setSaveStatus("pending");
          return;
        }

        // Saved directly (admin)
        setItems(result.items);
        setDeletedIds([]);
        setDirty(false);
        setSaveStatus("saved");

        if (priceDirty && onSavePrice) {
          await onSavePrice(parentId, Number(priceInput) || 0);
          setSavedPrice(Number(priceInput) || 0);
        }
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  // ── Read-only mode (staff) ─────────────────────────────────────
  if (readOnly) {
    const colSpan = showCosts ? 4 : 3;
    return (
      <div className="space-y-4">
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
                <th className="px-3 py-2">วัตถุดิบ / ของเตรียม</th>
                <th className="px-3 py-2">ปริมาณ</th>
                <th className="px-3 py-2">หน่วย</th>
                {showCosts && <th className="px-3 py-2 text-right">ต้นทุน (บาท)</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const ing = item.ingredient_id ? ingredientById.get(item.ingredient_id) : undefined;
                return (
                  <tr key={item.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2">{ing?.name ?? "-"}</td>
                    <td className="px-3 py-2 tabular-nums">{item.quantity}</td>
                    <td className="px-3 py-2 text-neutral-500">{ing?.usage_unit ?? item.unit ?? "-"}</td>
                    {showCosts && <td className="px-3 py-2 text-right tabular-nums">{formatBaht(lineCost(item))}</td>}
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-neutral-400">ยังไม่มีวัตถุดิบในสูตรนี้</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {showCosts && (
          <CostSummary
            ingredientCost={ingredientCost}
            qFactorAmount={qFactorAmount}
            totalCost={totalCost}
            target={target}
            qFactorPct={qFactorPct}
            sellingPrice={sellingPrice}
            foodCostPct={foodCostPct}
            hasMissingCost={hasMissingCost}
          />
        )}
      </div>
    );
  }

  // ── Editable mode (admin / editor) ────────────────────────────
  const isPendingMode = submitMode === "pending";

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-neutral-500">
              <th className="px-3 py-2">วัตถุดิบ / ของเตรียม</th>
              <th className="px-3 py-2">ปริมาณ</th>
              <th className="px-3 py-2">หน่วย</th>
              <th className="px-3 py-2 text-right">ต้นทุนบรรทัดนี้ (บาท)</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const ing = item.ingredient_id ? ingredientById.get(item.ingredient_id) : undefined;
              const missing = item.ingredient_id && unitCosts[item.ingredient_id] == null;
              return (
                <tr key={item.id} className="border-b border-neutral-100 last:border-0 hover:bg-brand-green/5 transition-colors">
                  <td className="px-3 py-2">
                    <IngredientCombobox
                      value={item.ingredient_id}
                      options={ingredients}
                      onChange={(ingredient_id) => {
                        const unit = ingredient_id ? ingredientById.get(ingredient_id)?.usage_unit ?? null : null;
                        patchLocal(item.id, { ingredient_id, unit });
                      }}
                    />
                    {missing && <p className="mt-1 text-xs text-amber-600">ยังไม่มีราคาสำหรับวัตถุดิบนี้ — แจ้ง Admin ให้ตั้งราคา</p>}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="any"
                      className="w-24 rounded-md border border-neutral-300 px-2 py-1.5"
                      value={item.quantity}
                      onChange={(e) => patchLocal(item.id, { quantity: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{ing?.usage_unit ?? item.unit ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBaht(lineCost(item))}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="text-red-500 hover:text-red-700" onClick={() => removeRow(item.id)}>ลบ</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          onClick={addRow}
        >
          <Plus className="h-3.5 w-3.5" />
          เพิ่มวัตถุดิบ
        </button>
        <button
          type="button"
          disabled={!overallDirty || isPending}
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-40"
        >
          <Save className="h-3.5 w-3.5" />
          {isPending ? "กำลังบันทึก..." : isPendingMode ? "ส่งขออนุมัติ" : "บันทึกการเปลี่ยนแปลง"}
        </button>
        {overallDirty && !isPending && <span className="text-xs text-amber-600">มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>}
        {saveStatus === "saved" && <span className="text-xs text-green-600">✓ บันทึกสำเร็จ</span>}
        {saveStatus === "pending" && <span className="text-xs text-amber-600">⏳ ส่งขออนุมัติแล้ว — รอ Admin ตรวจสอบ</span>}
      </div>
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}

      <CostSummary
        ingredientCost={ingredientCost}
        qFactorAmount={qFactorAmount}
        totalCost={totalCost}
        target={target}
        qFactorPct={qFactorPct}
        sellingPrice={effectivePrice}
        foodCostPct={foodCostPct}
        hasMissingCost={hasMissingCost}
        hasIncompleteRow={hasIncompleteRow}
        canEditPrice={canEditPrice}
        priceInput={priceInput}
        onPriceChange={(v) => { setPriceInput(v); setSaveStatus("idle"); }}
      />
    </div>
  );
}

// Extracted summary box so it can be reused in both read-only and edit modes
function CostSummary({
  ingredientCost,
  qFactorAmount,
  totalCost,
  target,
  qFactorPct,
  sellingPrice,
  foodCostPct,
  hasMissingCost,
  hasIncompleteRow,
  canEditPrice,
  priceInput,
  onPriceChange,
}: {
  ingredientCost: number;
  qFactorAmount: number;
  totalCost: number;
  target: "menu" | "prep";
  qFactorPct: number;
  sellingPrice?: number;
  foodCostPct: number | null;
  hasMissingCost: boolean;
  hasIncompleteRow?: boolean;
  canEditPrice?: boolean;
  priceInput?: string;
  onPriceChange?: (v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
      {canEditPrice && priceInput !== undefined && onPriceChange && (
        <div className="flex items-center justify-between border-b border-neutral-100 pb-2 mb-1">
          <span className="text-neutral-500">ราคาขาย</span>
          <div className="flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              value={priceInput}
              onChange={(e) => onPriceChange(e.target.value.replace(/[^0-9.]/g, ""))}
              className="w-24 rounded border border-neutral-300 px-2 py-1 text-right tabular-nums"
            />
            <span>บาท</span>
          </div>
        </div>
      )}
      <div className="flex justify-between py-1">
        <span className="text-neutral-500">ต้นทุนวัตถุดิบรวม</span>
        <span className="tabular-nums">{formatBaht(ingredientCost)} บาท</span>
      </div>
      {target === "menu" && (
        <div className="flex justify-between py-1">
          <span className="text-neutral-500">Q-factor ({qFactorPct}% ค่าเผื่อแก๊ส/เครื่องปรุงเล็กๆ)</span>
          <span className="tabular-nums">{formatBaht(qFactorAmount)} บาท</span>
        </div>
      )}
      <div className="flex justify-between border-t border-neutral-200 pt-2 mt-1 font-semibold">
        <span>ต้นทุนรวมต่อจาน</span>
        <span className="tabular-nums">{formatBaht(totalCost)} บาท</span>
      </div>
      {foodCostPct != null && (
        <div className="flex justify-between py-1">
          <span className="text-neutral-500">% ต้นทุนอาหาร (Food Cost)</span>
          <span className="tabular-nums">{foodCostPct.toFixed(1)}%</span>
        </div>
      )}
      {sellingPrice != null && (
        <div className="flex justify-between py-1">
          <span className="text-neutral-500">กำไรต่อจาน</span>
          <span className={`tabular-nums font-medium ${sellingPrice - totalCost < 0 ? "text-red-600" : "text-green-700"}`}>
            {formatBaht(sellingPrice - totalCost)} บาท
          </span>
        </div>
      )}
      {hasMissingCost && <p className="mt-2 text-xs text-amber-600">* ยอดนี้ยังไม่รวมรายการที่ยังไม่มีราคา ต้นทุนจริงจะสูงกว่านี้</p>}
      {hasIncompleteRow && <p className="mt-2 text-xs text-neutral-400">* แถวที่ยังไม่เลือกวัตถุดิบจะไม่ถูกบันทึก</p>}
    </div>
  );
}
