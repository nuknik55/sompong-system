"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; exact?: boolean };

/**
 * Four items, down from seven, and five since สถานะ came back on
 * 2026-09-17 (three for sales). Staff book on paper because the module had
 * too many places to go; what is left is the daily path plus the two
 * settings screens that feed it.
 *
 * Off the nav, deliberately, and where each went:
 *   สถานะ          back on the nav 2026-09-17: Nik chose to keep the
 *                  status page and link it (queue item 26). Its guard is
 *                  requireSales, the same roles as every page that shows
 *                  this nav, so the link needs no role check of its own.
 *   ลูกค้า          back on the nav 2026-09-22. Off it, the list was reached
 *                  only from a booking's ข้อมูลลูกค้า · ประวัติการจอง and
 *                  then ← กลับ; Nik looked for it and could not find it.
 *                  Its guard is requireSales, the same roles as every page
 *                  that shows this nav, so the link needs no role check.
 *                  src/lib/route-links.test.ts now fails any page no link
 *                  outside its own folder reaches.
 *   ต้นทุนภายใน     admin-only, reached from a booking's ต้นทุน-กำไร page
 *                  by the ตั้งค่าต้นทุนภายใน link beside + เพิ่มต้นทุน. It is
 *                  internal COST, easily confused with the prices under
 *                  ตั้งค่า, which are what the customer pays.
 *
 *                  THAT LINK DID NOT EXIST until 2026-09-16. This comment
 *                  claimed it from 2026-09-11 (665f458) and nobody checked,
 *                  so the page was reachable only by typing its URL; Nik
 *                  looked for it on the cost page and could not find it.
 *                  Before moving anything else off this nav, find the href
 *                  that replaces it: grep for the route, not for the label.
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
    { href: "/owner/catering/status", label: "สถานะ" },
    { href: "/owner/catering/customers", label: "ลูกค้า" },
    ...(isAdmin ? [{ href: "/owner/catering/set-menus", label: "ชุดเมนู" }] : []),
    // "ราคา" until 2026-09-15, when ประเภทงาน joined the rates on that page.
    // Keeping the sub-nav short was the point of the reduction from seven, so
    // a second settings screen would have undone it.
    ...(isAdmin ? [{ href: "/owner/catering/settings", label: "ตั้งค่า" }] : []),
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
