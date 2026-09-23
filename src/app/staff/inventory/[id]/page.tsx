import { notFound } from "next/navigation";
import { requireOrdering } from "@/lib/auth";
import { getOrderChanges, getOrderSessionDetail } from "@/lib/inventory-data";
import { STATUS_CLASS, STATUS_LABEL, isOrderHead } from "@/lib/order-rules";
import { SessionActions, effectiveQty } from "./SessionActions";
import { TH_ROW } from "@/components/ui/table";
import { PageHeader, PageShell } from "@/components/ui/page";
import { thaiDateTime } from "@/lib/thai-date";

/** The printed order and receive sheets' date (their own format). */
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
}

const FIELD_LABEL = {
  qty_ordered: "จำนวนสั่ง",
  reviewer_qty_ordered: "จำนวนที่หัวหน้าแก้",
  qty_received: "รับจริง",
} as const;

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // hr and sales are refused at the route (item 35, decision 9).
  const [profile, session] = await Promise.all([requireOrdering(), getOrderSessionDetail(id)]);
  if (!session) notFound();
  const changes = await getOrderChanges(session.id);

  const isCreator = profile.id === session.createdBy;
  const selfApproved = session.reviewedBy !== null && session.reviewedBy === session.createdBy;
  const shortId = session.id.slice(0, 8).toUpperCase();
  const showReceived = session.status === "received" || session.items.some((i) => i.qtyReceived !== null);

  return (
    // On paper the page keeps the box it printed in before the shared look
    // (max-w-2xl, space-y-4, no padding of its own): the order and receive
    // sheets below are printed documents and keep their layout.
    <PageShell className="print:max-w-2xl print:space-y-4 print:p-0">
      <PageHeader
        back={{ href: "/staff/inventory", label: "กลับ" }}
        title={<>ใบสั่งของ #{shortId}</>}
        subtitle={
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[session.status]}`}>
            {STATUS_LABEL[session.status]}
          </span>
        }
      />

      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm space-y-1">
        {session.stationName && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">แผนก</span>
            <span>{session.stationName}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="w-24 shrink-0 text-neutral-500">สร้างโดย</span>
          <span>{session.createdByName}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-24 shrink-0 text-neutral-500">ส่งเมื่อ</span>
          <span>{thaiDateTime(session.submittedAt)}</span>
        </div>
        {session.reviewedAt && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">อนุมัติโดย</span>
            <span>{session.reviewedByName}{selfApproved ? " (อนุมัติเอง)" : ""} · {thaiDateTime(session.reviewedAt)}</span>
          </div>
        )}
        {session.returnedAt && session.status === "returned" && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">ตีกลับโดย</span>
            <span>{session.returnedByName} · {thaiDateTime(session.returnedAt)}</span>
          </div>
        )}
        {session.sentAt && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">ส่งสั่งเมื่อ</span>
            <span>{thaiDateTime(session.sentAt)}</span>
          </div>
        )}
        {session.receivedAt && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">รับของเมื่อ</span>
            <span>{thaiDateTime(session.receivedAt)}</span>
          </div>
        )}
        {session.cancelledAt && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">ยกเลิกเมื่อ</span>
            <span>{session.cancelledByName ?? "ระบบ"} · {thaiDateTime(session.cancelledAt)}</span>
          </div>
        )}
        {session.note && session.status !== "returned" && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">หมายเหตุ</span>
            <span>{session.note}</span>
          </div>
        )}
        {session.returnNote && session.status !== "returned" && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">หมายเหตุหัวหน้า</span>
            <span>{session.returnNote}</span>
          </div>
        )}
      </div>

      {/* The plain table: for the creator while it waits, and for everyone once
          the order is returned, received or cancelled. A head waiting to
          review, and the reviewed and sent stages, use SessionActions' table. */}
      {!(session.status === "sent" || session.status === "reviewed" || (session.status === "submitted" && isOrderHead(profile.role))) && (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden print:hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h2 className="text-sm font-medium text-neutral-800">รายการ ({session.items.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={TH_ROW}>
                  <th className="px-3 py-2 text-left">วัตถุดิบ</th>
                  <th className="px-3 py-2 text-right">เหลือ (ครัว)</th>
                  <th className="px-3 py-2 text-right">เหลือ (ตู้แช่)</th>
                  <th className="px-3 py-2 text-right">สั่ง</th>
                  {showReceived && <th className="px-3 py-2 text-right">รับจริง</th>}
                </tr>
              </thead>
              <tbody>
                {session.items.map((item) => {
                  const eqty = effectiveQty(item);
                  const wasEdited = item.reviewerQtyOrdered !== null && item.reviewerQtyOrdered !== item.qtyOrdered;
                  return (
                    <tr key={item.id} className={`border-b border-neutral-100 last:border-0 ${wasEdited ? "bg-pending-soft" : ""}`}>
                      <td className="px-3 py-2 text-neutral-800">{item.ingredientName}</td>
                      <td className="px-3 py-2 text-right text-neutral-500">
                        {item.remainingKitchenQty !== null ? `${item.remainingKitchenQty} ${item.remainingKitchenUnit ?? ""}`.trim() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-500">
                        {item.remainingFreezerQty !== null ? `${item.remainingFreezerQty} ${item.remainingFreezerUnit ?? ""}`.trim() : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-neutral-800">
                        {eqty > 0 ? `${eqty} ${item.orderUnit ?? ""}`.trim() : "—"}
                        {wasEdited && (
                          <div className="text-xs font-normal text-pending-ink">แก้จาก {item.qtyOrdered}</div>
                        )}
                      </td>
                      {showReceived && (
                        <td className="px-3 py-2 text-right text-success-ink">
                          {item.qtyReceived !== null
                            ? <>
                                {`${item.qtyReceived} ${item.orderUnit ?? ""}`.trim()}
                                {item.receivedByName && <div className="text-xs font-normal text-neutral-500">โดย {item.receivedByName}</div>}
                              </>
                            : <span className="text-neutral-500">ยังไม่มา</span>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Print layout: order form (non-received) */}
      {session.status !== "received" && (
        <div className="hidden print:block space-y-2">
          <h2 className="font-semibold">ใบสั่งของ #{shortId} — {session.stationName ?? ""}</h2>
          <p className="text-sm text-gray-500">{formatDate(session.submittedAt)}</p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="border border-gray-400 px-2 py-1 w-6">✓</th>
                <th className="border border-gray-400 px-2 py-1 text-left">วัตถุดิบ</th>
                <th className="border border-gray-400 px-2 py-1 text-right">สั่ง</th>
              </tr>
            </thead>
            <tbody>
              {session.items
                .filter((i) => effectiveQty(i) > 0)
                .map((item) => (
                  <tr key={item.id}>
                    <td className="border border-gray-400 px-2 py-1">□</td>
                    <td className="border border-gray-400 px-2 py-1">{item.ingredientName}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right font-medium">
                      {effectiveQty(item)} {item.orderUnit ?? ""}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Print layout: receive record (received only) */}
      {session.status === "received" && (
        <div className="hidden print:block space-y-2">
          <h2 className="font-semibold">ใบรับของ #{shortId} — {session.stationName ?? ""}</h2>
          <p className="text-sm text-gray-500">รับของเมื่อ {formatDate(session.receivedAt!)}</p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="border border-gray-400 px-2 py-1 text-left">วัตถุดิบ</th>
                <th className="border border-gray-400 px-2 py-1 text-right">สั่ง</th>
                <th className="border border-gray-400 px-2 py-1 text-right">รับจริง</th>
              </tr>
            </thead>
            <tbody>
              {session.items
                .filter((i) => effectiveQty(i) > 0)
                .map((item) => (
                  <tr key={item.id}>
                    <td className="border border-gray-400 px-2 py-1">{item.ingredientName}</td>
                    <td className="border border-gray-400 px-2 py-1 text-right">
                      {effectiveQty(item)} {item.orderUnit ?? ""}
                    </td>
                    <td className="border border-gray-400 px-2 py-1 text-right font-medium">
                      {item.qtyReceived !== null ? `${item.qtyReceived} ${item.orderUnit ?? ""}` : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <SessionActions session={session} role={profile.role} isCreator={isCreator} />

      {/* Every quantity change: who, old, new, when (item 35, decision 3) */}
      {changes.length > 0 && (
        <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden print:hidden">
          <div className="px-4 py-3 border-b border-neutral-100">
            <h2 className="text-sm font-medium text-neutral-800">ประวัติการแก้จำนวน ({changes.length})</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={TH_ROW}>
                  <th className="px-3 py-2 text-left">เมื่อ</th>
                  <th className="px-3 py-2 text-left">วัตถุดิบ</th>
                  <th className="px-3 py-2 text-left">ช่อง</th>
                  <th className="px-3 py-2 text-right">จาก</th>
                  <th className="px-3 py-2 text-right">เป็น</th>
                  <th className="px-3 py-2 text-left">โดย</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-neutral-600">{thaiDateTime(c.changedAt)}</td>
                    <td className="px-3 py-2 text-neutral-800">{c.itemName}</td>
                    <td className="px-3 py-2 text-neutral-600">{FIELD_LABEL[c.field]}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{c.oldValue ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-neutral-800">{c.newValue ?? "—"}</td>
                    <td className="px-3 py-2 text-neutral-600">{c.changedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageShell>
  );
}
