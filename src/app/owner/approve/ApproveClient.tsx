"use client";

import { useState, useTransition } from "react";
import { approveChange, rejectChange } from "@/app/owner/approve/actions";
import type { PendingChange } from "@/lib/pending-data";

// ─── Type labels ───────────────────────────────────────────────────────────────

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

// ─── Payload detail panel ──────────────────────────────────────────────────────

const INGREDIENT_FIELD_LABELS: Record<string, string> = {
  name: "ชื่อ",
  category: "หมวด",
  purchase_cost: "ราคาซื้อ (บาท)",
  receive_qty: "จำนวนรับ",
  yield_qty: "Yield",
  usage_unit: "หน่วยใช้",
  purchase_unit_label: "หน่วยซื้อ",
  par_level: "Par Level",
  safety_note: "หมายเหตุความปลอดภัย",
  name_mm: "ชื่อ (ภาษาอื่น)",
};

function SectionSteps({ label, steps }: { label: string; steps: { text: string; photoUrl?: string | null }[] }) {
  if (!steps.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-neutral-600 mb-1">{label}</p>
      <ol className="list-decimal list-inside space-y-1">
        {steps.map((s, i) => (
          <li key={i} className="text-xs text-neutral-700 leading-relaxed">
            {s.text}
            {s.photoUrl && (
              <span className="ml-1.5 inline-flex items-center rounded bg-blue-100 px-1 py-0.5 text-[10px] text-blue-600">
                📷 รูป
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PayloadDetail({ type, payload }: { type: string; payload: Record<string, unknown> }) {
  switch (type) {

    case "sop_upsert": {
      const sop = payload.sopData as {
        authorName?: string;
        demoVideoUrl?: string;
        ingredientNotes?: Record<string, string>;
        prepSteps?: { text: string; photoUrl: string | null }[];
        cookSteps?: { text: string; photoUrl: string | null }[];
        platingSteps?: { text: string; photoUrl: string | null }[];
        checklist?: { text: string; photoUrl: string | null }[];
      } | null;
      if (!sop) return <p className="text-xs text-neutral-400">ไม่มีข้อมูล SOP</p>;

      const noteEntries = Object.entries(sop.ingredientNotes ?? {}).filter(([, n]) => n?.trim());
      const totalSteps =
        (sop.prepSteps?.length ?? 0) +
        (sop.cookSteps?.length ?? 0) +
        (sop.platingSteps?.length ?? 0) +
        (sop.checklist?.length ?? 0);

      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
            {sop.authorName && <span>ผู้เขียน: <strong className="text-neutral-700">{sop.authorName}</strong></span>}
            <span>{totalSteps} ขั้นตอน</span>
            {sop.demoVideoUrl && (
              <a href={sop.demoVideoUrl} target="_blank" rel="noreferrer"
                className="text-blue-500 underline">🎬 ดู Video</a>
            )}
          </div>

          {noteEntries.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-neutral-600 mb-1">หมายเหตุวัตถุดิบ</p>
              {noteEntries.map(([id, note]) => (
                <p key={id} className="text-xs text-neutral-600">• {note}</p>
              ))}
            </div>
          )}

          <SectionSteps label="เตรียม" steps={sop.prepSteps ?? []} />
          <SectionSteps label="ทำ" steps={sop.cookSteps ?? []} />
          <SectionSteps label="จัดจาน" steps={sop.platingSteps ?? []} />
          <SectionSteps label="Checklist" steps={(sop.checklist ?? []).map(s => ({ ...s, photoUrl: null }))} />

          {totalSteps === 0 && noteEntries.length === 0 && (
            <p className="text-xs text-neutral-400">ไม่มีขั้นตอนหรือหมายเหตุ</p>
          )}
        </div>
      );
    }

    case "recipe_edit": {
      type RecipeItem = { id: string; ingredient_id: string | null; ingredientName?: string; quantity: number; unit: string | null };
      const items = (payload.items ?? []) as RecipeItem[];
      const deletedIds = (payload.deletedIds ?? []) as string[];
      return (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">
            {payload.target === "menu" ? "เมนู" : "ของเตรียม"}:{" "}
            <strong className="text-neutral-700">{String(payload.parentName ?? payload.parentId)}</strong>
          </p>
          {items.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-400 border-b border-neutral-100">
                  <th className="text-left pb-1 font-normal">วัตถุดิบ</th>
                  <th className="text-right pb-1 font-normal pr-2">ปริมาณ</th>
                  <th className="text-left pb-1 font-normal">หน่วย</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-b border-neutral-50">
                    <td className="py-0.5 text-neutral-700">{item.ingredientName ?? item.ingredient_id ?? "—"}</td>
                    <td className="py-0.5 text-right pr-2 text-neutral-700 tabular-nums">{item.quantity}</td>
                    <td className="py-0.5 text-neutral-500">{item.unit ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {deletedIds.length > 0 && (
            <p className="text-xs text-red-500">— ลบออก {deletedIds.length} รายการ</p>
          )}
          {items.length === 0 && deletedIds.length === 0 && (
            <p className="text-xs text-neutral-400">ไม่มีการเปลี่ยนแปลง</p>
          )}
        </div>
      );
    }

    case "ingredient_edit": {
      const fields = (payload.fields ?? {}) as Record<string, unknown>;
      return (
        <div>
          <p className="text-xs font-medium text-neutral-700 mb-1.5">{String(payload.ingredientName)}</p>
          <table className="text-xs">
            <tbody>
              {Object.entries(fields).map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-4 text-neutral-500 py-0.5">{INGREDIENT_FIELD_LABELS[k] ?? k}</td>
                  <td className="text-neutral-800 font-medium py-0.5">{v == null ? "—" : String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "ingredient_create": {
      const fields = (payload.fields ?? {}) as Record<string, unknown>;
      return (
        <div>
          <p className="text-xs font-medium text-neutral-700 mb-1.5">วัตถุดิบใหม่: {String(payload.ingredientName ?? fields.name ?? "")}</p>
          <table className="text-xs">
            <tbody>
              {Object.entries(fields).filter(([, v]) => v != null && v !== "").map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-4 text-neutral-500 py-0.5">{INGREDIENT_FIELD_LABELS[k] ?? k}</td>
                  <td className="text-neutral-800 py-0.5">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "prep_yield_edit": {
      return (
        <div className="text-xs space-y-1">
          <p className="text-neutral-500">ของเตรียม: <strong className="text-neutral-700">{String(payload.parentName ?? payload.parentId)}</strong></p>
          <p className="text-neutral-500">ผลผลิตใหม่:{" "}
            <strong className="text-neutral-800 text-sm">{String(payload.qty)} {String(payload.unit)}</strong>
          </p>
        </div>
      );
    }

    case "menu_create": {
      return (
        <div className="text-xs space-y-1">
          <p><span className="text-neutral-500">ชื่อ:</span> <strong className="text-neutral-800">{String(payload.name)}</strong></p>
          <p><span className="text-neutral-500">หมวด:</span> {String(payload.category || "—")}</p>
          <p><span className="text-neutral-500">ราคาขาย:</span> {String(payload.sellingPrice)} บาท</p>
        </div>
      );
    }

    case "prep_create": {
      return (
        <div className="text-xs space-y-1">
          <p><span className="text-neutral-500">ชื่อ:</span> <strong className="text-neutral-800">{String(payload.name)}</strong></p>
          <p><span className="text-neutral-500">หมวด:</span> {String(payload.category || "—")}</p>
          <p><span className="text-neutral-500">ผลผลิต:</span> {String(payload.batchYieldQty)} {String(payload.batchYieldUnit)}</p>
        </div>
      );
    }

    case "menu_delete":
    case "prep_delete":
    case "ingredient_delete":
    case "sop_delete": {
      const name = String(payload.menuName ?? payload.prepName ?? payload.ingredientName ?? "");
      return (
        <div className="rounded bg-red-50 border border-red-100 p-2 text-xs text-red-700">
          ⚠ ต้องการลบ <strong>{name}</strong> — ข้อมูลจะหายถาวร
        </div>
      );
    }

    default:
      return (
        <pre className="overflow-auto max-h-40 rounded bg-neutral-100 p-2 text-xs text-neutral-600">
          {JSON.stringify(payload, null, 2)}
        </pre>
      );
  }
}

// ─── Single change row ─────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

function ChangeRow({ change, onDone }: { change: PendingChange; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
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
    pending: "รอดำเนินการ",
    approved: "อนุมัติแล้ว",
    rejected: "ปฏิเสธแล้ว",
  };

  return (
    <li className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
      {/* Header row */}
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

      {/* Meta */}
      <div className="text-xs text-neutral-400">
        โดย <span className="font-medium text-neutral-600">{change.editorName}</span>
        {" · "}{formatDate(change.createdAt)}
        {change.resolvedAt && ` · ดำเนินการแล้ว ${formatDate(change.resolvedAt)}`}
      </div>

      {change.status === "rejected" && change.adminNote && (
        <p className="text-xs text-red-600">เหตุผลปฏิเสธ: {change.adminNote}</p>
      )}

      {/* Detail toggle */}
      <button
        type="button"
        onClick={() => setShowDetail((v) => !v)}
        className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
      >
        <span>{showDetail ? "▲" : "▼"}</span>
        <span>{showDetail ? "ซ่อนรายละเอียด" : "ดูรายละเอียด"}</span>
      </button>

      {/* Detail panel */}
      {showDetail && (
        <div className="rounded-md border border-neutral-100 bg-neutral-50 p-3">
          <PayloadDetail type={change.changeType} payload={change.payload} />
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Action buttons */}
      {change.status === "pending" && !showReject && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            disabled={isPending}
            onClick={handleApprove}
            className="rounded-md bg-brand-green px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
            style={{ backgroundColor: "#2F5A16" }}
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

// ─── Main list ─────────────────────────────────────────────────────────────────

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
                onDone={() =>
                  setList((prev) =>
                    prev.map((x) => x.id === c.id ? { ...x, status: "approved" as const } : x)
                  )
                }
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
