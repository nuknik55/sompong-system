import Link from "next/link";
import type { Role } from "@/lib/auth";

/**
 * The accounting tool row, one component for every accounting page that
 * used to carry its own list of links. Grouped by cadence; the monthly
 * items are in dependency order, left to right.
 *
 * The owner-only import is offered only to the owner. The page and its
 * actions keep requireOwner regardless — this stops an admin being shown a
 * link that silently bounces them to /owner, which is what happened on
 * 2026-09-10.
 */
export function ToolRow({ role, yearMonth, current }: { role: Role; yearMonth: string; current?: string }) {
  const item = (href: string, label: string, key: string) => (
    <Link
      key={key}
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={current === key ? "font-medium text-neutral-900" : "hover:text-neutral-800"}
    >
      {label}
    </Link>
  );
  const sep = <span className="text-neutral-300">·</span>;
  const group = (label: string, links: React.ReactNode[]) => (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs uppercase tracking-wide text-neutral-400">{label}</span>
      {links.flatMap((l, i) => (i === 0 ? [l] : [<span key={`s${i}`}>{sep}</span>, l]))}
    </span>
  );
  const monthly = [
    item("/owner/accounting/coffee-items", "จัดหมวดสินค้า POS", "coffee-items"),
    item(`/owner/accounting/revenue-import`, "นำเข้ารายได้ POS", "revenue-import"),
    ...(role === "owner" ? [item("/owner/accounting/import", "นำเข้ารายจ่ายรายเดือน", "import")] : []),
    item(`/owner/accounting/summary?month=${yearMonth}`, "สรุปรายเดือน", "summary"),
  ];
  const monthlyArrows = monthly.flatMap((l, i) => (i === 0 ? [l] : [<span key={`a${i}`} className="text-neutral-300">→</span>, l]));
  return (
    <nav className="no-print flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
      {group("ทุกวัน", [item("/owner/accounting/daily", "บันทึกรายวัน", "daily"), item("/owner/accounting/transfer-slip", "ใบโอนเงิน", "transfer-slip")])}
      <span className="hidden text-neutral-300 sm:inline">|</span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs uppercase tracking-wide text-neutral-400">ทุกเดือน</span>
        {monthlyArrows}
      </span>
      <span className="hidden text-neutral-300 sm:inline">|</span>
      {group("ตั้งค่า", [item("/owner/accounting/suppliers", "ซัพพลายเออร์", "suppliers"), item("/owner/accounting/coa", "จัดการหมวด", "coa")])}
    </nav>
  );
}
