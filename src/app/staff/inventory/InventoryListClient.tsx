"use client";

import { useState } from "react";
import Link from "next/link";
import { FromTemplateButton } from "./FromTemplateButton";
import type { OrderStatus, OrderSessionSummary, Template } from "@/lib/inventory-data";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { RowLink } from "@/components/ui/row-link";
import { TH_ROW } from "@/components/ui/table";
import { thaiDate } from "@/lib/thai-date";

function formatDate(iso: string) {
  return thaiDate(iso);
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  submitted: "รอตรวจสอบ",
  returned:  "ตีกลับ",
  reviewed:  "รอสั่งซื้อ",
  sent:      "สั่งแล้ว",
  received:  "รับของแล้ว",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  submitted: "bg-pending-soft text-pending-ink",
  returned:  "bg-danger-soft text-danger",
  reviewed:  "bg-info-soft text-info",
  sent:      "bg-primary-soft text-primary",
  received:  "bg-success-soft text-success-ink",
};

function SessionTable({ sessions }: { sessions: OrderSessionSummary[] }) {
  if (sessions.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className={TH_ROW}>
            <th className="px-3 py-2">วันที่</th>
            <th className="px-3 py-2">แผนก</th>
            <th className="px-3 py-2">สถานะ</th>
            <th className="px-3 py-2 text-right">รายการ</th>
            <th className="px-3 py-2">โดย</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            // The whole row opens the order.
            <RowLink key={s.id} href={`/staff/inventory/${s.id}`} className="border-b border-neutral-100 last:border-0">
              <td className="px-3 py-2 whitespace-nowrap font-medium text-neutral-900">{formatDate(s.createdAt)}</td>
              <td className="px-3 py-2 text-neutral-600">{s.stationName ?? "—"}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-neutral-500">{s.itemCount}</td>
              <td className="px-3 py-2 text-neutral-500">{s.createdByName}</td>
            </RowLink>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryListClient({
  sessions,
  currentUserId,
  templates,
}: {
  sessions: OrderSessionSummary[];
  currentUserId: string;
  templates: Template[];
}) {
  const [showAll, setShowAll] = useState(false);

  const mineSessions = sessions.filter(
    (s) => s.createdBy === currentUserId || s.status === "sent"
  );
  const active = (showAll ? sessions : mineSessions).filter(
    (s) => s.status !== "received"
  );

  return (
    <div className="space-y-3">
      {/* The shared page header: the title and what is shown LEFT, the
          two ways to start an order RIGHT; the ทุกแผนก switch sits above
          the table it filters. */}
      <PageHeader
        title="งานของฉัน"
        subtitle={<span className="text-xs">{showAll ? "ใบสั่งของทั้งหมดทุกแผนก" : "ใบสั่งของที่ฉันสร้าง + รอรับของ"}</span>}
        actions={
          <>
            {templates.length > 0 && (
              <FromTemplateButton templates={templates} />
            )}
            <Link href="/staff/inventory/new" className={buttonClass("primary")}>
              + เช็คของ / สั่งของ
            </Link>
          </>
        }
      />
      <div className="flex justify-end">
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
          <span className="text-xs text-neutral-500">ทุกแผนก</span>
          <button
            type="button"
            role="switch"
            aria-checked={showAll}
            onClick={() => setShowAll(!showAll)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              showAll ? "bg-primary" : "bg-neutral-300"
            }`}
          >
            <span
              className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                showAll ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </label>
      </div>


      {active.length > 0 ? (
        <SessionTable sessions={active} />
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
          ไม่มีรายการที่กำลังดำเนินการ
        </div>
      )}
    </div>
  );
}
