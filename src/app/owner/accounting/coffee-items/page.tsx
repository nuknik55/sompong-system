export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listStoredItems } from "./actions";
import { CoffeeItemsClient } from "./CoffeeItemsClient";
import { CATEGORIES, CATEGORY_LABEL } from "./categories";

export default async function CoffeeItemsPage() {
  await requireAdmin();
  const stored = await listStoredItems();

  const counts = Object.fromEntries(CATEGORIES.map((k) => [k, 0])) as Record<(typeof CATEGORIES)[number], number>;
  for (const s of stored) if (s.category) counts[s.category] += 1;

  // What the coffee shop is booked from: every coffee-category item, plus
  // any item in another category that carves a per-unit share out to it.
  const coffeeSide = stored.filter((s) => s.category === "coffee" || s.coffeeSharePerUnit != null);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">จัดหมวดสินค้า POS</h1>
        <Link href="/owner/accounting" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← กลับหน้าบัญชี
        </Link>
      </div>

      <div className="space-y-2 text-sm text-neutral-500">
        <p>
          สินค้าแต่ละตัวใน POS ต้องอยู่ในหมวดใดหมวดหนึ่งจากหก: อาหาร ของหวาน เครื่องดื่ม ร้านกาแฟ ของฝาก อื่นๆ
          หมวดนี้กำหนดว่ายอดขายไปอยู่ที่ไหน — ยอดร้านกาแฟไม่นับเป็นรายได้ของร้านอาหาร
          และ POS จัดบางรายการไว้คนละหมวดกับความเป็นจริง เช่น (LM)ชานม อยู่ในหมวดเครื่องดื่มแต่เป็นของร้านกาแฟ
          ส่วนข้าวเหนียวมูนอยู่ในหมวดร้านกาแฟแต่ไม่ใช่
        </p>
        <p>
          ช่องทางขาย (Eat In / อาหารห่อ / Grab / LineMan) เป็นอีกมิติหนึ่ง มาจากไฟล์โดยอัตโนมัติ ไม่ต้องเลือก
          หน้านี้เลือกเฉพาะหมวด และสินค้าที่ยังไม่มีหมวดจะขึ้นเป็น &quot;ใหม่&quot; ทุกเดือนจนกว่าจะมีคนเลือก
        </p>
      </div>

      <p className="text-xs text-neutral-500 tabular-nums">
        บันทึกไว้แล้ว {stored.length} รายการ —{" "}
        {CATEGORIES.map((k) => `${CATEGORY_LABEL[k]} ${counts[k]}`).join(" · ")}
      </p>

      <CoffeeItemsClient initialStoredCount={stored.length} />

      {coffeeSide.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-100 px-4 py-3">
            <h2 className="text-sm font-medium text-neutral-800">
              ที่เข้าร้านกาแฟ ({coffeeSide.length} รายการ)
            </h2>
          </div>
          <ul className="divide-y divide-neutral-100">
            {coffeeSide.map((c) => (
              <li key={c.productName} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="text-neutral-800">{c.productName}</span>
                <span className="shrink-0 text-xs text-neutral-500 tabular-nums">
                  {c.category === "coffee"
                    ? "ทั้งรายการ"
                    : `${c.category ? CATEGORY_LABEL[c.category] : "?"} — แยก ${c.coffeeSharePerUnit} ฿/หน่วย`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
