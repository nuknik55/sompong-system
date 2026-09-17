"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CateringActivityLogEntry } from "../actions";
import { updateCateringActivityLine, deleteCateringActivityLine } from "../actions";
import { thFullDate } from "../shared-utils";

/**
 * Combines thFullDate's Thai date with a local HH:MM — the log's "when" is
 * a full timestamp, unlike anywhere else thFullDate is used in this module.
 * Derives the calendar date from the local Date getters (not by slicing the
 * raw ISO string, which is UTC) so a late-night booking doesn't land on the
 * wrong day once converted to Thailand's local time.
 */
function formatLogTimestamp(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateStr = thFullDate(`${y}-${m}-${day}`);
  const timeStr = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  return `${dateStr} ${timeStr}`;
}

/**
 * `canEdit` is for the owner alone (Nik, 2026-09-17): an แก้ไข button that
 * changes a line's text, and a ลบ button behind a confirmation. The database
 * enforces the same rule, so this only decides who sees the buttons.
 */
export function ActivityLogSection({
  eventId,
  entries,
  canEdit,
}: {
  eventId: string;
  entries: CateringActivityLogEntry[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // The row whose save or delete is on its way. While one is, every other
  // แก้ไข and ลบ is disabled, so a second row cannot be opened and then
  // closed under the person by the first one's result.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  function startEdit(entry: CateringActivityLogEntry) {
    setEditingId(entry.id);
    setDraft(entry.description);
    setConfirmDeleteId(null);
    setError(null);
  }

  function askDelete(id: string) {
    setConfirmDeleteId(id);
    setEditingId(null);
    setError(null);
  }

  function save(id: string) {
    setPendingId(id);
    startTransition(async () => {
      try {
        const result = await updateCateringActivityLine(eventId, id, draft);
        if (result.error) { setError({ id, message: result.error }); return; }
        setEditingId(null);
        setError(null);
        router.refresh();
      } catch (err) {
        setError({ id, message: err instanceof Error ? err.message : "แก้ไขไม่สำเร็จ" });
      } finally {
        setPendingId(null);
      }
    });
  }

  function remove(id: string) {
    setPendingId(id);
    startTransition(async () => {
      try {
        const result = await deleteCateringActivityLine(eventId, id);
        setConfirmDeleteId(null);
        if (result.error) { setError({ id, message: result.error }); return; }
        setError(null);
        router.refresh();
      } catch (err) {
        setConfirmDeleteId(null);
        setError({ id, message: err instanceof Error ? err.message : "ลบไม่สำเร็จ" });
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    // One click, one layer. This used to sit inside an เพิ่มเติม collapse —
    // two clicks to answer "who changed this" — until Nik used the page for
    // a real job and read the collapse as "nothing important here". The
    // summary is styled as a button so it sits in the secondary button row;
    // w-full puts the expanded log on its own lines below the row.
    <details className="w-full">
      <summary className="inline-flex cursor-pointer list-none rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
        ประวัติการแก้ไข ({entries.length})
      </summary>
      <div className="mt-2 rounded-xl border border-neutral-200 bg-white px-6 py-3">
        {entries.length === 0 ? (
          <p className="py-3 text-center text-xs text-neutral-400">ยังไม่มีกิจกรรม</p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {entries.map((e) => (
              <div key={e.id} className="py-2.5 text-sm">
                {editingId === e.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={draft}
                      onChange={(ev) => setDraft(ev.target.value)}
                      maxLength={500}
                      aria-label="ข้อความในประวัติ"
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => save(e.id)}
                      disabled={isPending}
                      className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-50"
                    >
                      {pendingId === e.id ? "กำลังบันทึก..." : "บันทึก"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingId(null); setError(null); }}
                      disabled={isPending}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      ยกเลิก
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="text-neutral-800">{e.description}</span>
                    <span className="ml-2 text-xs text-neutral-400">
                      {e.actor_name ?? "ไม่ทราบ"} · {formatLogTimestamp(e.created_at)}
                    </span>
                    {canEdit && confirmDeleteId !== e.id && (
                      <span className="ml-3 inline-flex gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => startEdit(e)}
                          disabled={isPending}
                          className="text-neutral-500 underline hover:text-neutral-800 disabled:opacity-50"
                        >
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={() => askDelete(e.id)}
                          disabled={isPending}
                          className="text-red-600 underline hover:text-red-700 disabled:opacity-50"
                        >
                          ลบ
                        </button>
                      </span>
                    )}
                  </>
                )}
                {confirmDeleteId === e.id && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-red-700">ลบบรรทัดนี้ออกจากประวัติ? ลบแล้วกู้คืนไม่ได้</span>
                    <button
                      type="button"
                      onClick={() => remove(e.id)}
                      disabled={isPending}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {pendingId === e.id ? "กำลังลบ..." : "ยืนยันลบ"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      disabled={isPending}
                      className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      ยกเลิก
                    </button>
                  </div>
                )}
                {error?.id === e.id && <p className="mt-1 text-xs text-red-600">{error.message}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
