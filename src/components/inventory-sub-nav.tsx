"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TAB_ROW, tabClass } from "@/components/ui/tabs";
import { NO_COUNTS, type OrderCounts } from "@/lib/order-rules";

type NavItem = { href: string; label: string; exact?: boolean; count?: number };

export function InventorySubNav({
  showTemplate,
  canReview,
  canSend,
  counts = NO_COUNTS,
}: {
  showTemplate: boolean;
  canReview: boolean;
  canSend: boolean;
  /** "Waiting for you", each on the tab that holds its orders; the sidebar badge is their sum. */
  counts?: OrderCounts;
}) {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  const navItems: NavItem[] = [
    { href: "/staff/inventory", label: "งานของฉัน", exact: true, count: counts.mine },
    ...(canReview ? [{ href: "/staff/inventory/review", label: "ตรวจสอบ", count: counts.review }] : []),
    ...(canSend ? [{ href: "/staff/inventory/purchase", label: "สั่งซื้อ", count: counts.purchase }] : []),
    { href: "/staff/inventory/receive-queue", label: "รับของ", count: counts.receive },
    { href: "/staff/inventory/history", label: "ประวัติ" },
    ...(showTemplate ? [{ href: "/staff/inventory/template", label: "Template" }] : []),
  ];

  return (
    // The shared tabs (components/ui/tabs.ts), as on the catering sub-nav.
    <div className={`${TAB_ROW} mb-4`}>
      {navItems.map(({ href, label, exact, count }) => (
        <Link
          key={href}
          href={href}
          className={tabClass(isActive(href, exact))}
        >
          {label}
          {count != null && count > 0 && (
            // White on danger red, as the sidebar's count is red on white.
            <span className="ml-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 align-middle text-[10px] font-bold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
