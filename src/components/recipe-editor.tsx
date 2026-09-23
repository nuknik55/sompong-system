"use client";

import { useMemo, useState, useTransition } from "react";
import { useLeaveGuard } from "@/lib/use-leave-guard";
import { clearedSavedIds, priceChanged, recipeSnapshot } from "@/components/recipe-dirty";
import { recipeQtyInput, recipeQtyText } from "@/lib/decimal-input";
import { saveRecipeItems, type SavedItem } from "@/app/staff/actions";
import { IngredientCombobox } from "@/components/ingredient-combobox";
import { Plus, Save } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { TH_ROW } from "@/components/ui/table";

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
  onSavePrice?: (menuId: string, newPrice: number) => Promise<{ status: "ok" } | { status: "error"; message: string }>;
  readOnly?: boolean;          // no editing at all: every role editAccess() says only views
  submitMode?: "save" | "pending";  // editor: pending approval flow
  showCosts?: boolean;         // false for those same roles: hides all cost/profit figures
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
  // UNSAVED IS A COMPARISON, NOT A FLAG (Nik, 2026-09-21). It used to be a
  // boolean set on the first edit and cleared only by a save, so a quantity
  // typed and put back, a row added and removed, or the same ingredient
  // picked again all read as unsaved — on a screen the head chef and the
  // prep head use every day, where a warning that cries wolf gets dismissed
  // by reflex. The baseline is taken from the very rows the editor opened
  // with, so at open the two are equal by construction. See recipe-dirty.ts.
  const [cleanItems, setCleanItems] = useState(() => recipeSnapshot(initialItems));
  const [savedPrice, setSavedPrice] = useState(sellingPrice ?? 0);
  const [priceInput, setPriceInput] = useState(String(sellingPrice ?? ""));
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "pending">("idle");
  // The quantity box being typed in, and exactly what is typed there. The
  // box used to show the number read back, so "1." became "1" before the
  // next key and 1.5 was saved as 15 (Nik, 2026-09-21). See decimal-input.ts.
  const [qtyDraft, setQtyDraft] = useState<{ id: string; text: string } | null>(null);

  const itemsDirty = recipeSnapshot(items) !== cleanItems;
  // Compared as the NUMBER a save would send: as text, "180.00" read as a
  // change from 180 — and went on reading as one after the save that stored
  // it, because the saved figure became 180 while the box kept its text.
  const priceDirty = canEditPrice && priceChanged(priceInput, savedPrice);
  const overallDirty = !readOnly && (itemsDirty || priceDirty);

  // Asks before leaving by the browser, by any in-app link, and by
  // ออกจากระบบ. It had beforeunload only: every in-app link left silently.
  useLeaveGuard(overallDirty);

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
    setSaveStatus("idle");
  }

  function addRow() {
    setItems((prev) => [...prev, { id: newRowId(), ingredient_id: null, quantity: 0, unit: null }]);
    setSaveStatus("idle");
  }

  function removeRow(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    if (!id.startsWith("new-")) setDeletedIds((prev) => [...prev, id]);
    setSaveStatus("idle");
  }

  function handleSave() {
    setSaveError(null);
    setSaveStatus("idle");
    startTransition(async () => {
      try {
        // A saved row whose ingredient was cleared cannot be stored as it is
        // — the column is NOT NULL — so saving it means deleting it. It used
        // to be skipped: the screen dropped it, and it came back on reload
        // with its old ingredient (review, 2026-09-21). It goes with the
        // removed rows, the path ลบ uses, which the direct save and the
        // approval both already honour.
        const result = await saveRecipeItems(
          target,
          parentId,
          items,
          [...deletedIds, ...clearedSavedIds(items)],
          parentName ? { parentName } : undefined
        );

        if (result.status === "error") { setSaveError(result.message); return; }
        if (result.status === "pending") {
          // Sent for approval: what was sent is the new clean state.
          setCleanItems(recipeSnapshot(items));
          setDeletedIds([]);
          setSaveStatus("pending");
          return;
        }

        // Saved directly (admin)
        setItems(result.items);
        setDeletedIds([]);
        // The boxes show what was stored, not the text that was typed.
        setQtyDraft(null);
        // The server's rows — real ids now for the ones that were new.
        setCleanItems(recipeSnapshot(result.items));
        setSaveStatus("saved");

        if (priceDirty && onSavePrice) {
          const priceResult = await onSavePrice(parentId, Number(priceInput) || 0);
          // Items above are already saved; the price message replaces the
          // generic save error exactly as the thrown message used to.
          if (priceResult.status === "error") { setSaveError(priceResult.message); return; }
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
              <tr className={TH_ROW}>
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
                <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-neutral-500">ยังไม่มีวัตถุดิบในสูตรนี้</td></tr>
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
      {/* LOCKED WHILE A SAVE IS IN FLIGHT. A direct save replaces the rows
          with the ones it sent and marks them clean, so anything typed in
          the meantime was silently reverted (review, 2026-09-21). The
          booking screen's price box does the same. The price box below is
          left open: its save compares against the figure it SENT, so a
          price typed mid-save correctly stays unsaved. */}
      <fieldset disabled={isPending} className="m-0 min-w-0 border-0 p-0">
      <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className={TH_ROW}>
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
                    {missing && <p className="mt-1 text-xs text-pending-ink">ยังไม่มีราคาสำหรับวัตถุดิบนี้ — แจ้ง Admin ให้ตั้งราคา</p>}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-24 rounded-md border border-neutral-300 px-2 py-1.5"
                      value={recipeQtyText(qtyDraft?.id === item.id ? qtyDraft.text : null, item.quantity)}
                      onChange={(e) => {
                        const { text, quantity } = recipeQtyInput(e.target.value);
                        setQtyDraft({ id: item.id, text });
                        patchLocal(item.id, { quantity });
                      }}
                      onBlur={() => setQtyDraft(null)}
                      placeholder="0"
                    />
                  </td>
                  <td className="px-3 py-2 text-neutral-500">{ing?.usage_unit ?? item.unit ?? "-"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatBaht(lineCost(item))}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className={buttonClass("link", { dangerHover: true })} onClick={() => removeRow(item.id)}>ลบ</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          className={buttonClass("secondary")}
          onClick={addRow}
        >
          <Plus className="h-3.5 w-3.5" />
          เพิ่มวัตถุดิบ
        </button>
        <button
          type="button"
          disabled={!overallDirty || isPending}
          onClick={handleSave}
          className={buttonClass("primary")}
        >
          <Save className="h-3.5 w-3.5" />
          {isPending ? "กำลังบันทึก..." : isPendingMode ? "ส่งขออนุมัติ" : "บันทึกการเปลี่ยนแปลง"}
        </button>
        {overallDirty && !isPending && <span className="text-xs text-pending-ink">มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>}
        {saveStatus === "saved" && <span className="text-xs text-success-ink">✓ บันทึกสำเร็จ</span>}
        {saveStatus === "pending" && <span className="text-xs text-pending-ink">⏳ ส่งขออนุมัติแล้ว — รอ Admin ตรวจสอบ</span>}
      </div>
      {saveError && <p className="text-sm text-danger">{saveError}</p>}

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
          <span className={`tabular-nums font-medium ${sellingPrice - totalCost < 0 ? "text-danger" : "text-success-ink"}`}>
            {formatBaht(sellingPrice - totalCost)} บาท
          </span>
        </div>
      )}
      {hasMissingCost && <p className="mt-2 text-xs text-pending-ink">* ยอดนี้ยังไม่รวมรายการที่ยังไม่มีราคา ต้นทุนจริงจะสูงกว่านี้</p>}
      {hasIncompleteRow && <p className="mt-2 text-xs text-neutral-500">* แถวที่ยังไม่เลือกวัตถุดิบจะไม่ถูกบันทึก — ถ้าเป็นแถวที่เคยบันทึกไว้แล้ว จะถูกลบออกจากสูตรเมื่อกดบันทึก</p>}
    </div>
  );
}
