export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listCoffeeItems } from "./actions";
import { CoffeeItemsClient } from "./CoffeeItemsClient";

export default async function CoffeeItemsPage() {
  await requireAdmin();
  const coffeeItems = await listCoffeeItems();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">รายการของร้านกาแฟ</h1>
        <Link href="/owner/accounting" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← กลับหน้าบัญชี
        </Link>
      </div>

      <p className="text-sm text-neutral-500">
        ยอดขายของร้านกาแฟไม่นับเป็นรายได้ของร้านอาหาร หน้านี้กำหนดว่าสินค้าตัวไหนเป็นของร้านกาแฟ
        เพราะบางรายการ POS จัดไว้คนละหมวดกับความเป็นจริง — เช่น (LM)ชานม อยู่ในหมวดเครื่องดื่ม
        แต่เป็นของร้านกาแฟ ส่วนข้าวเหนียวมูนอยู่ในหมวดร้านกาแฟแต่ไม่ใช่
      </p>

      <CoffeeItemsClient initialCoffeeCount={coffeeItems.length} />

      {coffeeItems.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-4 py-3">
            <h2 className="text-sm font-medium text-neutral-800">
              ที่บันทึกไว้แล้ว ({coffeeItems.length} รายการ)
            </h2>
          </div>
          <ul className="divide-y divide-neutral-100">
            {coffeeItems.map((c) => (
              <li key={c.productName} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="text-neutral-800">{c.productName}</span>
                <span className="shrink-0 text-xs text-neutral-500 tabular-nums">
                  {c.sharePerUnit == null ? "ทั้งรายการ" : `${c.sharePerUnit} ฿/หน่วย`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
