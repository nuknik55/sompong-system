import Link from "next/link";
import type { Role } from "@/lib/auth";
import { thaiMonth, type Checklist } from "./checklist";

/**
 * Start-of-month checklist for the month that just closed. Rendered on the
 * month view from the 1st until every step is satisfied; then nothing.
 * Fewer than three open steps collapse to one line — six rows of chrome
 * above the ledger every day of the month is too much for one open item.
 */
export function ChecklistPanel({ checklist, role }: { checklist: Checklist; role: Role }) {
  if (checklist.allDone) return null;
  const mark = (s: Checklist["steps"][number]) =>
    s.state === "done" ? <span className="text-success-ink">✓</span> : s.state === "partial" ? <span className="text-pending-ink">◐</span> : <span className="text-neutral-500">○</span>;
  return (
    <details open={!checklist.collapsed} className="rounded-lg border border-pending/60 bg-pending-soft">
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-pending-ink">
        <span className="font-medium">ปิดเดือน {thaiMonth(checklist.yearMonth)}</span>
        <span className="ml-2">เหลือ {checklist.openCount} ขั้นตอน</span>
        <span className="ml-2 text-xs text-pending-ink">
          {checklist.steps.filter((s) => s.state !== "done").map((s) => s.title.split(" ")[0]).join(" · ")}
        </span>
      </summary>
      <ol className="space-y-1.5 border-t border-pending/60 px-4 py-3 text-sm">
        {checklist.steps.map((s, i) => (
          <li key={s.key} className="flex flex-wrap items-baseline gap-x-2">
            <span className="w-4 tabular-nums text-neutral-500">{i + 1}.</span>
            <span className="w-4">{mark(s)}</span>
            {s.ownerOnly && role !== "owner" ? (
              <span className={s.state === "done" ? "text-neutral-500" : "text-neutral-800"}>{s.title}</span>
            ) : (
              <Link href={s.href} className={`underline-offset-2 hover:underline ${s.state === "done" ? "text-neutral-500" : "text-neutral-900"}`}>
                {s.title}
              </Link>
            )}
            <span className="text-xs text-neutral-500">{s.detail}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
