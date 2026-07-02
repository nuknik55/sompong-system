"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MenuCombobox } from "@/components/menu-combobox";
import type { MenuOption } from "@/lib/sop-data";

export function MenuPickerClient({ menus }: { menus: MenuOption[] }) {
  const router = useRouter();
  const [menuId, setMenuId] = useState<string | null>(null);

  function proceed() {
    if (menuId) router.push(`/sop/${menuId}/edit`);
  }

  return (
    <div className="mx-auto max-w-sm space-y-4 pt-8">
      <h1 className="font-kanit text-xl font-semibold text-brand-green">สร้าง SOP ใหม่</h1>
      <p className="text-sm text-neutral-600">เลือกเมนูที่ต้องการสร้าง SOP</p>
      <MenuCombobox value={menuId} options={menus} onChange={setMenuId} />
      <button
        type="button"
        disabled={!menuId}
        onClick={proceed}
        className="w-full rounded-md bg-brand-green py-2 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-40"
      >
        ถัดไป →
      </button>
    </div>
  );
}
