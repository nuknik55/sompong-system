export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PosDivisorsClient, type DivisorRow, type MenuOption } from "./PosDivisorsClient";

// ── ตัวหารยอดขาย POS: every divisor in one place (Nik, 2026-09-21) ──────────
// pos_sales_aliases is how the POS sales import turns a POS count into the
// app's units: ÷10 for a dish the POS counts in ขีด and the app per kilo, ÷2
// for a half-kilo button, ÷4 for river prawn (one 4-ขีด plate), ÷1 for another
// spelling of the same dish. They were created from the import one at a time
// and never shown again, so nobody could see what the import was dividing by.
// Owner and admin only: requireAdmin(), as the import itself, and the table's
// write policy (is_owner(), which admits both). New divisors are still made
// from the import (หาร, ผูกเข้าเมนู); this page lists, edits and deletes.

export default async function PosDivisorsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: aliases, error: aliasError }, { data: menus, error: menuError }] = await Promise.all([
    supabase.from("pos_sales_aliases").select("id, pos_product_name, menu_id, divisor").order("pos_product_name").order("id"),
    supabase.from("menus").select("id, name, category").order("name").order("id"),
  ]);
  if (aliasError) throw aliasError;
  if (menuError) throw menuError;

  const rows: DivisorRow[] = (aliases ?? []).map((a) => ({
    id: a.id,
    posProductName: a.pos_product_name,
    menuId: a.menu_id,
    divisor: Number(a.divisor),
  }));
  const options: MenuOption[] = (menus ?? []).map((m) => ({ id: m.id, name: m.name, category: m.category }));

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-2">
        <Link href="/owner" className="text-xs text-neutral-500 underline hover:text-neutral-800">
          ← ภาพรวมต้นทุนและ Menu Engineering
        </Link>
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">ตัวหารยอดขาย POS</h1>
        <div className="space-y-1 text-sm text-neutral-500">
          <p>การนำเข้ายอดขายจาก POS หารจำนวนขายของแต่ละชื่อในรายการนี้ด้วยตัวหาร ก่อนรวมเข้าเมนูในแอป</p>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>อาหารขายตามน้ำหนัก: 1 หน่วยในแอป = 1 กก. — ชื่อที่ POS นับเป็นขีด ÷10, ปุ่มครึ่งกิโล ÷2, ปุ่ม 1 กก. ÷1</li>
            <li>กุ้งแม่น้ำ: 1 หน่วย = 1 จาน (1 ตัว 4 ขีด) — ÷4</li>
            <li>ชื่อที่สะกดต่างกันของเมนูเดียวกัน ÷1</li>
          </ul>
          <p>
            การแก้หรือลบมีผลกับยอดขายตั้งแต่การนำเข้าครั้งต่อไป ยอดขายที่นำเข้าไปแล้วไม่เปลี่ยน — ตัวหารใหม่สร้างจากหน้านำเข้ายอดขาย
            (ปุ่ม หาร หรือ ผูกเข้าเมนู)
          </p>
          <p className="font-medium text-neutral-700">
            ตัวหาร ÷10 ยังเป็นเครื่องหมายว่าเมนูนั้นขายตามน้ำหนัก: ใบฟังก์ชั่นงานจัดเลี้ยง (ครัวและบริการ) พิมพ์จำนวนของเมนูนั้นเป็น กก.
            — การเพิ่มหรือเอา ÷10 ออกเปลี่ยนใบเหล่านั้นทันที ทุกงาน
          </p>
        </div>
      </div>
      <PosDivisorsClient rows={rows} menus={options} />
    </div>
  );
}
