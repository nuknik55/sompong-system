"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  saveCateringSetMenu, deleteCateringSetMenu, toggleCateringSetMenuActive, getCateringSetMenuItems,
} from "../actions";
import type { CateringSetMenu } from "../actions";
import { fmtBaht, toNum, SET_MENU_SECTIONS } from "../shared-utils";
import { comparisonHeadline, comparisonText, COMPARISON_LABEL, setVsAlaCarte } from "../event-menu";
import { menuLineQuantityError } from "../booking-lines";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { TH_ROW } from "@/components/ui/table";

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
  /** dish | dessert | drink | free — which group this row prints under. */
  section: string;
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
        className={buttonClass("secondary")}
      >
        + เพิ่มเมนูในชุด
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
              <h3 className="font-heading text-sm font-semibold">เลือกเมนู</h3>
              <button onClick={() => setOpen(false)} className={buttonClass("link")}>✕</button>
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
                    category === c ? "border-primary/30 bg-primary-soft text-primary" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {filtered.length === 0 && <p className="py-8 text-center text-sm text-neutral-500">ไม่พบเมนู</p>}
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
                      {already && <span className="ml-1.5 text-[10px] text-neutral-500">(อยู่ในชุดแล้ว — เพิ่มจะรวมจำนวน)</span>}
                    </span>
                    <span className="whitespace-nowrap text-xs tabular-nums text-neutral-500">
                      ขาย ฿{fmtBaht(d.selling_price)} · ต้นทุน ฿{fmtBaht(d.unit_cost)}
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

