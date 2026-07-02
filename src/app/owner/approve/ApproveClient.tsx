"use client";

import { useState, useTransition } from "react";
import { approveChange, rejectChange } from "@/app/owner/approve/actions";
import type { PendingChange } from "@/lib/pending-data";

const CHANGE_TYPE_LABEL: Record<string, string> = {
  recipe_edit: "แก้สูตร",
  prep_yield_edit: "แก้ yield ของเตรียม",
  menu_create: "สร้างเมนูใหม่",
  menu_delete: "ลบเมนู",
  prep_create: "สร้างของเตรียมใหม่",
  prep_delete: "ลบของเตรียม",
  ingredient_edit: "แก้วัตถุดิบ",
  ingredient_create: "สร้างวัตถุดิบใหม่",
  ingredient_delete: "ลบวัตถุดิบ",
  sop_upsert: "บันทึก SOP",
  sop_delete: "ลบ SOP",
};

function payloadSummary(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "recipe_edit":
      return `${payload.target === "menu" ? "เมนู" : "ของเตรียม"}: ${payload.parentName ?? payload.parentId}`;
    case "prep_yield_edit":
      return `${payload.parentName ?? payload.parentId}: ${payload.qty} ${payload.unit}`;
    case "menu_create":
      return `"${payload.name}" หมวด ${payload.category || "-"} ราคา ${payload.sellingPrice} บาท`;
    case "menu_delete":
      return `ลบ "${payload.menuName}"`;
    case "prep_create":
      return `"${payload.name}" ${payload.batchYieldQty} ${payload.batchYieldUnit}`;
    case "prep_delete":
      return `ลบ "${payload.prepName}"`;
    case "ingredient_create":
      return `"${payload.ingredientName}"`;
    case "ingredient_edit":
      return `"${payload.ingredientName}"`;
    case "ingredient_delete":
      return `ลบ "${payload.ingredientName}"`;
    case "sop_upsert":
      return `"${payload.menuName}"`;
    case "sop_delete":
      return `ลบ SOP "${payload.menuName}"`;
    default:
      return JSON.stringify(payload).slice(0, 80);
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function ChangeRow({ change, onDone }: { change: PendingChange; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveChange(change.id);
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  }

  function handleReject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectChange(change.id, note);
      if (res.error) { setError(res.error); return; }
      setShowReject(false);
      onDone();
    });
  }

  const statusBadge: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
  };
  const statusLabel: Record<string, string> = {
    pending: "รอดำเนินการ", approved: "อนุมัติแล้ว", rejected: "ปฏิเสธแล้ว",
  };

  return (
    <li className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-neutral-800">
            {CHANGE_TYPE_LABEL[change.changeType] ?? change.changeType}
          </span>
          <span className="mx-2 text-neutral-400">—</span>
          <span className="text-sm text-neutral-600">{payloadSummary(change.changeType, change.payload)}</span>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge[change.status]}`}>
          {statusLabel[change.status]}
        </span>
      </div>

      <div className="text-xs text-neutral-400">
        โดย <span className="font-medium text-neutral-600">{change.editorName}</span>
        {" · "}{formatDate(change.createdAt)}
        {change.resolvedAt && ` · ดำเนินการแล้ว ${formatDate(change.resolvedAt)}`}
      </div>

      {change.status === "rejected" && change.adminNote && (
        <p className="text-xs text-red-600">เหตุผลปฏิเสธ: {change.adminNote}</p>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {change.status === "pending" && !showReject && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={isPending}
            onClick={handleApprove}
            className="rounded-md bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
          >
            {isPending ? "กำลังดำเนินการ..." : "✓ อนุมัติ"}
          </button>
          <button
            type="button"
            onClick={() => setShowReject(true)}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
          >
            ✕ ปฏิเสธ
          </button>
        </div>
      )}

      {change.status === "pending" && showReject && (
        <div className="space-y-2 pt-1">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เหตุผลที่ปฏิเสธ (ไม่บังคับ) — Editor จะเห็นข้อความนี้"
            rows={2}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={handleReject}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isPending ? "กำลังดำเนินการ..." : "ยืนยันปฏิเสธ"}
            </button>
            <button
              type="button"
              onClick={() => setShowReject(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function ApproveClient({ changes }: { changes: PendingChange[] }) {
  const [list, setList] = useState(changes);

  const pending = list.filter((c) => c.status === "pending");
  const resolved = list.filter((c) => c.status !== "pending");

  if (list.length === 0) {
    return <p className="py-12 text-center text-sm text-neutral-400">ไม่มีรายการรอดำเนินการ</p>;
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 font-kanit font-medium text-neutral-700">รอดำเนินการ ({pending.length})</h2>
          <ul className="space-y-3">
            {pending.map((c) => (
              <ChangeRow
                key={c.id}
                change={c}
                onDone={() => setList((prev) => prev.map((x) => x.id === c.id ? { ...x, status: "approved" as const } : x))}
              />
            ))}
          </ul>
        </section>
      )}
      {pending.length === 0 && (
        <p className="py-4 text-center text-sm text-neutral-400">ไม่มีรายการรอดำเนินการ ✓</p>
      )}
      {resolved.length > 0 && (
        <section>
          <h2 className="mb-3 font-kanit font-medium text-neutral-500">ประวัติล่าสุด ({resolved.length})</h2>
          <ul className="space-y-3">
            {resolved.map((c) => (
              <ChangeRow key={c.id} change={c} onDone={() => {}} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
