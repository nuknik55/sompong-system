"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";
import type { Profile } from "@/lib/auth";

type NavItem = { href: string; label: string; exact: boolean; badge?: number };

const ADMIN_NAV: NavItem[] = [
  { href: "/owner", label: "ภาพรวมต้นทุน", exact: true },
  { href: "/staff", label: "สูตรอาหาร", exact: false },
  { href: "/owner/ingredients", label: "จัดการวัตถุดิบ", exact: true },
  { href: "/staff/inventory", label: "สั่งของ", exact: false },
  { href: "/owner/team", label: "พนักงาน", exact: true },
  { href: "/sop", label: "SOP ครัว", exact: false },
  { href: "/owner/approve", label: "อนุมัติ", exact: true },
];

const EDITOR_NAV: NavItem[] = [
  { href: "/owner", label: "ภาพรวมต้นทุน", exact: true },
  { href: "/staff", label: "สูตรอาหาร", exact: false },
  { href: "/owner/ingredients", label: "จัดการวัตถุดิบ", exact: true },
  { href: "/staff/inventory", label: "สั่งของ", exact: false },
  { href: "/sop", label: "SOP ครัว", exact: false },
];

const STAFF_NAV: NavItem[] = [
  { href: "/staff", label: "สูตรอาหาร", exact: false },
  { href: "/staff/inventory", label: "สั่งของ", exact: false },
  { href: "/sop", label: "SOP ครัว", exact: false },
];

const ROLE_LABEL: Record<string, string> = {
  owner: "เจ้าของ",
  admin: "Admin",
  editor: "Editor",
  staff: "Staff",
  accounting: "บัญชี",
};

function isActiveLink(href: string, exact: boolean, pathname: string): boolean {
  return exact ? pathname === href : pathname.startsWith(href);
}

export function AppHeader({
  profile,
  pendingCount = 0,
}: {
  profile: Profile;
  pendingCount?: number;
}) {
  const pathname = usePathname();

  const baseNav =
    profile.role === "owner" || profile.role === "admin" ? ADMIN_NAV
    : profile.role === "editor" ? EDITOR_NAV
    : STAFF_NAV;

  const navLinks: NavItem[] = baseNav.map((item) =>
    item.href === "/owner/approve" && pendingCount > 0
      ? { ...item, badge: pendingCount }
      : item
  );

  const initial = (profile.full_name ?? "?").charAt(0).toUpperCase();

  return (
    <header className="no-print flex items-center justify-between border-b-2 border-brand-gold bg-white px-4 py-2.5 sm:px-6">
      <div className="flex items-center gap-3 overflow-x-auto">
        {/* Brand logo mark */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-green">
            <span className="font-kanit text-sm font-bold leading-none text-brand-gold">ส</span>
          </div>
          <span className="hidden font-kanit text-sm font-semibold text-neutral-800 sm:inline">สมพงศ์ ซีฟู้ด</span>
        </div>

        {/* Divider */}
        <div className="hidden h-4 w-px shrink-0 bg-neutral-200 sm:block" />

        {/* Nav tabs */}
        <nav className="flex gap-0.5 text-sm">
          {navLinks.map((link) => {
            const active = isActiveLink(link.href, link.exact, pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={
                  active
                    ? "relative shrink-0 rounded px-2.5 py-1 font-medium"
                    : "relative shrink-0 rounded px-2.5 py-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                }
                style={active ? { backgroundColor: "#EAF3DE", color: "#2F5A16" } : undefined}
              >
                {link.label}
                {link.badge != null && link.badge > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white">
                    {link.badge > 99 ? "99+" : link.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Right: avatar + role + logout */}
      <div className="flex shrink-0 items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600">
            {initial}
          </div>
          <span className="hidden text-xs text-neutral-400 sm:inline">
            {ROLE_LABEL[profile.role] ?? profile.role}
          </span>
        </div>
        <form action={logout}>
          <button type="submit" className="text-xs text-neutral-400 underline hover:text-neutral-700">
            ออกจากระบบ
          </button>
        </form>
      </div>
    </header>
  );
}
