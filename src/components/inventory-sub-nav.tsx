"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function InventorySubNav({ showTemplate }: { showTemplate: boolean }) {
  const pathname = usePathname();
  const isTemplate = pathname.startsWith("/staff/inventory/template");

  const activeCls = "border-b-2 pb-2 text-sm font-medium";
  const inactiveCls = "pb-2 text-sm font-medium text-neutral-500 hover:text-neutral-800";

  return (
    <div className="flex gap-4 border-b border-neutral-200 mb-4">
      <Link
        href="/staff/inventory"
        className={!isTemplate ? activeCls : inactiveCls}
        style={!isTemplate ? { borderColor: "#2F5A16", color: "#2F5A16" } : undefined}
      >
        รายการสั่งของ
      </Link>
      {showTemplate && (
        <Link
          href="/staff/inventory/template"
          className={isTemplate ? activeCls : inactiveCls}
          style={isTemplate ? { borderColor: "#2F5A16", color: "#2F5A16" } : undefined}
        >
          Template สั่งของ
        </Link>
      )}
    </div>
  );
}
