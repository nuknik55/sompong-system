"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveOrderSession,
  returnOrderSession,
  resubmitOrderSession,
  markOrderSent,
} from "../actions";
import type { OrderSessionDetail, OrderItem } from "@/lib/inventory-data";

export function SessionActions({
  session,
  canApprove,
  isCreator,
}: {
  session: OrderSessionDetail;
  canApprove: boolean;
  isCreator: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [returnNote, setReturnNote] = useState("");
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function toggleCheck(itemId: string) {
    setCheckedItems((prev) => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  }

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveOrderSession(session.id);
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

  function handleResubmit() {
    setError(null);
    startTransition(async () => {
      const result = await resubmitOrderSession(session.id);
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

  const orderableItems = session.items.filter((i) => i.qtyOrdered > 0);

  return (
    <div className="space-y-4 pb-8 no-print">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* ตีกลับ — returned status: creator can resubmit */}
      {session.status === "returned" && isCreator && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-sm font-medium text-amber-800">ถูกตีกลับให้แก้ไขใหม่</p>
          {session.note && <p className="text-sm text-amber-700">{session.note}</p>}
          <button type="button" disabled={isPending} onClick={handleResubmit}
            className="rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50">
            {isPending ? "กำลังส่ง..." : "ส่งใหม่อีกครั้ง"}
          </button>
        </div>
      )}

      {/* Approve / Return — editor+ when submitted */}
      {session.status === "submitted" && canApprove && (
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={isPending} onClick={handleApprove}
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50">
            อนุมัติ
          </button>
          <button type="button" disabled={isPending} onClick={() => setShowReturnForm((v) => !v)}
            className="rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50">
            ตีกลับ
          </button>
        </div>
      )}

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

      {/* Order sheet with interactive checkboxes (approved/sent status) */}
      {(session.status === "approved" || session.status === "sent") && orderableItems.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100">
            <h3 className="text-sm font-medium text-neutral-800">ใบสั่งของ</h3>
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span>อนุมัติโดย {session.approvedByName}</span>
              {checkedItems.size > 0 && (
                <button type="button" onClick={() => setCheckedItems(new Set())}
                  className="text-neutral-400 hover:text-neutral-700 underline">ล้าง</button>
              )}
            </div>
          </div>
          <div className="divide-y divide-neutral-100">
            {orderableItems.map((item: OrderItem) => {
              const isChecked = checkedItems.has(item.id);
              const effectiveQty = item.editorQtyOrdered ?? item.qtyOrdered;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleCheck(item.id)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isChecked ? "bg-neutral-50" : "hover:bg-neutral-50"
                  }`}
                >
                  {/* Checkbox visual */}
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 text-xs ${
                    isChecked
                      ? "border-green-600 bg-green-600 text-white"
                      : "border-neutral-300"
                  }`}>
                    {isChecked ? "✓" : ""}
                  </span>
                  <span className={`flex-1 text-sm ${isChecked ? "line-through text-neutral-400" : "text-neutral-800"}`}>
                    {item.ingredientName}
                  </span>
                  <span className={`text-sm font-medium ${isChecked ? "line-through text-neutral-400" : "text-neutral-700"}`}>
                    {effectiveQty} {item.orderUnit ?? ""}
                    {item.editorQtyOrdered !== null && item.editorQtyOrdered !== item.qtyOrdered && (
                      <span className="ml-1 text-xs text-amber-600">(แก้จาก {item.qtyOrdered})</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {/* ส่งใบสั่งของ */}
          {session.status === "approved" && (
            <div className="border-t border-neutral-100 px-4 py-3">
              <button type="button" disabled={isPending} onClick={handleMarkSent}
                className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
                {isPending ? "กำลังบันทึก..." : "ส่งใบสั่งของ"}
              </button>
              <p className="mt-1 text-center text-xs text-neutral-400">บันทึกเวลาที่ส่งสั่งของจริง</p>
            </div>
          )}
        </div>
      )}

      {/* Print + Receive link */}
      <div className="flex flex-wrap gap-3">
        {(session.status === "approved" || session.status === "sent") && (
          <>
            <button type="button" onClick={() => window.print()}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
              พิมพ์ใบสั่งของ
            </button>
            <a href={`/staff/inventory/${session.id}/receive`}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
              บันทึกรับของ →
            </a>
          </>
        )}
      </div>
    </div>
  );
}
