import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getOrderSessionDetail } from "@/lib/inventory-data";
import { SessionActions } from "./SessionActions";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  submitted: "รออนุมัติ",
  returned:  "ตีกลับ",
  approved:  "อนุมัติแล้ว",
  sent:      "ส่งแล้ว",
  received:  "รับของแล้ว",
};

const STATUS_CLASS: Record<string, string> = {
  submitted: "bg-amber-100 text-amber-800",
  returned:  "bg-orange-100 text-orange-800",
  approved:  "bg-blue-100 text-blue-800",
  sent:      "bg-purple-100 text-purple-800",
  received:  "bg-green-100 text-green-800",
};

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [profile, session] = await Promise.all([requireProfile(), getOrderSessionDetail(id)]);
  if (!session) notFound();

  const canApprove = profile.role !== "staff" && profile.role !== "accounting";
  const isCreator = profile.id === session.createdBy;
  const shortId = session.id.slice(0, 8).toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/staff/inventory" className="text-sm text-neutral-500 hover:text-neutral-900">← กลับ</Link>
        <div className="flex items-center gap-2 flex-1">
          <h1 className="text-lg font-semibold text-neutral-900">ใบสั่งของ #{shortId}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[session.status] ?? ""}`}>
            {STATUS_LABEL[session.status] ?? session.status}
          </span>
        </div>
      </div>

      {/* Meta */}
      <div className="rounded-lg border border-neutral-200 bg-white p-4 text-sm space-y-1">
        {session.stationName && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">สถานี</span>
            <span>{session.stationName}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="w-24 shrink-0 text-neutral-500">สร้างโดย</span>
          <span>{session.createdByName}</span>
        </div>
        <div className="flex gap-2">
          <span className="w-24 shrink-0 text-neutral-500">ส่งเมื่อ</span>
          <span>{formatDate(session.submittedAt)}</span>
        </div>
        {session.approvedAt && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">อนุมัติโดย</span>
            <span>{session.approvedByName} · {formatDate(session.approvedAt)}</span>
          </div>
        )}
        {session.sentAt && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">ส่งสั่งเมื่อ</span>
            <span>{formatDate(session.sentAt)}</span>
          </div>
        )}
        {session.receivedAt && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">รับของเมื่อ</span>
            <span>{formatDate(session.receivedAt)}</span>
          </div>
        )}
        {session.note && session.status !== "returned" && (
          <div className="flex gap-2">
            <span className="w-24 shrink-0 text-neutral-500">หมายเหตุ</span>
            <span>{session.note}</span>
          </div>
        )}
      </div>

      {/* Items table */}
      <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-100">
          <h2 className="text-sm font-medium text-neutral-800">รายการ ({session.items.length})</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50 text-xs text-neutral-400">
                <th className="px-3 py-2 text-left">วัตถุดิบ</th>
                <th className="px-3 py-2 text-right">เหลือ (ครัว)</th>
                <th className="px-3 py-2 text-right">เหลือ (ตู้แช่)</th>
                <th className="px-3 py-2 text-right">สั่ง</th>
                {session.status === "received" && (
                  <th className="px-3 py-2 text-right">รับจริง</th>
                )}
              </tr>
            </thead>
            <tbody>
              {session.items.map((item) => {
                const effectiveQty = item.editorQtyOrdered ?? item.qtyOrdered;
                const wasEdited = item.editorQtyOrdered !== null && item.editorQtyOrdered !== item.qtyOrdered;
                return (
                  <tr key={item.id} className={`border-b border-neutral-100 last:border-0 ${wasEdited ? "bg-amber-50" : ""}`}>
                    <td className="px-3 py-2 text-neutral-800">{item.ingredientName}</td>
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
                    <td className="px-3 py-2 text-right font-medium text-neutral-800">
                      {effectiveQty > 0 ? `${effectiveQty} ${item.orderUnit ?? ""}`.trim() : "—"}
                      {wasEdited && (
                        <div className="text-xs font-normal text-amber-600">แก้จาก {item.qtyOrdered}</div>
                      )}
                    </td>
                    {session.status === "received" && (
                      <td className="px-3 py-2 text-right text-green-700">
                        {item.qtyReceived !== null
                          ? `${item.qtyReceived} ${item.orderUnit ?? ""}`.trim()
                          : <span className="text-neutral-400">ยังไม่มา</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Print section (hidden on screen, visible when printing) */}
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
            {session.items.filter((i) => (i.editorQtyOrdered ?? i.qtyOrdered) > 0).map((item) => (
              <tr key={item.id}>
                <td className="border border-gray-400 px-2 py-1">□</td>
                <td className="border border-gray-400 px-2 py-1">{item.ingredientName}</td>
                <td className="border border-gray-400 px-2 py-1 text-right font-medium">
                  {item.editorQtyOrdered ?? item.qtyOrdered} {item.orderUnit ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SessionActions session={session} canApprove={canApprove} isCreator={isCreator} />
    </div>
  );
}
