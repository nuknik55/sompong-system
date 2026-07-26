"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/owner/hr/employees", label: "พนักงาน", hrOnly: true },
  { href: "/owner/hr/leave", label: "ใบลา", hrOnly: false },
  { href: "/owner/hr/attendance", label: "บันทึกเวลา", hrOnly: false },
  { href: "/owner/hr/schedule", label: "ตารางกะ", hrOnly: false },
  { href: "/owner/hr/dayswap", label: "เปลี่ยนวันหยุด", hrOnly: false },
  { href: "/owner/hr/payroll", label: "เงินเดือน", hrOnly: true },
  { href: "/owner/hr/settings", label: "ตั้งค่า", hrOnly: true, exact: true },
  { href: "/owner/hr/settings/reorder", label: "จัดเรียงคน", hrOnly: true },
];

export function HRNav({ adminOnly }: { adminOnly: boolean }) {
  const pathname = usePathname();

  const visible = LINKS.filter((l) => !adminOnly || !l.hrOnly);

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {visible.map((l, i) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <span key={l.href} className="flex items-center gap-1">
            {i > 0 && <span className="text-neutral-200">|</span>}
            <Link
              href={l.href}
              className={`rounded px-2 py-0.5 text-sm transition-colors ${
                active
                  ? "bg-neutral-900 font-medium text-white"
                  : "text-neutral-500 hover:text-neutral-800"
              }`}
            >
              {l.label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
