"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { receiveOrderItems } from "../../actions";
import type { OrderSessionDetail } from "@/lib/inventory-data";

const VARIANCE_THRESHOLD = 0.3; // ±30%

function isHighVariance(ordered: number, received: number | null): boolean {
  if (received === null || ordered === 0) return false;
  return Math.abs(received - ordered) / ordered > VARIANCE_THRESHOLD;
}

export function ReceiveForm({ session }: { session: OrderSessionDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [received, setReceived] = useState<Record<string, string>>(
    Object.fromEntries(session.items.map((i) => [i.id, String(i.editorQtyOrdered ?? i.qtyOrdered)]))
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleSubmit() {
    setError(null);
    const payload = session.items.map((item) => ({
      itemId: item.id,
      qtyReceived: received[item.id]?.trim() !== "" ? parseFloat(received[item.id]) : null,
    }));

    startTransition(async () => {
      const result = await receiveOrderItems(session.id, payload);
      if (result.error) { setError(result.error); return; }
      setDone(true);
    });
  }

  const shortId = session.id.slice(0, 8).toUpperCase();

  return (
    <>
      <div className="flex items-center gap-3">
        <a href={`/staff/inventory/${session.id}`} className="text-sm text-neutral-500 hover:text-neutral-900">← กลับ</a>
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">บันทึกรับของ #{shortId}</h1>
          {session.stationName && <p className="text-sm text-neutral-500">{session.stationName}</p>}
        </div>
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        {/* Column headers */}
        <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-2">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs text-neutral-400">
            <span>วัตถุดิบ</span>
            <span className="w-28 text-right">สั่งไป</span>
            <span className="w-32 text-right">รับจริง</span>
          </div>
        </div>

        {session.items.map((item) => {
          const orderedQty = item.editorQtyOrdered ?? item.qtyOrdered;
          const receivedVal = received[item.id]?.trim();
          const receivedNum = receivedVal !== "" ? parseFloat(receivedVal) : null;
          const variance = isHighVariance(orderedQty, receivedNum);

          return (
            <div
              key={item.id}
              className={`grid grid-cols-[1fr_auto_auto] gap-2 items-center px-3 py-2.5 border-b border-neutral-100 last:border-0 ${
                variance ? "bg-amber-50" : ""
              }`}
            >
              <div>
                <span className="text-sm text-neutral-800">{item.ingredientName}</span>
                {variance && (
                  <div className="text-xs text-amber-600">ต่างจากที่สั่งเกิน 30%</div>
                )}
              </div>

              {/* Ordered (read-only) */}
              <span className="w-28 text-right text-sm text-neutral-400">
                {orderedQty > 0 ? `${orderedQty} ${item.orderUnit ?? ""}`.trim() : "—"}
              </span>

              {/* Received input */}
              <div className="flex items-center gap-1">
                <input
                  type="number" min="0" step="any"
                  value={received[item.id] ?? ""}
                  onChange={(e) => setReceived((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="เว้นว่าง = ยังไม่มา"
                  className={`w-24 rounded border px-2 py-1 text-right text-sm ${
                    variance ? "border-amber-400" : "border-neutral-300"
                  }`}
                />
                <span className="text-xs text-neutral-400 truncate w-6">{item.orderUnit ?? ""}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-neutral-400">
        เว้นว่าง = "ยังไม่มา" (ค้างในระบบ) · สีเหลือง = ต่างจากที่สั่งเกิน 30%
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {done ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-3">
          <p className="text-sm font-medium text-green-800">บันทึกรับของสำเร็จ</p>
          <div className="flex flex-wrap gap-3">
            <a href="/staff/inventory"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
              ← กลับหน้าหลัก
            </a>
            <a href={`/staff/inventory/${session.id}`}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
              ดูรายละเอียด
            </a>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-3 pb-8">
          <a href={`/staff/inventory/${session.id}`}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100">
            ยกเลิก
          </a>
          <button type="button" onClick={handleSubmit} disabled={isPending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50">
            {isPending ? "กำลังบันทึก..." : "ยืนยันรับของ"}
          </button>
        </div>
      )}
    </>
  );
}