// The list is rendered straight from the server prop — it is deliberately NOT
// mirrored into state.
//
// It used to be, seeded once by useState and resynced by an effect. The comment
// on that effect blamed Next.js for not propagating the refreshed prop. That
// diagnosis was wrong: the prop propagated fine, and the component simply
// rendered its own stale mirror instead of it. If you hit a symptom like
// "the list does not update after saving", the mirror is the first suspect,
// not the router.
//
// Every mutation therefore goes: server action -> router.refresh() -> new prop.
// Delete and toggle used to patch the local array instead, which made the UI
// claim success before the write was confirmed; a failed or concurrent write
// left the screen disagreeing with the database until a manual reload. The
// round-trip is slower on an admin screen that is used occasionally, and worth
// it for showing only what the database actually holds.
//
// Both actions already call revalidatePath() server-side. Whether that alone
// re-renders the client without an explicit router.refresh() is NOT something
// we verified against the docs, so the refresh here is deliberate belt-and-
// braces. Do not delete these three refreshes as redundant without testing
// that revalidatePath alone updates a mounted client component.
export function SetMenusClient({
  setMenus,
  dishOptions,
}: {
  setMenus: CateringSetMenu[];
  dishOptions: DishCostOption[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [modal, setModal] = useState<{ editingId: string | null; form: SetMenuForm } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
              section: it.section,
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
        : [...m.form.items, { _key: crypto.randomUUID(), menu_id: dish.id, menu_name: dish.name, quantity: quantity.toString(), note: "", section: "dish" }];
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
    // Every booking that picks this set copies these portions, and the sheets
    // print them at three decimals: the dish rule (booking-lines.ts). A 0 used
    // to save here and then fail every booking's copy of the set.
    for (const it of f.items) {
      if (!it.menu_id) continue;
      const qtyError = menuLineQuantityError("dish", toNum(it.quantity));
      if (qtyError) { setError(`${it.menu_name}: จำนวนต่อชุด — ${qtyError}`); return; }
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
            .map((it) => ({ menu_id: it.menu_id, quantity: toNum(it.quantity) ?? 1, note: it.note || null, section: it.section })),
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
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  function handleToggleActive(sm: CateringSetMenu) {
    setError(null);
    startTransition(async () => {
      try {
        await toggleCateringSetMenuActive(sm.id, !sm.is_active);
        router.refresh();
      } catch (err) {
        // Previously unhandled: the local array was patched regardless of
        // whether the write succeeded, so a failure showed the row toggled
        // and told the user nothing.
        setError(err instanceof Error ? err.message : "เปลี่ยนสถานะไม่สำเร็จ");
      }
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
  // The same two figures a booking's own menu shows (event-menu.ts): what
  // the dishes would cost the customer bought singly (price × portions per
  // table, as the cost above multiplies), and where the set's price sits
  // against that — above or below, and by how much. Selling prices, not cost
  // — but this screen is admin-only anyway, so the block may sit beside the
  // cost summary.
  const dishesTotal = items.reduce((s, it) => {
    const dish = dishById.get(it.menu_id);
    return s + (dish ? dish.selling_price * (toNum(it.quantity) ?? 0) : 0);
  }, 0);
  const comparison = setVsAlaCarte(dishesTotal, pricePerSet > 0 ? pricePerSet : null);
  const hasUnknownCost = items.some((it) => dishById.get(it.menu_id)?.has_unknown_cost);

  const realSets = setMenus.filter((sm) => !sm.is_draft);
  const draftSets = setMenus.filter((sm) => sm.is_draft);

  const setRow = (sm: CateringSetMenu) => (
          <div key={sm.id} className={`flex items-center gap-3 border-b border-neutral-50 px-4 py-3 last:border-0 ${!sm.is_active && !sm.is_draft ? "opacity-50" : ""}`}>
            <div className="flex-1">
              <span className="text-sm font-medium text-neutral-800">{sm.name}</span>
              {sm.serves_guests != null && <span className="ml-2 text-xs text-neutral-500">เสิร์ฟ {sm.serves_guests} ท่าน</span>}
              {/* The whole breakdown, zeros included, so a package missing a
                  section is visible without opening it. Zero is shown rather
                  than hidden because "no dessert" is the fact worth seeing.
                  Only an empty รายการอาหาร is a warning — a package
                  legitimately may have no dessert, drink or free item, but one
                  with no dishes cannot print a kitchen sheet at all. */}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-neutral-500">
                {SET_MENU_SECTIONS.map((s, i) => {
                  const n = sm.section_counts[s.value] ?? 0;
                  const isEmptyDish = s.value === "dish" && n === 0;
                  return (
                    <span key={s.value} className={isEmptyDish ? "font-medium text-pending-ink" : undefined}>
                      {i > 0 && <span className="mr-1.5 text-neutral-300">·</span>}
                      {s.label} <span className="tabular-nums">{n}</span>
                      {isEmptyDish && " ⚠"}
                    </span>
                  );
                })}
              </div>
            </div>
            <span className="text-sm tabular-nums text-neutral-700">฿{fmtBaht(sm.price_per_set)}</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => openEdit(sm)} className={buttonClass("link", { size: "sm" })}>แก้ไข</button>
              {!sm.is_draft && (
                <button
                  type="button"
                  onClick={() => handleToggleActive(sm)}
                  disabled={isPending}
                  className={`text-xs ${sm.is_active ? "text-neutral-500 hover:text-danger" : "text-success-ink hover:text-success-ink"}`}
                >
                  {sm.is_active ? "ปิดใช้" : "เปิดใช้"}
                </button>
              )}
              <button type="button" onClick={() => handleDelete(sm)} disabled={isPending} className={buttonClass("link", { size: "sm", dangerHover: true })}>
                ลบ
              </button>
            </div>
          </div>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="จัดการชุดเมนู"
        actions={
          <>
            <Link href="/owner/catering/set-menus/design" className={buttonClass("secondary")}>ออกแบบชุดเมนู</Link>
            <button type="button" onClick={openAdd} className={buttonClass("primary")}>
              + เพิ่มชุดเมนู
            </button>
          </>
        }
      />

      {error && !modal && (
        <div className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-2 text-sm text-danger">
          {error}
          <button onClick={() => setError(null)} className={buttonClass("link", { danger: true, className: "ml-2" })}>✕</button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {realSets.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-500">ยังไม่มีชุดเมนู</p>}
        {realSets.map((sm) => setRow(sm))}
      </div>

      {/* Trial sets from the design workspace, apart from the real ones: no
          booking can use one and sales never sees one. The editor works on
          both; a draft has no ปิดใช้/เปิดใช้, since it is offered nowhere. */}
      {draftSets.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading text-base font-semibold text-neutral-800">
            ชุดทดลอง (ฉบับร่าง) <span className="text-sm font-normal text-neutral-500">— ยังไม่ใช้กับงาน พนักงานขายไม่เห็น</span>
          </h2>
          <div className="overflow-hidden rounded-xl border border-dashed border-neutral-300 bg-white">
            {draftSets.map((sm) => setRow(sm))}
          </div>
        </section>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-4">
              <h2 className="font-heading text-base font-semibold">{modal.editingId ? "แก้ไขชุดเมนู" : "เพิ่มชุดเมนูใหม่"}</h2>
              <button onClick={() => setModal(null)} className={buttonClass("link")}>✕</button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-neutral-600">ชื่อชุดเมนู *</label>
                  <input className="input-base" value={modal.form.name} onChange={(e) => setForm({ name: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-xs font-medium text-neutral-600">รายละเอียด</label>
                  <textarea className="input-base h-16 resize-none" value={modal.form.description} onChange={(e) => setForm({ description: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">ราคาต่อชุด (บาท) *</label>
                  <input type="number" min={0} className="input-base" value={modal.form.price_per_set} onChange={(e) => setForm({ price_per_set: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">เสิร์ฟกี่ท่าน</label>
                  <input type="number" min={0} className="input-base" value={modal.form.serves_guests} onChange={(e) => setForm({ serves_guests: e.target.value })} />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-xs font-medium text-neutral-600">เมนูในชุด</label>
                  <DishPicker dishes={dishOptions} excludeIds={new Set(items.map((it) => it.menu_id))} onAdd={addDish} />
                </div>
                {items.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-neutral-200 py-4 text-center text-xs text-neutral-500">ยังไม่มีเมนูในชุดนี้</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-neutral-200">
                    <table className="w-full table-fixed text-sm">
                      <colgroup>
                        <col style={{ width: "28%" }} />
                        <col style={{ width: "17%" }} />
                        <col style={{ width: "10%" }} />
                        <col style={{ width: "25%" }} />
                        <col style={{ width: "13%" }} />
                        <col style={{ width: "7%" }} />
                      </colgroup>
                      <thead>
                        <tr className={TH_ROW}>
                          <th className="px-2 py-1.5">เมนู</th>
                          <th className="px-2 py-1.5">หมวดในชุด</th>
                          <th className="px-2 py-1.5 text-right">จำนวน</th>
                          <th className="px-2 py-1.5">หมายเหตุ</th>
                          <th className="px-2 py-1.5 text-right">ต้นทุนรวม</th>
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
                                {dish?.has_unknown_cost && <span className="ml-1 text-pending-ink" title="ต้นทุนไม่ทราบแน่ชัด">⚠</span>}
                              </td>
                              {/* Which group this row prints under on the three
                                  documents. Defaults to รายการอาหาร, so an
                                  untouched package behaves exactly as before. */}
                              <td className="px-2 py-1.5">
                                <select
                                  className="input-base"
                                  value={it.section}
                                  onChange={(e) => updateItem(it._key, { section: e.target.value })}
                                >
                                  {SET_MENU_SECTIONS.map((s) => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-1.5">
                                <input
                                  type="number" min={0}
                                  className="input-base text-right tabular-nums"
                                  value={it.quantity}
                                  onChange={(e) => updateItem(it._key, { quantity: e.target.value })}
                                />
                              </td>
                              <td className="px-2 py-1.5">
                                <input className="input-base" value={it.note} onChange={(e) => updateItem(it._key, { note: e.target.value })} />
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-neutral-600">฿{fmtBaht(lineCost)}</td>
                              <td className="px-2 py-1.5 text-center">
                                <button type="button" onClick={() => removeItem(it._key)} className={buttonClass("link", { size: "sm", dangerHover: true })}>ลบ</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <p className="mb-1 text-xs font-medium text-neutral-600">{COMPARISON_LABEL}</p>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-neutral-500">ราคาสั่งแยกจานรวม / ชุด</p>
                    <p className="tabular-nums font-medium text-neutral-800">฿{fmtBaht(dishesTotal)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500">ราคาชุดอยู่ที่</p>
                    <p className={`tabular-nums font-medium ${comparison?.direction === "below" ? "text-success-ink" : "text-neutral-800"}`}>
                      {comparisonHeadline(comparison)}
                    </p>
                  </div>
                </div>
                <p className="mt-1 text-xs text-neutral-500">{comparisonText(comparison)}</p>
              </div>

              {/* Cost and margin — this screen and the per-event menu page (owner/admin) are the places in the catering module that show them; see the comment in page.tsx. */}
              <div className="rounded-lg border border-pending/60 bg-pending-soft/60 p-3">
                <p className="mb-2 text-xs font-medium text-pending-ink">สรุปต้นทุน (Admin/Owner เท่านั้น)</p>
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
                    <p className={`tabular-nums font-medium ${profit < 0 ? "text-danger" : "text-success-ink"}`}>฿{fmtBaht(profit)}</p>
                  </div>
                </div>
                {hasUnknownCost && (
                  <p className="mt-2 text-xs text-pending-ink">⚠ มีเมนูที่ยังไม่ทราบต้นทุนแน่ชัด ตัวเลขด้านบนอาจต่ำกว่าความจริง</p>
                )}
              </div>

              {error && <p className="text-sm text-danger">{error}</p>}
            </div>

            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-neutral-100 bg-white px-5 py-3">
              <button onClick={() => setModal(null)} className={buttonClass("secondary")}>ยกเลิก</button>
              <button
                onClick={saveModal}
                disabled={isPending}
                className={buttonClass("primary")}
              >
                {isPending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
