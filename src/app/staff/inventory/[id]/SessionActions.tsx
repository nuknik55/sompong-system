"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveOrderSession,
  returnOrderSession,
  markOrderSent,
  updateOrderItems,
  cancelOrderSession,
} from "../actions";
import type { OrderSessionDetail, OrderItem } from "@/lib/inventory-data";
import {
  canApprove, canCancel, canEditLines, canReceive, canReturn, canSend, canSetHeadQty, effectiveQty, type OrderView,
} from "@/lib/order-rules";
import { buttonClass } from "@/components/ui/button";
import { TH_ROW } from "@/components/ui/table";

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

/**
 * What the person may do with this order. The database enforces every rule
 * (README item 35); order-rules.ts is its mirror, so the screen offers only
 * what will be accepted. `role` and `isCreator` come from the server page.
 */
export function SessionActions({
  session,
  role,
  isCreator,
}: {
  session: OrderSessionDetail;
  role: string;
  isCreator: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [returnNote, setReturnNote] = useState("");
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(session.status === "returned");
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [editRows, setEditRows] = useState<Record<string, EditRow>>(() => initEditRows(session.items));
  // The head's figures, one field per line, pre-filled with what stands
  // (staff's quantity, or a head's earlier one). The page keys this component
  // on the order's version, so a reload after a refusal starts from the data.
  const [headQty, setHeadQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(session.items.map((i) => [i.id, String(effectiveQty(i))])),
  );
  const [approveFailed, setApproveFailed] = useState(false);

  const view: OrderView = { role, isCreator, status: session.status };
  const mayEdit = canEditLines(view);
  const mayHeadQty = canSetHeadQty(view);
  const mayApprove = canApprove(view);
  const mayReturn = canReturn(view);
  const maySend = canSend(view);
  const mayReceive = canReceive(view);
  const mayCancel = canCancel(view);

  function patchEdit(id: string, patch: Partial<EditRow>) {
    setEditRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleCheck(itemId: string) {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  // Item 20: nothing on this screen updates optimistically, so a throw
  // leaves NOTHING on screen; these are stock movements, and "assumes it
  // worked" is the expensive half.
  const RETRY_MESSAGE = "บันทึกไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่";

  function runWrite<T extends { error?: string }>(fn: () => Promise<T>, opts?: { onOk?: (result: T) => void }) {
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.error) { setError(result.error); return; }
        opts?.onOk?.(result);
      } catch {
        setError(RETRY_MESSAGE);
      }
    });
  }

  /** The head's figure for a line, as a number; NaN when the field is not one. */
  function headFigure(itemId: string): number {
    const raw = (headQty[itemId] ?? "").trim();
    return raw === "" ? NaN : Number(raw);
  }
  const headChanged = session.items.filter((i) => headFigure(i.id) !== effectiveQty(i)).length;
  const headInvalid = session.items.some((i) => { const n = headFigure(i.id); return !Number.isFinite(n) || n < 0; });

  function handleApprove() {
    setError(null);
    setApproveFailed(false);
    if (headInvalid) { setError("จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป ยังไม่ได้อนุมัติ"); return; }
    // Every line's figure, with the version the screen read: the database
    // saves them and approves in one transaction, or does neither and says
    // why (a stale version: someone changed the order since it was opened).
    const lines = session.items.map((i) => ({ itemId: i.id, qty: headFigure(i.id) }));
    startTransition(async () => {
      try {
        const result = await approveOrderSession(session.id, session.version, lines);
        if (result.error) { setError(result.error); setApproveFailed(true); return; }
        router.refresh();
      } catch {
        setError(RETRY_MESSAGE);
        setApproveFailed(true);
      }
    });
  }

  function handleReturn() {
    setError(null);
    if (!returnNote.trim()) { setError("กรุณาระบุว่าต้องแก้อะไร ก่อนตีกลับ"); return; }
    runWrite(() => returnOrderSession(session.id, returnNote), { onOk: () => router.refresh() });
  }

  function handleMarkSent() {
    setError(null);
    runWrite(() => markOrderSent(session.id), { onOk: () => router.refresh() });
  }

  function handleCancel() {
    setError(null);
    runWrite(() => cancelOrderSession(session.id, cancelNote.trim() || undefined), { onOk: () => router.refresh() });
  }

  function editedItems() {
    return session.items.map((item) => {
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
  }

  /** The creator's edit: while waiting it just saves; after a return it also resubmits. */
  function handleSaveEdit() {
    setError(null);
    const resubmit = session.status === "returned";
    runWrite(() => updateOrderItems(session.id, editedItems(), resubmit), {
      onOk: () => { setShowEditForm(false); router.refresh(); },
    });
  }

  const orderableItems = session.items.filter((i) => effectiveQty(i) > 0);
  const receivedCount = session.items.filter((i) => i.qtyReceived !== null).length;
  const totalItems = session.items.length;
  const selfApproved = session.reviewedBy !== null && session.reviewedBy === session.createdBy;

  // The head's table (waiting, for a head) and the purchaser's checklist
  // (reviewed) share one table; it is shown even when every quantity is 0,
  // so an all-zero order still has its lines and its buttons (item 35).
  const showReviewTable = session.status === "reviewed";
  // A head reviewing a waiting order corrects it like the paper sheet: a
  // quantity field on every line, อนุมัติ saves them with the approval.
  const showHeadReview = session.status === "submitted" && (mayHeadQty || mayApprove || mayReturn);

  const editForm = (
    <div className="space-y-3">
      <div className="rounded-lg border border-neutral-200 bg-white overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className={TH_ROW}>
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
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={isPending} onClick={handleSaveEdit} className={buttonClass("primary")}>
          {isPending ? "กำลังบันทึก..." : session.status === "returned" ? "บันทึกและส่งใหม่อีกครั้ง" : "บันทึกการแก้ไข"}
        </button>
        {session.status === "submitted" && (
          <button type="button" onClick={() => { setShowEditForm(false); setEditRows(initEditRows(session.items)); }}
            className={buttonClass("secondary")}>
            ยกเลิกการแก้ไข
          </button>
        )}
      </div>
    </div>
  );

  const returnForm = showReturnForm && (
    <div className="space-y-2 rounded-lg border border-pending/60 bg-pending-soft p-3">
      <label className="block text-xs font-medium text-pending-ink" htmlFor="return-note">ต้องแก้อะไร (บอกผู้สั่ง)</label>
      <input id="return-note" type="text" placeholder="เช่น กุ้งแกะสั่งเกิน ลดเหลือ 3 โล"
        value={returnNote} onChange={(e) => setReturnNote(e.target.value)}
        className="w-full rounded-md border border-pending/60 bg-white px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <button type="button" disabled={isPending || !returnNote.trim()} onClick={handleReturn} className={buttonClass("primary", { size: "sm" })}>
          ยืนยันตีกลับ
        </button>
        <button type="button" onClick={() => setShowReturnForm(false)} className={buttonClass("secondary")}>
          ยกเลิก
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-8 no-print">
      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Cancelled: who, when, why (decision 10) */}
      {session.status === "cancelled" && (
        <div className="rounded-lg border border-neutral-300 bg-neutral-100 p-3 space-y-1">
          <p className="text-sm font-medium text-neutral-800">ยกเลิกแล้ว</p>
          <p className="text-xs text-neutral-600">
            โดย {session.cancelledByName ?? "ระบบ"}{session.cancelNote ? ` — ${session.cancelNote}` : ""}
          </p>
        </div>
      )}

      {/* Returned: the head's note beside the staff note; the creator fixes and resubmits */}
      {session.status === "returned" && (
        <div className="rounded-lg border border-pending/60 bg-pending-soft p-3 space-y-3">
          <p className="text-sm font-medium text-pending-ink">ถูกตีกลับให้แก้ไขใหม่</p>
          {session.returnNote && (
            <p className="text-sm text-pending-ink">{session.returnedByName ? `${session.returnedByName}: ` : ""}{session.returnNote}</p>
          )}
          {session.note && <p className="text-xs text-pending-ink">หมายเหตุของผู้สั่ง: {session.note}</p>}
          {mayEdit ? editForm : (
            <p className="text-xs text-pending-ink">รอ {session.createdByName} แก้ไขและส่งใหม่</p>
          )}
        </div>
      )}

      {/* Waiting for review: the creator may still edit (decision 6) */}
      {session.status === "submitted" && mayEdit && (
        <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-3">
          {showEditForm ? editForm : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-neutral-500">ยังแก้ไขรายการได้จนกว่าหัวหน้าจะอนุมัติ</p>
              <button type="button" onClick={() => setShowEditForm(true)} className={buttonClass("secondary", { size: "sm" })}>
                แก้ไขรายการ
              </button>
            </div>
          )}
        </div>
      )}

      {/* The head's review of a waiting order: the paper sheet, corrected in place */}
      {showHeadReview && (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-medium text-neutral-800">ตรวจรายการ ({session.items.length})</h3>
            <p className="text-xs text-neutral-500">
              {mayHeadQty ? "แก้จำนวนได้ในช่อง แล้วกดอนุมัติ — จำนวนที่แก้จะบันทึกพร้อมการอนุมัติ" : "รอตรวจสอบ"}
            </p>
          </div>
          <div className="divide-y divide-neutral-100">
            {session.items.map((item) => {
              const n = headFigure(item.id);
              const changed = n !== effectiveQty(item);
              const bad = !Number.isFinite(n) || n < 0;
              return (
                <div key={item.id} className={`grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2.5 ${changed ? "bg-pending-soft" : ""}`}>
                  <div className="min-w-0">
                    <div className="text-sm text-neutral-800">{item.ingredientName}</div>
                    <div className="text-xs text-neutral-500">
                      เหลือ ครัว {item.remainingKitchenQty !== null ? `${item.remainingKitchenQty} ${item.remainingKitchenUnit ?? ""}`.trim() : "—"}
                      {" · "}ตู้แช่ {item.remainingFreezerQty !== null ? `${item.remainingFreezerQty} ${item.remainingFreezerUnit ?? ""}`.trim() : "—"}
                      {(changed || item.reviewerQtyOrdered !== null) && <span className="text-pending-ink"> · ผู้สั่งขอ {item.qtyOrdered}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {mayHeadQty ? (
                      <input
                        type="number" min="0" step="any" inputMode="decimal"
                        aria-label={`จำนวนสั่ง ${item.ingredientName}`}
                        value={headQty[item.id] ?? ""}
                        onChange={(e) => setHeadQty((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        className={`w-20 rounded-md border px-2 py-1.5 text-right text-sm ${bad ? "border-danger" : changed ? "border-pending" : "border-neutral-300"}`}
                      />
                    ) : (
                      <span className="text-sm font-medium text-neutral-800">{effectiveQty(item)}</span>
                    )}
                    <span className="w-10 truncate text-xs text-neutral-500">{item.orderUnit ?? ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {(mayApprove || mayReturn) && (
            <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                {mayApprove && (
                  <button type="button" disabled={isPending || headInvalid} onClick={handleApprove} className={buttonClass("primary")}>
                    {isPending ? "กำลังบันทึก..." : headChanged > 0 ? `✓ อนุมัติ (แก้ ${headChanged} รายการ)` : "✓ อนุมัติ"}
                  </button>
                )}
                {mayReturn && (
                  <button type="button" disabled={isPending} onClick={() => setShowReturnForm((v) => !v)}
                    className={buttonClass("secondary")}>
                    ตีกลับ
                  </button>
                )}
                {approveFailed && (
                  <button type="button" onClick={() => router.refresh()} className={buttonClass("link", { size: "sm" })}>
                    โหลดข้อมูลล่าสุด
                  </button>
                )}
              </div>
              {returnForm}
            </div>
          )}
        </div>
      )}

      {/* The purchaser's checklist (reviewed) */}
      {showReviewTable && (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
            <div>
              <h3 className="text-sm font-medium text-neutral-800">รายการ ({session.items.length})</h3>
              <p className="text-xs text-neutral-500">
                {session.status === "reviewed"
                  ? `ตรวจสอบโดย ${session.reviewedByName ?? ""}${selfApproved ? " (อนุมัติเอง)" : ""}`
                  : mayHeadQty ? "แก้จำนวนได้ก่อนอนุมัติ — หลังอนุมัติจะล็อก" : "รอตรวจสอบ"}
              </p>
            </div>
            {session.status === "reviewed" && checkedItems.size > 0 && (
              <button type="button" onClick={() => setCheckedItems(new Set())}
                className="text-xs text-neutral-500 hover:text-neutral-700 underline">ล้าง</button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={TH_ROW}>
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
                  const wasEdited = item.reviewerQtyOrdered !== null && item.reviewerQtyOrdered !== item.qtyOrdered;
                  return (
                    <tr key={item.id}
                      className={`border-b border-neutral-100 last:border-0 ${wasEdited ? "bg-pending-soft" : ""}`}>
                      <td className="px-3 py-2">
                        {session.status === "reviewed" && isOrderable && (
                          <button type="button" onClick={() => toggleCheck(item.id)}
                            className={`flex h-5 w-5 items-center justify-center rounded border-2 text-xs transition-colors ${
                              isChecked ? "border-green-600 bg-green-600 text-white" : "border-neutral-300 hover:border-success/30"
                            }`}>
                            {isChecked ? "✓" : ""}
                          </button>
                        )}
                      </td>
                      <td className={`px-3 py-2 ${isChecked ? "line-through text-neutral-500" : "text-neutral-800"}`}>
                        {item.ingredientName}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-500">
                        {item.remainingKitchenQty !== null ? `${item.remainingKitchenQty} ${item.remainingKitchenUnit ?? ""}`.trim() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-500">
                        {item.remainingFreezerQty !== null ? `${item.remainingFreezerQty} ${item.remainingFreezerUnit ?? ""}`.trim() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`font-medium ${isChecked ? "line-through text-neutral-500" : "text-neutral-800"}`}>
                          {eqty > 0 ? `${eqty} ${item.orderUnit ?? ""}`.trim() : "—"}
                          {wasEdited && (
                            <span className="block text-xs font-normal text-pending-ink">แก้จาก {item.qtyOrdered}</span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Reviewed footer: mark sent (owner, admin) and return (a head) */}
          {session.status === "reviewed" && (maySend || mayReturn) && (
            <div className="border-t border-neutral-100 px-4 py-3 bg-neutral-50 space-y-2">
              {maySend && (
                <>
                  <button type="button" disabled={isPending} onClick={handleMarkSent}
                    className={buttonClass("primary", { className: "w-full" })}>
                    {isPending ? "กำลังบันทึก..." : "✓ บันทึกว่าสั่งของแล้ว"}
                  </button>
                  <p className="text-center text-xs text-neutral-500">กดหลังโทรสั่งของเรียบร้อยแล้ว</p>
                </>
              )}
              {mayReturn && (
                <div className="flex justify-center">
                  <button type="button" disabled={isPending} onClick={() => setShowReturnForm((v) => !v)}
                    className={buttonClass("link", { size: "sm" })}>
                    ตีกลับ (พบปัญหา)
                  </button>
                </div>
              )}
              {returnForm}
            </div>
          )}
        </div>
      )}

      {/* Sent: the summary, who received each line so far, receive and print */}
      {session.status === "sent" && (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-medium text-neutral-800">สรุปการสั่งซื้อ</h3>
            <p className="text-xs text-neutral-500">ส่งสั่งแล้ว{selfApproved ? " · อนุมัติเอง" : ""}</p>
          </div>
          <div className="divide-y divide-neutral-100">
            {orderableItems.map((item) => {
              const qty = effectiveQty(item);
              const wasEdited = item.reviewerQtyOrdered !== null && item.reviewerQtyOrdered !== item.qtyOrdered;
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm text-neutral-800">
                    {item.ingredientName}
                    {item.qtyReceived !== null && (
                      <span className="block text-xs text-success-ink">
                        รับแล้ว {item.qtyReceived} {item.orderUnit ?? ""}{item.receivedByName ? ` โดย ${item.receivedByName}` : ""}
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-medium text-neutral-700">
                    {qty} {item.orderUnit ?? ""}
                    {wasEdited && <span className="ml-1 text-xs text-pending-ink">(แก้จาก {item.qtyOrdered})</span>}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="border-t border-neutral-100 px-4 py-3 space-y-3">
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
              <button type="button" onClick={() => window.print()} className={buttonClass("secondary")}>
                พิมพ์ใบสั่งของ
              </button>
              {mayReceive && (
                <a href={`/staff/inventory/${session.id}/receive`} className={buttonClass("primary")}>
                  {receivedCount > 0 ? `บันทึกรับของเพิ่ม (ค้าง ${totalItems - receivedCount})` : "บันทึกรับของ →"}
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Received: print. The order is final: no line can be re-opened and it
          cannot be cancelled (the database refuses both), so the screen says so. */}
      {session.status === "received" && (
        <div className="rounded-lg border border-neutral-200 bg-white p-4 space-y-2">
          <button type="button" onClick={() => window.print()} className={buttonClass("secondary")}>
            พิมพ์ใบรับของ
          </button>
          <p className="text-xs text-neutral-500">รับของครบแล้ว — ใบสั่งของนี้ปิดแล้ว แก้จำนวนรับหรือยกเลิกไม่ได้อีก</p>
        </div>
      )}

      {/* Cancel, instead of delete (decision 10): who may is the database's call; this mirrors it */}
      {mayCancel && (
        <div className="space-y-2">
          {!showCancelForm ? (
            <button type="button" disabled={isPending} onClick={() => setShowCancelForm(true)}
              className={buttonClass("link", { size: "sm", dangerHover: true })}>
              ยกเลิกใบสั่งของ
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-danger/40 bg-danger-soft p-3">
              <p className="text-sm font-medium text-danger">ยกเลิกใบสั่งของนี้? ยกเลิกแล้วแก้กลับไม่ได้</p>
              <input type="text" placeholder="เหตุผล (ไม่จำเป็น)"
                value={cancelNote} onChange={(e) => setCancelNote(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button type="button" disabled={isPending} onClick={handleCancel} className={buttonClass("primary", { size: "sm", danger: true })}>
                  {isPending ? "กำลังยกเลิก..." : "ยืนยันยกเลิก"}
                </button>
                <button type="button" onClick={() => setShowCancelForm(false)} className={buttonClass("secondary", { size: "sm" })}>
                  ไม่ยกเลิก
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
