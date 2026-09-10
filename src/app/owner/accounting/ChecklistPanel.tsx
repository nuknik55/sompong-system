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
    s.state === "done" ? <span className="text-green-700">✓</span> : s.state === "partial" ? <span className="text-amber-600">◐</span> : <span className="text-neutral-400">○</span>;
  return (
    <details open={!checklist.collapsed} className="rounded-lg border border-amber-200 bg-amber-50">
      <summary className="cursor-pointer px-4 py-2.5 text-sm text-amber-900">
        <span className="font-medium">ปิดเดือน {thaiMonth(checklist.yearMonth)}</span>
        <span className="ml-2">เหลือ {checklist.openCount} ขั้นตอน</span>
        <span className="ml-2 text-xs text-amber-700">
          {checklist.steps.filter((s) => s.state !== "done").map((s) => s.title.split(" ")[0]).join(" · ")}
        </span>
      </summary>
      <ol className="space-y-1.5 border-t border-amber-200 px-4 py-3 text-sm">
        {checklist.steps.map((s, i) => (
          <li key={s.key} className="flex flex-wrap items-baseline gap-x-2">
            <span className="w-4 tabular-nums text-neutral-400">{i + 1}.</span>
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
