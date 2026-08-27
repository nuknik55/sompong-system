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
    // Collapsed by default, same pattern as TaskChecklistSection — this is
    // supplementary reference info, not something needed on every visit.
    <details className="space-y-3 rounded-xl border border-neutral-200 bg-white p-6">
      <summary className="cursor-pointer font-kanit text-base font-semibold text-neutral-900">
        กิจกรรม ({entries.length})
      </summary>
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
    </details>
  );
}
