"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TAB_ROW, tabClass } from "@/components/ui/tabs";

type NavItem = { href: string; label: string; exact?: boolean };

export function InventorySubNav({
  showTemplate,
  canReview,
  canSend,
}: {
  showTemplate: boolean;
  canReview: boolean;
  canSend: boolean;
}) {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  const navItems: NavItem[] = [
    { href: "/staff/inventory", label: "งานของฉัน", exact: true },
    ...(canReview ? [{ href: "/staff/inventory/review", label: "ตรวจสอบ" }] : []),
    ...(canSend ? [{ href: "/staff/inventory/purchase", label: "สั่งซื้อ" }] : []),
    { href: "/staff/inventory/receive-queue", label: "รับของ" },
    { href: "/staff/inventory/history", label: "ประวัติ" },
    ...(showTemplate ? [{ href: "/staff/inventory/template", label: "Template" }] : []),
  ];

  return (
    // The shared tabs (components/ui/tabs.ts), as on the catering sub-nav.
    <div className={`${TAB_ROW} mb-4`}>
      {navItems.map(({ href, label, exact }) => (
        <Link
          key={href}
          href={href}
          className={tabClass(isActive(href, exact))}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
