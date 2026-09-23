"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { receiveOrderItems } from "../../actions";
import type { OrderSessionDetail } from "@/lib/inventory-data";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";

const VARIANCE_THRESHOLD = 0.3;

function isHighVariance(ordered: number, received: number | null): boolean {
  if (received === null || ordered === 0) return false;
  return Math.abs(received - ordered) / ordered > VARIANCE_THRESHOLD;
}

export function ReceiveForm({ session }: { session: OrderSessionDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inputs, setInputs] = useState<Record<string, string>>(
    Object.fromEntries(
      session.items.map((i) => [i.id, i.qtyReceived !== null ? String(i.qtyReceived) : ""])
    )
  );
  const [error, setError] = useState<string | null>(null);

  const alreadyDone = session.items.filter((i) => i.qtyReceived !== null).length;
  const shortId = session.id.slice(0, 8).toUpperCase();

  function handleSubmit() {
    setError(null);
    // Only submit items that have a value entered (never blank → avoid un-receiving)
    const payload = session.items
      .filter((item) => inputs[item.id]?.trim() !== "")
      .map((item) => ({
        itemId: item.id,
        qtyReceived: parseFloat(inputs[item.id]) || 0,
      }));

    if (payload.length === 0) {
      setError("กรุณาใส่จำนวนอย่างน้อย 1 รายการ");
      return;
    }

    // Item 20: a throw skipped the redirect too, so the form just sat there
    // with the quantities still typed in and nothing said. Receiving stock is
    // the write where "I think I already did that" costs the most.
    startTransition(async () => {
      try {
        const result = await receiveOrderItems(session.id, payload);
        if (result.error) { setError(result.error); return; }
        // Let detail page decide if session closed — redirect there
        router.push(`/staff/inventory/${session.id}`);
      } catch {
        setError("บันทึกรับของไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่");
      }
    });
  }

  return (
    <>
      {/* The page header's shape, with this form's own back link kept as it
          was (a plain <a>, a full page load), above the title. */}
      <div className="space-y-1.5">
        <a href={`/staff/inventory/${session.id}`} className={buttonClass("link")}>← กลับ</a>
        <PageHeader
          title={<>บันทึกรับของ #{shortId}</>}
          subtitle={session.stationName ? <span>{session.stationName}</span> : undefined}
        />
      </div>

      {/* Progress */}
      {alreadyDone > 0 && (
        <div className="rounded-lg border border-success/30 bg-success-soft px-4 py-2.5 text-sm text-success-ink">
          รับแล้ว {alreadyDone} / {session.items.length} รายการ
          {alreadyDone < session.items.length && " — กรอกรายการที่มาถึงแล้วกด บันทึก ได้เลย"}
        </div>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        {/* Column headers. The two number columns are narrower on a phone
            (w-20/w-28, sm: as before): the page's shell pads the sides, and
            at the old widths the ingredient name had no room left. */}
        <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-2">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs text-neutral-500">
            <span>วัตถุดิบ</span>
            <span className="w-20 text-right sm:w-28">สั่งไป</span>
            <span className="w-28 text-right sm:w-32">รับจริง</span>
          </div>
        </div>

        {session.items.map((item) => {
          const orderedQty = item.editorQtyOrdered ?? item.reviewerQtyOrdered ?? item.qtyOrdered;
          const inputVal = inputs[item.id] ?? "";
          const receivedNum = inputVal.trim() !== "" ? parseFloat(inputVal) : null;
          const variance = isHighVariance(orderedQty, receivedNum);
          const alreadyReceived = item.qtyReceived !== null;

          return (
            <div
              key={item.id}
              className={`grid grid-cols-[1fr_auto_auto] gap-2 items-center px-3 py-2.5 border-b border-neutral-100 last:border-0 ${
                alreadyReceived && inputVal !== "" ? "bg-success-soft" : variance ? "bg-pending-soft" : ""
              }`}
            >
              <div>
                <span className="text-sm text-neutral-800">{item.ingredientName}</span>
                {alreadyReceived && (
                  <div className="text-xs text-success-ink">✓ รับแล้ว {item.qtyReceived} {item.orderUnit ?? ""} — แก้ได้ถ้าพิมพ์ผิด</div>
                )}
                {!alreadyReceived && variance && (
                  <div className="text-xs text-pending-ink">ต่างจากที่สั่งเกิน 30%</div>
                )}
              </div>

              <span className="w-20 text-right text-sm text-neutral-500 sm:w-28">
                {orderedQty > 0 ? `${orderedQty} ${item.orderUnit ?? ""}`.trim() : "—"}
              </span>

              <div className="flex items-center gap-1">
                <input
                  type="number" min="0" step="any"
                  value={inputVal}
                  onChange={(e) => setInputs((prev) => ({ ...prev, [item.id]: e.target.value }))}
                  placeholder="เว้นว่าง = ยังไม่มา"
                  className={`w-20 rounded border px-2 py-1 text-right text-sm sm:w-24 ${
                    alreadyReceived && inputVal !== "" ? "border-success/30 bg-success-soft"
                    : variance ? "border-pending/60"
                    : "border-neutral-300"
                  }`}
                />
                <span className="text-xs text-neutral-500 w-6 truncate">{item.orderUnit ?? ""}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-neutral-500">
        เว้นว่าง = ยังไม่มา (ค้างไว้ รับเพิ่มได้ภายหลัง) · สีเหลือง = ต่างจากที่สั่งเกิน 30%
      </p>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex justify-end gap-3 pb-8">
        <a href={`/staff/inventory/${session.id}`}
          className={buttonClass("secondary")}>
          ยกเลิก
        </a>
        <button type="button" onClick={handleSubmit} disabled={isPending}
          className={buttonClass("primary")}>
          {isPending ? "กำลังบันทึก..." : "บันทึกรายการที่มาแล้ว"}
        </button>
      </div>
    </>
  );
}
