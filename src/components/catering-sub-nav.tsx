"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; exact?: boolean };

/**
 * Four items, down from seven. Staff book on paper because the module had
 * too many places to go; what is left is the daily path plus the two
 * settings screens that feed it.
 *
 * Off the nav, deliberately, and where each went:
 *   สถานะ          the booking list filters by status already
 *   ลูกค้า          behind เพิ่มเติม on the booking, still reachable
 *   ต้นทุนภายใน     admin-only, linked from a booking's cost page — it is
 *                  internal COST, easily confused with ราคา below, which is
 *                  what the customer pays
 *   เช็กลิสต์        deleted; see the booking page's header comment
 */
export function CateringSubNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  const activeCls = "border-b-2 border-neutral-900 pb-2 text-sm font-medium text-neutral-900 whitespace-nowrap";
  const inactiveCls = "pb-2 text-sm font-medium text-neutral-500 hover:text-neutral-800 whitespace-nowrap";

  const navItems: NavItem[] = [
    { href: "/owner/catering", label: "การจอง", exact: true },
    { href: "/owner/catering/calendar", label: "ปฏิทิน" },
    ...(isAdmin ? [{ href: "/owner/catering/set-menus", label: "ชุดเมนู" }] : []),
    ...(isAdmin ? [{ href: "/owner/catering/settings", label: "ราคา" }] : []),
  ];

  return (
    <div className="flex gap-4 border-b border-neutral-200 mb-4 overflow-x-auto">
      {navItems.map(({ href, label, exact }) => (
        <Link key={href} href={href} className={isActive(href, exact) ? activeCls : inactiveCls}>
          {label}
        </Link>
      ))}
    </div>
  );
}
