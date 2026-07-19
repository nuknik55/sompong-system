"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/login/actions";
import type { Profile } from "@/lib/auth";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ShoppingBasket,
  ShoppingCart,
  Users,
  BookOpen,
  Wrench,
  CheckSquare,
  BookText,
  Menu,
  X,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  exact: boolean;
  icon: React.ReactNode;
  badge?: number;
};

const OWNER_NAV: Omit<NavItem, "badge">[] = [
  { href: "/owner", label: "ภาพรวมต้นทุน", exact: true, icon: <LayoutDashboard size={16} /> },
  { href: "/staff", label: "สูตรอาหาร", exact: false, icon: <UtensilsCrossed size={16} /> },
  { href: "/owner/ingredients", label: "จัดการวัตถุดิบ", exact: true, icon: <ShoppingBasket size={16} /> },
  { href: "/staff/inventory", label: "สั่งของ", exact: false, icon: <ShoppingCart size={16} /> },
  { href: "/owner/team", label: "พนักงาน", exact: true, icon: <Users size={16} /> },
  { href: "/sop", label: "SOP ครัว", exact: false, icon: <BookOpen size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
  { href: "/owner/approve", label: "อนุมัติ", exact: true, icon: <CheckSquare size={16} /> },
  { href: "/owner/accounting", label: "บัญชี", exact: false, icon: <BookText size={16} /> },
];

const ADMIN_NAV: Omit<NavItem, "badge">[] = [
  { href: "/owner", label: "ภาพรวมต้นทุน", exact: true, icon: <LayoutDashboard size={16} /> },
  { href: "/staff", label: "สูตรอาหาร", exact: false, icon: <UtensilsCrossed size={16} /> },
  { href: "/owner/ingredients", label: "จัดการวัตถุดิบ", exact: true, icon: <ShoppingBasket size={16} /> },
  { href: "/staff/inventory", label: "สั่งของ", exact: false, icon: <ShoppingCart size={16} /> },
  { href: "/owner/team", label: "พนักงาน", exact: true, icon: <Users size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
  { href: "/owner/approve", label: "อนุมัติ", exact: true, icon: <CheckSquare size={16} /> },
  { href: "/owner/accounting", label: "บัญชี", exact: false, icon: <BookText size={16} /> },
];

const EDITOR_NAV: Omit<NavItem, "badge">[] = [
  { href: "/staff", label: "สูตรอาหาร", exact: false, icon: <UtensilsCrossed size={16} /> },
  { href: "/owner/ingredients", label: "จัดการวัตถุดิบ", exact: true, icon: <ShoppingBasket size={16} /> },
  { href: "/staff/inventory", label: "สั่งของ", exact: false, icon: <ShoppingCart size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
];

const STAFF_NAV: Omit<NavItem, "badge">[] = [
  { href: "/staff", label: "สูตรอาหาร", exact: false, icon: <UtensilsCrossed size={16} /> },
  { href: "/staff/inventory", label: "สั่งของ", exact: false, icon: <ShoppingCart size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
];

const ROLE_LABEL: Record<string, string> = {
  owner: "เจ้าของ",
  admin: "Admin",
  editor: "Editor",
  staff: "Staff",
  accounting: "บัญชี",
};

function isActiveLink(href: string, exact: boolean, pathname: string): boolean {
  if (exact) return pathname === href;
  if (href === "/staff") return pathname.startsWith("/staff") && !pathname.startsWith("/staff/inventory");
  if (href === "/owner") return pathname === "/owner";
  return pathname.startsWith(href);
}

function SidebarContent({
  profile,
  navLinks,
  pathname,
  onNavigate,
}: {
  profile: Profile;
  navLinks: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const initial = (profile.full_name ?? "?").charAt(0).toUpperCase();

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-neutral-100 px-4 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green">
          <span className="font-kanit text-sm font-bold leading-none text-brand-gold">ส</span>
        </div>
        <span className="font-kanit text-sm font-semibold text-neutral-800">สมพงศ์ ซีฟู้ด</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {navLinks.map((link) => {
          const active = isActiveLink(link.href, link.exact, pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className={[
                "relative mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active
                  ? "font-medium text-brand-green bg-brand-green/10"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900",
              ].join(" ")}
            >
              <span className={active ? "text-brand-green" : "text-neutral-400"}>
                {link.icon}
              </span>
              {link.label}
              {link.badge != null && link.badge > 0 && (
                <span className="ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {link.badge > 99 ? "99+" : link.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="border-t border-neutral-100 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-600">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-neutral-800">{profile.full_name}</p>
            <p className="text-[11px] text-neutral-400">{ROLE_LABEL[profile.role] ?? profile.role}</p>
          </div>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="text-xs text-neutral-400 underline hover:text-neutral-700"
          >
            ออกจากระบบ
          </button>
        </form>
      </div>
    </div>
  );
}

export function AppHeader({
  profile,
  pendingCount = 0,
}: {
  profile: Profile;
  pendingCount?: number;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const baseNav =
    profile.role === "owner" ? OWNER_NAV
    : profile.role === "admin" ? ADMIN_NAV
    : profile.role === "editor" ? EDITOR_NAV
    : STAFF_NAV;

  const navLinks: NavItem[] = baseNav.map((item) =>
    item.href === "/owner/approve" && pendingCount > 0
      ? { ...item, badge: pendingCount }
      : item
  );

  return (
    <>
      {/* Mobile top strip */}
      <div className="no-print flex items-center justify-between border-b border-brand-gold bg-white px-4 py-2.5 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-green">
            <span className="font-kanit text-sm font-bold leading-none text-brand-gold">ส</span>
          </div>
          <span className="font-kanit text-sm font-semibold text-neutral-800">สมพงศ์ ซีฟู้ด</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
          aria-label="เปิดเมนู"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <div className="fixed bottom-0 left-0 top-0 z-50 w-60 shadow-xl lg:hidden">
            <div className="absolute right-3 top-3">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="ปิดเมนู"
              >
                <X size={18} />
              </button>
            </div>
            <SidebarContent
              profile={profile}
              navLinks={navLinks}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </>
      )}

      {/* Desktop sidebar */}
      <aside className="no-print hidden w-52 shrink-0 border-r border-neutral-200 lg:flex lg:flex-col">
        <SidebarContent
          profile={profile}
          navLinks={navLinks}
          pathname={pathname}
        />
      </aside>
    </>
  );
}
