"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/login/actions";
import { confirmDiscardUnsaved, SIGN_OUT_UNSAVED_MSG } from "@/lib/unsaved-changes";
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
  UserCog,
  CalendarDays,
  Clock,
  PartyPopper,
  Menu,
  X,
  Lock,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  exact: boolean;
  icon: React.ReactNode;
  badge?: number;
  /** Where the link goes when it is not `href` (สั่งของ opens the tab with pending work); `href` still decides "active". */
  target?: string;
};

// OWNER_NAV carries one entry the admin navs deliberately do not:
// /owner/prep-access. Granting sight of a prep recipe is owner-only, so an
// admin must not even be shown the door — and the page's own requireOwner()
// plus the RLS policy refuse it regardless of what the nav says.
const OWNER_NAV: Omit<NavItem, "badge">[] = [
  { href: "/owner", label: "ภาพรวมต้นทุน", exact: true, icon: <LayoutDashboard size={16} /> },
  { href: "/staff", label: "สูตรอาหาร", exact: false, icon: <UtensilsCrossed size={16} /> },
  { href: "/owner/prep-access", label: "สิทธิ์ดูสูตรของเตรียม", exact: true, icon: <Lock size={16} /> },
  { href: "/owner/ingredients", label: "จัดการวัตถุดิบ", exact: true, icon: <ShoppingBasket size={16} /> },
  { href: "/staff/inventory", label: "สั่งของ", exact: false, icon: <ShoppingCart size={16} /> },
  { href: "/owner/team", label: "ผู้ใช้งาน/สิทธิ์", exact: true, icon: <Users size={16} /> },
  { href: "/sop", label: "SOP ครัว", exact: false, icon: <BookOpen size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
  { href: "/owner/approve", label: "อนุมัติ", exact: true, icon: <CheckSquare size={16} /> },
  { href: "/owner/accounting", label: "บัญชี", exact: false, icon: <BookText size={16} /> },
  { href: "/owner/catering", label: "จองงานจัดเลี้ยง", exact: false, icon: <PartyPopper size={16} /> },
  { href: "/owner/hr", label: "ฝ่ายบุคคล", exact: false, icon: <UserCog size={16} /> },
];

const ADMIN_NAV: Omit<NavItem, "badge">[] = [
  { href: "/owner", label: "ภาพรวมต้นทุน", exact: true, icon: <LayoutDashboard size={16} /> },
  { href: "/staff", label: "สูตรอาหาร", exact: false, icon: <UtensilsCrossed size={16} /> },
  { href: "/owner/ingredients", label: "จัดการวัตถุดิบ", exact: true, icon: <ShoppingBasket size={16} /> },
  { href: "/staff/inventory", label: "สั่งของ", exact: false, icon: <ShoppingCart size={16} /> },
  { href: "/owner/team", label: "ผู้ใช้งาน/สิทธิ์", exact: true, icon: <Users size={16} /> },
  { href: "/sop", label: "SOP ครัว", exact: false, icon: <BookOpen size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
  { href: "/owner/approve", label: "อนุมัติ", exact: true, icon: <CheckSquare size={16} /> },
  { href: "/owner/accounting", label: "บัญชี", exact: false, icon: <BookText size={16} /> },
  { href: "/owner/catering", label: "จองงานจัดเลี้ยง", exact: false, icon: <PartyPopper size={16} /> },
  { href: "/owner/hr/leave", label: "ใบลา", exact: true, icon: <CalendarDays size={16} /> },
  { href: "/owner/hr/attendance", label: "บันทึกเวลา", exact: true, icon: <Clock size={16} /> },
];

const HR_NAV: Omit<NavItem, "badge">[] = [
  { href: "/owner/hr", label: "ฝ่ายบุคคล", exact: false, icon: <UserCog size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
];

// sales only owns the catering module; maintenance is available to every role.
const SALES_NAV: Omit<NavItem, "badge">[] = [
  { href: "/owner/catering", label: "จองงานจัดเลี้ยง", exact: false, icon: <PartyPopper size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
];

const EDITOR_NAV: Omit<NavItem, "badge">[] = [
  { href: "/staff", label: "สูตรอาหาร", exact: false, icon: <UtensilsCrossed size={16} /> },
  { href: "/owner/ingredients", label: "จัดการวัตถุดิบ", exact: true, icon: <ShoppingBasket size={16} /> },
  { href: "/staff/inventory", label: "สั่งของ", exact: false, icon: <ShoppingCart size={16} /> },
  { href: "/sop", label: "SOP ครัว", exact: false, icon: <BookOpen size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
];

const STAFF_NAV: Omit<NavItem, "badge">[] = [
  { href: "/staff", label: "สูตรอาหาร", exact: false, icon: <UtensilsCrossed size={16} /> },
  { href: "/staff/inventory", label: "สั่งของ", exact: false, icon: <ShoppingCart size={16} /> },
  { href: "/sop", label: "SOP ครัว", exact: false, icon: <BookOpen size={16} /> },
  { href: "/maintenance", label: "แจ้งซ่อม", exact: false, icon: <Wrench size={16} /> },
];

const ROLE_LABEL: Record<string, string> = {
  owner: "เจ้าของ",
  admin: "Admin",
  editor: "Editor",
  staff: "Staff",
  hr: "ฝ่ายบุคคล",
  sales: "ฝ่ายขาย",
};

/**
 * The menu under four small headings (Nik, from the preview samples,
 * 2026-09-23). Grouping is by LABEL over the role's own nav list, which is built exactly
 * as before, so no item becomes visible or invisible to anyone: a role that
 * never had จองงานจัดเลี้ยง still does not, and a heading whose items are
 * all missing for that role is not rendered. Anything not named here (an
 * item added later) is shown, ungrouped, at the end.
 */
const NAV_GROUPS: { heading: string; labels: string[] }[] = [
  { heading: "ครัว", labels: ["ภาพรวมต้นทุน", "สูตรอาหาร", "จัดการวัตถุดิบ", "SOP ครัว", "สั่งของ"] },
  { heading: "งานขาย", labels: ["จองงานจัดเลี้ยง"] },
  { heading: "บริหาร", labels: ["บัญชี", "อนุมัติ", "แจ้งซ่อม", "ฝ่ายบุคคล", "ใบลา", "บันทึกเวลา"] },
  { heading: "ตั้งค่า", labels: ["ผู้ใช้งาน/สิทธิ์", "สิทธิ์ดูสูตรของเตรียม"] },
];

/** The role's nav list, in groups; empty groups and empty headings dropped. */
function groupNav(navLinks: NavItem[]): { heading: string | null; items: NavItem[] }[] {
  const taken = new Set<string>();
  const groups = NAV_GROUPS.map(({ heading, labels }) => {
    const items = labels.flatMap((label) => navLinks.filter((l) => l.label === label));
    items.forEach((i) => taken.add(i.href));
    return { heading, items };
  }).filter((g) => g.items.length > 0);
  const rest = navLinks.filter((l) => !taken.has(l.href));
  return rest.length ? [...groups, { heading: null, items: rest }] : groups;
}

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
    // The sidebar in the brand green (Nik chose it, 2026-09-23). White text on #2F5A16 is 8.1:1; the active item is a GOLD PILL with
    // near-black text (8.8:1) because gold TEXT on green is only 4.0:1 and
    // fails AA at this size. Headings are white at 75% (5.4:1), inactive
    // items white at 80% (5.9:1), and the แจ้งซ่อม count is a white pill
    // with red text (6.6:1).
    <div className="flex h-full flex-col bg-brand-green">
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-white/15 px-4 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gold">
          <span className="font-kanit text-sm font-bold leading-none text-neutral-900">ส</span>
        </div>
        <span className="font-kanit text-sm font-semibold text-white">สมพงศ์ ซีฟู้ด</span>
      </div>

      {/* Nav items, in groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groupNav(navLinks).map((group, gi) => (
          <div key={group.heading ?? `rest-${gi}`} className={gi > 0 ? "mt-4" : undefined}>
            {group.heading && (
              <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-white/75">{group.heading}</p>
            )}
            {group.items.map((link) => {
              const active = isActiveLink(link.href, link.exact, pathname);
              return (
                <Link
                  key={link.href}
                  href={link.target ?? link.href}
                  onClick={onNavigate}
                  className={[
                    "relative mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "font-medium text-neutral-900 bg-brand-gold"
                      : "text-white/80 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  <span className={active ? "text-neutral-900" : "text-white/70"}>
                    {link.icon}
                  </span>
                  {link.label}
                  {link.badge != null && link.badge > 0 && (
                    <span className="ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full bg-white px-1 text-[10px] font-bold text-danger">
                      {link.badge > 99 ? "99+" : link.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User + logout */}
      <div className="border-t border-white/15 px-4 py-3">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-semibold text-white">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-white">{profile.full_name}</p>
            <p className="text-[11px] text-white/75">{ROLE_LABEL[profile.role] ?? profile.role}</p>
          </div>
        </div>
        {/* ออกจากระบบ IS THE ONE EXIT NO PAGE GUARD CAN SEE. It is a form
            submit that ends in a server-side redirect: no anchor is clicked,
            so the capture-phase link guards never fire, and the document is
            never unloaded, so beforeunload never fires either. The page says
            whether it has unsaved work (src/lib/unsaved-changes.ts) and this
            asks before throwing it away.

            Preventing the submit's default is what cancels it: React passes
            the action to startHostTransition only when the event was NOT
            default-prevented, so a cancel runs nothing at all and leaves the
            person exactly where they were. A confirm — or a page with
            nothing unsaved — goes through untouched. */}
        <form
          action={logout}
          onSubmit={(e) => { if (!confirmDiscardUnsaved(SIGN_OUT_UNSAVED_MSG)) e.preventDefault(); }}
        >
          <button
            type="submit"
            className="text-xs text-white/80 underline hover:text-white"
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
  openRepairCount = 0,
  orderCount = 0,
  orderHref,
}: {
  profile: Profile;
  pendingCount?: number;
  /** Open maintenance reports. The layouts pass 0 for roles that cannot act, so reporters never see a count — the badge is for the people who act. */
  openRepairCount?: number;
  /** Supply orders waiting for this person: the sum of the counts on the สั่งของ tabs (order-rules.ts, OrderCounts). */
  orderCount?: number;
  /** Where สั่งของ opens: the tab with pending work, earliest step first (pendingHref). */
  orderHref?: string;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const baseNav =
    profile.role === "owner" ? OWNER_NAV
    : profile.role === "hr" ? HR_NAV
    : profile.role === "sales" ? SALES_NAV
    : profile.role === "admin" ? ADMIN_NAV
    : profile.role === "editor" ? EDITOR_NAV
    : STAFF_NAV;

  const navLinks: NavItem[] = baseNav.map((item) =>
    item.href === "/owner/approve" && pendingCount > 0
      ? { ...item, badge: pendingCount }
      : item.href === "/maintenance" && openRepairCount > 0
      ? { ...item, badge: openRepairCount }
      : item.href === "/staff/inventory"
      ? { ...item, badge: orderCount > 0 ? orderCount : undefined, target: orderHref }
      : item
  );

  return (
    <>
      {/* Mobile top strip */}
      <div className="no-print flex items-center justify-between border-b border-brand-gold bg-brand-green px-4 py-2.5 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-gold">
            <span className="font-kanit text-sm font-bold leading-none text-neutral-900">ส</span>
          </div>
          <span className="font-kanit text-sm font-semibold text-white">สมพงศ์ ซีฟู้ด</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-white hover:bg-white/10"
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
                className="rounded-md p-1 text-white/80 hover:bg-white/10 hover:text-white"
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
      <aside className="no-print hidden w-52 shrink-0 border-r border-brand-green lg:flex lg:flex-col">
        <SidebarContent
          profile={profile}
          navLinks={navLinks}
          pathname={pathname}
        />
      </aside>
    </>
  );
}
