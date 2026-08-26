"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  saveCateringSetMenu, deleteCateringSetMenu, toggleCateringSetMenuActive, getCateringSetMenuItems,
} from "../actions";
import type { CateringSetMenu } from "../actions";
import { fmtBaht, toNum } from "../shared";

/** Per-dish cost, computed once server-side in page.tsx — see the comment there. */
export type DishCostOption = {
  id: string;
  name: string;
  category: string | null;
  selling_price: number;
  unit_cost: number;
  has_unknown_cost: boolean;
};

type SetMenuItemRow = {
  _key: string;
  menu_id: string;
  menu_name: string;
  quantity: string;
  note: string;
};

type SetMenuForm = {
  name: string;
  description: string;
  price_per_set: string;
  serves_guests: string;
  items: SetMenuItemRow[];
};

function blankForm(): SetMenuForm {
  return { name: "", description: "", price_per_set: "", serves_guests: "", items: [] };
}

const ALL_CATEGORY = "ทั้งหมด";
const UNCATEGORIZED = "ไม่มีหมวด";

// Module level on purpose — see the note in shared.tsx: declaring this inside
// the modal would remount it (and close the panel) on every keystroke.
//
// A full overlay rather than a small anchored dropdown — 238 dishes is too
// many to browse in a 320px-wide list. Category pills (from menus.category)
// let the admin scroll a manageable group instead of only typing; search
// still filters within whichever category is selected.
function DishPicker({
  dishes,
  excludeIds,
  onAdd,
}: {
  dishes: DishCostOption[];
  excludeIds: Set<string>;
  onAdd: (dish: DishCostOption, quantity: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY);
  const [quantity, setQuantity] = useState("1");

  const categories = useMemo(() => {
    const set = new Set<string>();
    let hasUncategorized = false;
    for (const d of dishes) {
      if (d.category) set.add(d.category);
      else hasUncategorized = true;
    }
    return [ALL_CATEGORY, ...[...set].sort((a, b) => a.localeCompare(b, "th")), ...(hasUncategorized ? [UNCATEGORIZED] : [])];
  }, [dishes]);

  const q = query.trim().toLowerCase();
  const filtered = dishes.filter((d) => {
    if (category === UNCATEGORIZED ? d.category : category !== ALL_CATEGORY && d.category !== category) return false;
    return q === "" || d.name.toLowerCase().includes(q);
  });

  function pick(dish: DishCostOption) {
    onAdd(dish, Number(quantity) || 1);
    setQuery("");
    setQuantity("1");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        + เพิ่มเมนูในชุด
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
              <h3 className="font-kanit text-sm font-semibold">เลือกเมนู</h3>
              <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>
            <div className="flex items-center gap-2 border-b border-neutral-100 px-5 py-3">
              <input
                autoFocus
                className="flex-1 rounded border border-neutral-200 px-3 py-1.5 text-sm focus:outline-none"
                placeholder="พิมพ์ชื่อเมนู"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <label className="text-xs text-neutral-500">จำนวน</label>
              <input
                type="number"
                min={1}
                className="w-16 rounded border border-neutral-200 px-2 py-1.5 text-sm focus:outline-none"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 border-b border-neutral-100 px-5 py-2">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    category === c ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filtered.length === 0 && <p className="py-8 text-center text-sm text-neutral-400">ไม่พบเมนู</p>}
              {filtered.map((d) => {
                const already = excludeIds.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => pick(d)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-neutral-50"
                  >
                    <span className="text-neutral-800">
                      {d.name}
                      {already && <span className="ml-1.5 text-[10px] text-neutral-400">(อยู่ในชุดแล้ว — เพิ่มจะรวมจำนวน)</span>}
                    </span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">
                      ขาย ฿{fmtBaht(d.selling_price)} · ทุน ฿{fmtBaht(d.unit_cost)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function SetMenusClient({
  initialSetMenus,
  dishOptions,
}: {
  initialSetMenus: CateringSetMenu[];
  dishOptions: DishCostOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [setMenus, setSetMenus] = useState(initialSetMenus);
  const [modal, setModal] = useState<{ editingId: string | null; form: SetMenuForm } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // useState(initialSetMenus) only seeds state on mount — router.refresh()
  // after saveModal() delivers a fresh initialSetMenus prop, but without this
  // the already-mounted component never picks it up, so the list looked
  // unchanged until a manual browser reload. Safe to resync unconditionally
  // here: the modal form is a separate state snapshot (see openEdit) that
  // this never touches, and the list rows themselves have no inline editable
  // fields to clobber.
  useEffect(() => {
    setSetMenus(initialSetMenus);
  }, [initialSetMenus]);

  const dishById = new Map(dishOptions.map((d) => [d.id, d]));

  function openAdd() {
    setModal({ editingId: null, form: blankForm() });
    setError(null);
  }

  function openEdit(sm: CateringSetMenu) {
    setError(null);
    startTransition(async () => {
      try {
        const items = await getCateringSetMenuItems(sm.id);
        setModal({
          editingId: sm.id,
          form: {
            name: sm.name,
            description: sm.description ?? "",
            price_per_set: sm.price_per_set.toString(),
            serves_guests: sm.serves_guests?.toString() ?? "",
            items: items.map((it) => ({
              _key: it.id,
              menu_id: it.menu_id,
              menu_name: it.menu_name,
              quantity: it.quantity.toString(),
              note: it.note ?? "",
            })),
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "โหลดรายการเมนูไม่สำเร็จ");
      }
    });
  }

  function setForm(patch: Partial<SetMenuForm>) {
    setModal((m) => (m ? { ...m, form: { ...m.form, ...patch } } : m));
  }

  function addDish(dish: DishCostOption, quantity: number) {
    setModal((m) => {
      if (!m) return m;
      const existing = m.form.items.find((it) => it.menu_id === dish.id);
      const items = existing
        ? m.form.items.map((it) =>
            it.menu_id === dish.id ? { ...it, quantity: ((toNum(it.quantity) ?? 0) + quantity).toString() } : it,
          )
        : [...m.form.items, { _key: crypto.randomUUID(), menu_id: dish.id, menu_name: dish.name, quantity: quantity.toString(), note: "" }];
      return { ...m, form: { ...m.form, items } };
    });
  }

  function updateItem(key: string, patch: Partial<SetMenuItemRow>) {
    setForm({
      items: (modal?.form.items ?? []).map((it) => (it._key === key ? { ...it, ...patch } : it)),
    });
  }

  function removeItem(key: string) {
    setForm({ items: (modal?.form.items ?? []).filter((it) => it._key !== key) });
  }

  function saveModal() {
    if (!modal) return;
    const f = modal.form;
    if (!f.name.trim() || f.price_per_set.trim() === "") {
      setError("กรุณากรอกชื่อชุดเมนูและราคา");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await saveCateringSetMenu({
          id: modal.editingId ?? undefined,
          name: f.name,
          description: f.description || null,
          price_per_set: toNum(f.price_per_set) ?? 0,
          serves_guests: toNum(f.serves_guests),
          items: f.items
            .filter((it) => it.menu_id)
            .map((it) => ({ menu_id: it.menu_id, quantity: toNum(it.quantity) ?? 1, note: it.note || null })),
        });
        setModal(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function handleDelete(sm: CateringSetMenu) {
    if (!confirm(`ลบชุดเมนู "${sm.name}" ใช่ไหม?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteCateringSetMenu(sm.id);
        setSetMenus((prev) => prev.filter((x) => x.id !== sm.id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  function handleToggleActive(sm: CateringSetMenu) {
    startTransition(async () => {
      await toggleCateringSetMenuActive(sm.id, !sm.is_active);
      setSetMenus((prev) => prev.map((x) => (x.id === sm.id ? { ...x, is_active: !x.is_active } : x)));
    });
  }

  // Live cost preview — pure client-side arithmetic over dishOptions, which
  // already carries each dish's computeMenuCost() result from the server.
  const items = modal?.form.items ?? [];
  const totalCost = items.reduce((s, it) => {
    const dish = dishById.get(it.menu_id);
    return s + (dish ? dish.unit_cost * (toNum(it.quantity) ?? 0) : 0);
  }, 0);
  const pricePerSet = toNum(modal?.form.price_per_set ?? "") ?? 0;
  const foodCostPct = pricePerSet > 0 ? (totalCost / pricePerSet) * 100 : null;
  const profit = pricePerSet - totalCost;
  const hasUnknownCost = items.some((it) => dishById.get(it.menu_id)?.has_unknown_cost);

  return (
    <div className="space-y-4">
      {error && !modal && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={openAdd} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          + เพิ่มชุดเมนู
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {setMenus.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-400">ยังไม่มีชุดเมนู</p>}
        {setMenus.map((sm) => (
          <div key={sm.id} className={`flex items-center gap-3 border-b border-neutral-50 px-4 py-3 last:border-0 ${!sm.is_active ? "opacity-50" : ""}`}>
            <div className="flex-1">
              <span className="text-sm font-medium text-neutral-800">{sm.name}</span>
              <span className="ml-2 text-xs text-neutral-400">{sm.dish_count} เมนู</span>
              {sm.serves_guests != null && <span className="ml-2 text-xs text-neutral-400">เสิร์ฟ {sm.serves_guests} ท่าน</span>}
            </div>
            <span className="text-sm tabular-nums text-neutral-700">฿{fmtBaht(sm.price_per_set)}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => openEdit(sm)} className="text-xs text-neutral-400 hover:text-neutral-700">แก้ไข</button>
              <button
                type="button"
                onClick={() => handleToggleActive(sm)}
                disabled={isPending}
                className={`text-xs ${sm.is_active ? "text-neutral-400 hover:text-red-500" : "text-green-600 hover:text-green-800"}`}
              >
                {sm.is_active ? "ปิดใช้" : "เปิดใช้"}
              </button>
              <button type="button" onClick={() => handleDelete(sm)} disabled={isPending} className="text-xs text-neutral-400 hover:text-red-500 disabled:opacity-30">
                ลบ
              </button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-4">
              <h2 className="font-kanit text-base font-semibold">{modal.editingId ? "แก้ไขชุดเมนู" : "เพิ่มชุดเมนูใหม่"}</h2>
              <button onClick={() => setModal(null)} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-neutral-600">ชื่อชุดเมนู *</label>
                  <input className="set-menu-input" value={modal.form.name} onChange={(e) => setForm({ name: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-neutral-600">รายละเอียด</label>
                  <textarea className="set-menu-input h-16 resize-none" value={modal.form.description} onChange={(e) => setForm({ description: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">ราคาต่อชุด (บาท) *</label>
                  <input type="number" min={0} className="set-menu-input" value={modal.form.price_per_set} onChange={(e) => setForm({ price_per_set: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">เสิร์ฟกี่ท่าน</label>
                  <input type="number" min={0} className="set-menu-input" value={modal.form.serves_guests} onChange={(e) => setForm({ serves_guests: e.target.value })} />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-neutral-600">เมนูในชุด</label>
                  <DishPicker dishes={dishOptions} excludeIds={new Set(items.map((it) => it.menu_id))} onAdd={addDish} />
                </div>
                {items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-neutral-200 py-4 text-center text-xs text-neutral-400">ยังไม่มีเมนูในชุดนี้</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-neutral-200">
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col style={{ width: "34%" }} />
                        <col style={{ width: "12%" }} />
                        <col style={{ width: "32%" }} />
                        <col style={{ width: "14%" }} />
                        <col style={{ width: "8%" }} />
                      </colgroup>
                      <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
                          <th className="px-2 py-1.5">เมนู</th>
                          <th className="px-2 py-1.5 text-right">จำนวน</th>
                          <th className="px-2 py-1.5">หมายเหตุ</th>
                          <th className="px-2 py-1.5 text-right">ทุนรวม</th>
                          <th className="px-2 py-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => {
                          const dish = dishById.get(it.menu_id);
                          const lineCost = (dish?.unit_cost ?? 0) * (toNum(it.quantity) ?? 0);
                          return (
                            <tr key={it._key} className="border-b border-neutral-100 last:border-0">
                              <td className="px-2 py-1.5 text-neutral-800">
                                {it.menu_name}
                                {dish?.has_unknown_cost && <span className="ml-1 text-amber-600" title="ต้นทุนไม่ทราบแน่ชัด">⚠</span>}
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number" min={0}
                                  className="set-menu-input text-right tabular-nums"
                                  value={it.quantity}
                                  onChange={(e) => updateItem(it._key, { quantity: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input className="set-menu-input" value={it.note} onChange={(e) => updateItem(it._key, { note: e.target.value })} />
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-neutral-600">฿{fmtBaht(lineCost)}</td>
                              <td className="px-2 py-1.5 text-center">
                                <button type="button" onClick={() => removeItem(it._key)} className="text-xs text-neutral-400 hover:text-red-600">ลบ</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* The one place in the catering module that shows cost/margin — see the comment in page.tsx. */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <p className="mb-2 text-xs font-medium text-amber-800">สรุปต้นทุน (Admin/Owner เท่านั้น)</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-neutral-500">ต้นทุนวัตถุดิบรวม</p>
                    <p className="tabular-nums font-medium text-neutral-800">฿{fmtBaht(totalCost)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500">Food Cost %</p>
                    <p className="tabular-nums font-medium text-neutral-800">{foodCostPct != null ? `${foodCostPct.toFixed(1)}%` : "–"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500">กำไรต่อชุด</p>
                    <p className={`tabular-nums font-medium ${profit < 0 ? "text-red-600" : "text-green-700"}`}>฿{fmtBaht(profit)}</p>
                  </div>
                </div>
                {hasUnknownCost && (
                  <p className="mt-2 text-xs text-amber-700">⚠ มีเมนูที่ยังไม่ทราบต้นทุนแน่ชัด ตัวเลขด้านบนอาจต่ำกว่าความจริง</p>
                )}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-neutral-100 bg-white px-5 py-3">
              <button onClick={() => setModal(null)} className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">ยกเลิก</button>
              <button
                onClick={saveModal}
                disabled={isPending}
                className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                {isPending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .set-menu-input { width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; font-size: 0.875rem; outline: none; background: white; }
        .set-menu-input:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
      `}</style>
    </div>
  );
}
