"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MenuCombobox } from "@/components/menu-combobox";
import type { MenuOption } from "@/lib/sop-data";
import { buttonClass } from "@/components/ui/button";

export function MenuPickerClient({ menus }: { menus: MenuOption[] }) {
  const router = useRouter();
  const [menuId, setMenuId] = useState<string | null>(null);

  function proceed() {
    if (menuId) router.push(`/sop/${menuId}/edit`);
  }

  return (
    <div className="max-w-sm space-y-4">
      <p className="text-sm text-neutral-600">เลือกเมนูที่ต้องการสร้าง SOP</p>
      <MenuCombobox value={menuId} options={menus} onChange={setMenuId} />
      <button
        type="button"
        disabled={!menuId}
        onClick={proceed}
        className={buttonClass("primary", { className: "w-full" })}
      >
        ถัดไป →
      </button>
    </div>
  );
}
