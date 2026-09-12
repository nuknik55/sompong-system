"use client";

import type { CateringActivityLogEntry } from "../actions";
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

export function ActivityLogSection({ entries }: { entries: CateringActivityLogEntry[] }) {
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
                <span className="text-neutral-800">{e.description}</span>
                <span className="ml-2 text-xs text-neutral-400">
                  {e.actor_name ?? "ไม่ทราบ"} · {formatLogTimestamp(e.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
