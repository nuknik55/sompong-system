"use client";

import { useState } from "react";
import Link from "next/link";
import { FromTemplateButton } from "./FromTemplateButton";
import type { OrderStatus, OrderSessionSummary, Station } from "@/lib/inventory-data";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok",
  });
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  submitted: "รอตรวจสอบ",
  returned:  "ตีกลับ",
  reviewed:  "รอสั่งซื้อ",
  sent:      "สั่งแล้ว",
  received:  "รับของแล้ว",
};

const STATUS_CLASS: Record<OrderStatus, string> = {
  submitted: "bg-amber-100 text-amber-800",
  returned:  "bg-orange-100 text-orange-800",
  reviewed:  "bg-blue-100 text-blue-800",
  sent:      "bg-purple-100 text-purple-800",
  received:  "bg-green-100 text-green-800",
};

function SessionTable({ sessions }: { sessions: OrderSessionSummary[] }) {
  if (sessions.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-xs text-neutral-500">
            <th className="px-3 py-2">วันที่</th>
            <th className="px-3 py-2">แผนก</th>
            <th className="px-3 py-2">สถานะ</th>
            <th className="px-3 py-2 text-right">รายการ</th>
            <th className="px-3 py-2">โดย</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
              <td className="px-3 py-2">
                <Link href={`/staff/inventory/${s.id}`} className="font-medium text-neutral-900 hover:underline">
                  {formatDate(s.createdAt)}
                </Link>
              </td>
              <td className="px-3 py-2 text-neutral-600">{s.stationName ?? "—"}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-neutral-500">{s.itemCount}</td>
              <td className="px-3 py-2 text-neutral-500">{s.createdByName}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryListClient({
  sessions,
  currentUserId,
  stationsWithTemplate,
}: {
  sessions: OrderSessionSummary[];
  currentUserId: string;
  stationsWithTemplate: Station[];
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
      {/* header: h1+subtitle LEFT, toggle RIGHT */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">งานของฉัน</h1>
          <p className="text-xs text-neutral-400 mt-0.5">
            {showAll ? "ใบสั่งของทั้งหมดทุกแผนก" : "ใบสั่งของที่ฉันสร้าง + รอรับของ"}
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 pt-1">
          <span className="text-xs text-neutral-500">ทุกแผนก</span>
          <button
            type="button"
            role="switch"
            aria-checked={showAll}
            onClick={() => setShowAll(!showAll)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              showAll ? "" : "bg-neutral-200"
            }`}
            style={showAll ? { backgroundColor: "#2F5A16" } : undefined}
          >
            <span
              className={`pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                showAll ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </label>
      </div>

      {/* action buttons */}
      <div className="flex gap-2 flex-wrap">
        {stationsWithTemplate.length > 0 && (
          <FromTemplateButton stations={stationsWithTemplate} />
        )}
        <Link
          href="/staff/inventory/new"
          className="rounded-md px-3 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: "#2F5A16" }}
        >
          + เช็คของ / สั่งของ
        </Link>
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
