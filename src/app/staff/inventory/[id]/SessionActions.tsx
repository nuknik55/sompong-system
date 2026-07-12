"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  reviewOrderSession,
  returnOrderSession,
  markOrderSent,
  updateItemsAndResubmit,
  saveReviewerItemEdit,
  saveEditorItemEdit,
} from "../actions";
import type { OrderSessionDetail, OrderItem } from "@/lib/inventory-data";

type EditRow = {
  kitchenQty: string;
  kitchenUnit: string;
  freezerQty: string;
  freezerUnit: string;
  qty: string;
  unit: string;
};

function initEditRows(items: OrderItem[]): Record<string, EditRow> {
  return Object.fromEntries(
    items.map((i) => [
      i.id,
      {
        kitchenQty: i.remainingKitchenQty !== null ? String(i.remainingKitchenQty) : "",
        kitchenUnit: i.remainingKitchenUnit ?? "",
        freezerQty: i.remainingFreezerQty !== null ? String(i.remainingFreezerQty) : "",
        freezerUnit: i.remainingFreezerUnit ?? "",
        qty: String(i.qtyOrdered),
        unit: i.orderUnit ?? "",
      },
    ])
  );
}

export function SessionActions({
  session,
  canReview,
  isCreator,
}: {
  session: OrderSessionDetail;
  canReview: boolean;
  isCreator: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [returnNote, setReturnNote] = useState("");
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [editRows, setEditRows] = useState<Record<string, EditRow>>(() => initEditRows(session.items));
  const [editingQty, setEditingQty] = useState<string | null>(null);
  const [editQtyVal, setEditQtyVal] = useState("");

  function patchEdit(id: string, patch: Partial<EditRow>) {
    setEditRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleCheck(itemId: string) {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  function handleReview() {
    setError(null);
    startTransition(async () => {
      const result = await reviewOrderSession(session.id);
      if (result.error) { setError(result.error); return; }
      router.refresh();
    });
  }

  function handleReturn() {
    setError(null);
    startTransition(async () => {
      const result = await returnOrderSession(session.id, returnNote.trim() || undefined);
      if (result.error) { setError(result.error); return; }
      router.refresh();
    });
  }

  function handleMarkSent() {
    setError(null);
    startTransition(async () => {
      const result = await markOrderSent(session.id);
      if (result.error) { setError(result.error); return; }
      router.refresh();
    });
  }

  function handleUpdateAndResubmit() {
    setError(null);
    const items = session.items.map((item) => {
      const row = editRows[item.id];
      return {
        itemId: item.id,
        remainingKitchenQty: row.kitchenQty.trim() !== "" ? parseFloat(row.kitchenQty) : null,
        remainingKitchenUnit: row.kitchenUnit.trim() || null,
        remainingFreezerQty: row.freezerQty.trim() !== "" ? parseFloat(row.freezerQty) : null,
        remainingFreezerUnit: row.freezerUnit.trim() || null,
        qtyOrdered: parseFloat(row.qty) || 0,
        orderUnit: row.unit.trim() || null,
      };
    });
    startTransition(async () => {
      const result = await updateItemsAndResubmit(session.id, items);
      if (result.error) { setError(result.error); return; }
      router.refresh();
    });
  }

  function startEditQty(itemId: string, currentQty: number) {
    setEditingQty(itemId);
    setEditQtyVal(String(currentQty));
  }

  function saveQtyEdit(itemId: string) {
    const val = parseFloat(editQtyVal);
    const isReviewStage = session.status === "reviewed";
    startTransition(async () => {
      const result = isReviewStage
        ? await saveReviewerItemEdit(itemId, isNaN(val) ? null : val, session.id)
        : await saveEditorItemEdit(itemId, isNaN(val) ? null : val, session.id);
      if (result.error) { setError(result.error); return; }
      setEditingQty(null);
      router.refresh();
    });
  }

  // effective qty: purchaser edit > reviewer edit > original
  function effectiveQty(item: OrderItem) {
    return item.editorQtyOrdered ?? item.reviewerQtyOrdered ?? item.qtyOrdered;
  }

  const orderableItems = session.items.filter((i) => effectiveQty(i) > 0);
  const receivedCount = session.items.filter((i) => i.qtyReceived !== null).length;
  const totalItems = session.items.length;

  // Show order checklist when reviewed or sent
  const showChecklist = (session.status === "reviewed" || session.status === "sent") && orderableItems.length > 0;
  // Allow inline qty edit: reviewer edits during "reviewed", purchaser edits during "sent"
  const canEditQty = (session.status === "reviewed" && canReview) || session.status === "sent";

  return (
    <div className="space-y-4 pb-8 no-print">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* ตีกลับ — edit form */}
      {session.status === "returned" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
          <p className="text-sm font-medium text-amber-800">ถูกตีกลับให้แก้ไขใหม่</p>
          {session.note && <p className="text-sm text-amber-700">{session.note}</p>}

          <div className="rounded-lg border border-amber-200 bg-white overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-amber-100 bg-amber-50 text-neutral-500">
                  <th className="px-2 py-2 text-left">วัตถุดิบ</th>
                  <th className="px-2 py-2 text-right">เหลือ(ครัว)</th>
                  <th className="px-2 py-2 text-left">หน่วย</th>
                  <th className="px-2 py-2 text-right">เหลือ(ตู้แช่)</th>
                  <th className="px-2 py-2 text-left">หน่วย</th>
                  <th className="px-2 py-2 text-right">สั่ง</th>
                  <th className="px-2 py-2 text-left">หน่วยสั่ง</th>
                </tr>
              </thead>
              <tbody>
                {session.items.map((item) => {
                  const row = editRows[item.id];
                  return (
                    <tr key={item.id} className="border-b border-neutral-100 last:border-0">
                      <td className="px-2 py-1.5 text-neutral-800">{item.ingredientName}</td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" value={row.kitchenQty}
                          onChange={(e) => patchEdit(item.id, { kitchenQty: e.target.value })}
                          className="w-16 rounded border border-neutral-300 px-1.5 py-1 text-right text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={row.kitchenUnit}
                          onChange={(e) => patchEdit(item.id, { kitchenUnit: e.target.value })}
                          className="w-12 rounded border border-neutral-300 px-1.5 py-1 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" value={row.freezerQty}
                          onChange={(e) => patchEdit(item.id, { freezerQty: e.target.value })}
                          className="w-16 rounded border border-neutral-300 px-1.5 py-1 text-right text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={row.freezerUnit}
                          onChange={(e) => patchEdit(item.id, { freezerUnit: e.target.value })}
                          className="w-12 rounded border border-neutral-300 px-1.5 py-1 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" min="0" step="any" value={row.qty}
                          onChange={(e) => patchEdit(item.id, { qty: e.target.value })}
                          className="w-16 rounded border border-neutral-300 px-1.5 py-1 text-right text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="text" value={row.unit}
                          onChange={(e) => patchEdit(item.id, { unit: e.target.value })}
                          className="w-14 rounded border border-neutral-300 px-1.5 py-1 text-xs" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button type="button" disabled={isPending} onClick={handleUpdateAndResubmit}
            className="rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50">
            {isPending ? "กำลังส่ง..." : "บันทึกและส่งใหม่อีกครั้ง"}
          </button>
        </div>
      )}

      {/* ขั้นที่ 1: ตรวจสอบ (submitted → reviewed) */}
      {session.status === "submitted" && canReview && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={isPending} onClick={handleReview}
              className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">
              {isPending ? "กำลังบันทึก..." : "✓ ตรวจสอบแล้ว"}
            </button>
            <button type="button" disabled={isPending} onClick={() => setShowReturnForm((v) => !v)}
              className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
              ตีกลับ
            </button>
          </div>
          {showReturnForm && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <input type="text" placeholder="เหตุผล / ข้อความถึง staff (ไม่จำเป็น)"
                value={returnNote} onChange={(e) => setReturnNote(e.target.value)}
                className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button type="button" disabled={isPending} onClick={handleReturn}
                  className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50">
                  ยืนยันตีกลับ
                </button>
                <button type="button" onClick={() => setShowReturnForm(false)}
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-white">
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Merged item table (reviewed) + simplified list (sent) */}
      {showChecklist && (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
            <div>
              <h3 className="text-sm font-medium text-neutral-800">
                {session.status === "reviewed"
                  ? `รายการ (${session.items.length})`
                  : "สรุปการสั่งซื้อ"}
              </h3>
              <p className="text-xs text-neutral-400">
                {session.status === "reviewed"
                  ? "ตรวจสอบโดย " + (session.reviewedByName ?? "")
                  : "ส่งสั่งแล้ว"}
              </p>
            </div>
            {session.status === "reviewed" && checkedItems.size > 0 && (
              <button type="button" onClick={() => setCheckedItems(new Set())}
                className="text-xs text-neutral-400 hover:text-neutral-700 underline">ล้าง</button>
            )}
          </div>

          {/* reviewed: full table — all items, checkbox only when qty > 0 */}
          {session.status === "reviewed" && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50 text-xs text-neutral-400">
                    <th className="px-3 py-2 w-8" />
                    <th className="px-3 py-2 text-left">วัตถุดิบ</th>
                    <th className="px-3 py-2 text-right">เหลือ (ครัว)</th>
                    <th className="px-3 py-2 text-right">เหลือ (ตู้แช่)</th>
                    <th className="px-3 py-2 text-right">สั่ง</th>
                  </tr>
                </thead>
                <tbody>
                  {session.items.map((item) => {
                    const eqty = effectiveQty(item);
                    const isOrderable = eqty > 0;
                    const isChecked = checkedItems.has(item.id);
                    const wasEdited =
                      (item.editorQtyOrdered !== null && item.editorQtyOrdered !== item.qtyOrdered) ||
                      (item.reviewerQtyOrdered !== null && item.reviewerQtyOrdered !== item.qtyOrdered);
                    const isEditingThis = editingQty === item.id;
                    return (
                      <tr key={item.id}
                        className={`border-b border-neutral-100 last:border-0 ${wasEdited ? "bg-amber-50" : ""}`}>
                        <td className="px-3 py-2">
                          {isOrderable && (
                            <button type="button" onClick={() => toggleCheck(item.id)}
                              className={`flex h-5 w-5 items-center justify-center rounded border-2 text-xs transition-colors ${
                                isChecked
                                  ? "border-green-600 bg-green-600 text-white"
                                  : "border-neutral-300 hover:border-green-400"
                              }`}>
                              {isChecked ? "✓" : ""}
                            </button>
                          )}
                        </td>
                        <td className={`px-3 py-2 ${isChecked ? "line-through text-neutral-400" : "text-neutral-800"}`}>
                          {item.ingredientName}
                        </td>
                        <td className="px-3 py-2 text-right text-neutral-500">
                          {item.remainingKitchenQty !== null
                            ? `${item.remainingKitchenQty} ${item.remainingKitchenUnit ?? ""}`.trim()
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-neutral-500">
                          {item.remainingFreezerQty !== null
                            ? `${item.remainingFreezerQty} ${item.remainingFreezerUnit ?? ""}`.trim()
                            : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isEditingThis ? (
                            <div className="flex items-center justify-end gap-1">
                              <input autoFocus type="number" min="0" step="any"
                                value={editQtyVal}
                                onChange={(e) => setEditQtyVal(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") saveQtyEdit(item.id);
                                  if (e.key === "Escape") setEditingQty(null);
                                }}
                                className="w-20 rounded border border-blue-400 bg-blue-50 px-2 py-1 text-right text-sm" />
                              <button type="button" onClick={() => saveQtyEdit(item.id)} disabled={isPending}
                                className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50">✓</button>
                              <button type="button" onClick={() => setEditingQty(null)}
                                className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100">✕</button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-2">
                              <span className={`font-medium ${isChecked ? "line-through text-neutral-400" : "text-neutral-800"}`}>
                                {eqty > 0 ? `${eqty} ${item.orderUnit ?? ""}`.trim() : "—"}
                                {wasEdited && (
                                  <span className="block text-xs font-normal text-amber-600">แก้จาก {item.qtyOrdered}</span>
                                )}
                              </span>
                              {canEditQty && isOrderable && !isChecked && (
                                <button type="button" onClick={() => startEditQty(item.id, eqty)}
                                  className="text-xs text-blue-400 hover:text-blue-600 hover:underline">แก้</button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* sent: read-only list — name + qty + wasEdited badge */}
          {session.status === "sent" && (
            <div className="divide-y divide-neutral-100">
              {orderableItems.map((item: OrderItem) => {
                const qty = effectiveQty(item);
                const wasEdited =
                  (item.editorQtyOrdered !== null && item.editorQtyOrdered !== item.qtyOrdered) ||
                  (item.reviewerQtyOrdered !== null && item.reviewerQtyOrdered !== item.qtyOrdered);
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm text-neutral-800">{item.ingredientName}</span>
                    <span className="text-sm font-medium text-neutral-700">
                      {qty} {item.orderUnit ?? ""}
                      {wasEdited && (
                        <span className="ml-1 text-xs text-amber-600">(แก้จาก {item.qtyOrdered})</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* reviewed footer: mark sent + return */}
          {session.status === "reviewed" && canReview && (
            <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50 space-y-2">
              <button type="button" disabled={isPending} onClick={handleMarkSent}
                className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
                {isPending ? "กำลังบันทึก..." : "✓ บันทึกว่าสั่งของแล้ว"}
              </button>
              <p className="text-center text-xs text-neutral-400">กดหลังโทรสั่งของเรียบร้อยแล้ว</p>
              <div className="flex justify-center">
                <button type="button" disabled={isPending} onClick={() => setShowReturnForm((v) => !v)}
                  className="text-xs text-amber-600 hover:underline">
                  ตีกลับ (พบปัญหา)
                </button>
              </div>
              {showReturnForm && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <input type="text" placeholder="เหตุผล (ไม่จำเป็น)"
                    value={returnNote} onChange={(e) => setReturnNote(e.target.value)}
                    className="w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <button type="button" disabled={isPending} onClick={handleReturn}
                      className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50">
                      ยืนยันตีกลับ
                    </button>
                    <button type="button" onClick={() => setShowReturnForm(false)}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-white">
                      ยกเลิก
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* sent footer: purple note */}
          {session.status === "sent" && (
            <div className="border-t border-neutral-100 px-4 py-2 bg-purple-50">
              <p className="text-xs text-purple-600">✓ ส่งสั่งของแล้ว — ถ้าของมาไม่ครบ บันทึกจำนวนจริงตอนรับของได้เลย</p>
            </div>
          )}
        </div>
      )}

      {/* Receive section (sent) */}
      {session.status === "sent" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
          {receivedCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-full bg-neutral-200 h-2 overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${(receivedCount / totalItems) * 100}%` }} />
              </div>
              <span className="text-xs text-neutral-500 shrink-0">รับแล้ว {receivedCount}/{totalItems}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => window.print()}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
              พิมพ์ใบสั่งของ
            </button>
            <a href={`/staff/inventory/${session.id}/receive`}
              className="rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "#2F5A16" }}>
              {receivedCount > 0 ? `บันทึกรับของเพิ่ม (ค้าง ${totalItems - receivedCount})` : "บันทึกรับของ →"}
            </a>
          </div>
        </div>
      )}

      {/* Print button (received) */}
      {session.status === "received" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <button type="button" onClick={() => window.print()}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
            พิมพ์ใบรับของ
          </button>
        </div>
      )}
    </div>
  );
}
