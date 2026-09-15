"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCateringEventType, renameCateringEventType, toggleCateringEventTypeActive,
  deleteCateringEventType, reorderCateringEventType,
} from "../actions";
import type { CateringEventType } from "../actions";

/**
 * ประเภทงาน — what the party is FOR, printed on both function sheets where a
 * dotted rule used to be.
 *
 * Rendered from the props with no local copy (queue item 17's lesson): every
 * write goes server action -> router.refresh() -> new prop, so the list can
 * only show what the database holds.
 *
 * Every handler catches, and clears `busy` in a `finally` (queue item 20's
 * lesson, learned on the prep grant screen): the actions RETURN their Thai
 * message, but a stale Server Action id after a deploy still THROWS, and
 * without a catch that is invisible — no message, and a button stuck reading
 * "กำลังบันทึก…" because the reset never runs.
 */
const RETRY_MESSAGE = "บันทึกไม่สำเร็จ — หน้าจออาจค้างจากเวอร์ชันก่อนหน้า กรุณารีเฟรช (F5) แล้วลองใหม่";

export function EventTypesSettingsClient({
  types,
  usage,
}: {
  types: CateringEventType[];
  /** event_type_id -> how many bookings carry it. Drives the delete refusal. */
  usage: Record<string, number>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function run(key: string, fn: () => Promise<{ status: "ok" } | { status: "error"; message: string }>, after?: () => void) {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result.status === "error") { setError(result.message); return; }
        after?.();
        router.refresh();
      } catch {
        setError(RETRY_MESSAGE);
      } finally {
        setBusy(null);
      }
    });
  }

  function saveRename(t: CateringEventType) {
    const draft = drafts[t.id];
    if (draft === undefined) return;
    const next = draft.trim();
    if (next === "" || next === t.label) {
      setDrafts((d) => { const rest = { ...d }; delete rest[t.id]; return rest; });
      return;
    }
    run(`name:${t.id}`, () => renameCateringEventType(t.id, next), () => {
      setDrafts((d) => { const rest = { ...d }; delete rest[t.id]; return rest; });
    });
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-neutral-400 focus:outline-none"
          placeholder="เพิ่มประเภทงานใหม่ เช่น งานแต่ง"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newLabel.trim()) run("add", () => addCateringEventType(newLabel), () => setNewLabel("")); }}
        />
        <button
          type="button"
          disabled={isPending || !newLabel.trim()}
          onClick={() => run("add", () => addCateringEventType(newLabel), () => setNewLabel(""))}
          className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
        >
          {busy === "add" ? "กำลังบันทึก…" : "เพิ่ม"}
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {types.length === 0 && <p className="px-4 py-6 text-center text-sm text-neutral-400">ยังไม่มีประเภทงาน</p>}
        {types.map((t, idx) => {
          const used = usage[t.id] ?? 0;
          return (
            <div
              key={t.id}
              className={`flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 last:border-0 ${!t.is_active ? "opacity-50" : ""}`}
            >
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" disabled={isPending || idx === 0}
                  onClick={() => run(`ord:${t.id}`, () => reorderCateringEventType(t.id, "up"))}
                  className="rounded px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-20" title="เลื่อนขึ้น">▲</button>
                <button type="button" disabled={isPending || idx === types.length - 1}
                  onClick={() => run(`ord:${t.id}`, () => reorderCateringEventType(t.id, "down"))}
                  className="rounded px-1 py-0.5 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-20" title="เลื่อนลง">▼</button>
              </div>

              {/* Rename in place: blur or Enter saves, blank or unchanged
                  reverts. A rename reaches every booking of that kind, which
                  is the point of storing an id rather than a copied label. */}
              <input
                className="min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-sm text-neutral-800 hover:border-neutral-200 focus:border-neutral-400 focus:outline-none"
                value={drafts[t.id] ?? t.label}
                disabled={isPending}
                onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                onBlur={() => saveRename(t)}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />

              <span className="shrink-0 text-xs text-neutral-400">
                {used === 0 ? "ยังไม่มีงานใช้" : `${used} งาน`}
              </span>

              <button type="button" disabled={isPending}
                onClick={() => run(`act:${t.id}`, () => toggleCateringEventTypeActive(t.id, !t.is_active))}
                className={`shrink-0 text-xs ${t.is_active ? "text-neutral-400 hover:text-red-500" : "text-green-600 hover:text-green-800"}`}>
                {busy === `act:${t.id}` ? "…" : t.is_active ? "ปิดใช้" : "เปิดใช้"}
              </button>

              {/* Shown only when nothing uses it. The action refuses anyway,
                  and the FK refuses under that — but a button that cannot
                  work should not be offered in the first place. */}
              {used === 0 && (
                <button type="button" disabled={isPending}
                  onClick={() => { if (confirm(`ลบ "${t.label}" ใช่ไหม?`)) run(`del:${t.id}`, () => deleteCateringEventType(t.id)); }}
                  className="shrink-0 text-xs text-neutral-400 hover:text-red-500">
                  {busy === `del:${t.id}` ? "…" : "ลบ"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-neutral-400">
        ประเภทที่มีงานใช้อยู่จะลบไม่ได้ — ให้กด &quot;ปิดใช้&quot; แทน งานเดิมจะยังพิมพ์ชื่อนี้บนใบงานได้ตามปกติ
        แต่จะไม่ขึ้นให้เลือกในการจองใหม่
      </p>
    </div>
  );
}
