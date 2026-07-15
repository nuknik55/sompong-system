"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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

  const activeCls = "border-b-2 pb-2 text-sm font-medium whitespace-nowrap";
  const inactiveCls = "pb-2 text-sm font-medium text-neutral-500 hover:text-neutral-800 whitespace-nowrap";

  const navItems: NavItem[] = [
    { href: "/staff/inventory", label: "งานของฉัน", exact: true },
    ...(canReview ? [{ href: "/staff/inventory/review", label: "ตรวจสอบ" }] : []),
    ...(canSend ? [{ href: "/staff/inventory/purchase", label: "สั่งซื้อ" }] : []),
    { href: "/staff/inventory/receive-queue", label: "รับของ" },
    { href: "/staff/inventory/history", label: "ประวัติ" },
    ...(showTemplate ? [{ href: "/staff/inventory/template", label: "Template" }] : []),
  ];

  return (
    <div className="flex gap-4 border-b border-neutral-200 mb-4 overflow-x-auto">
      {navItems.map(({ href, label, exact }) => (
        <Link
          key={href}
          href={href}
          className={isActive(href, exact) ? activeCls : inactiveCls}
          style={isActive(href, exact) ? { borderColor: "#2F5A16", color: "#2F5A16" } : undefined}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
