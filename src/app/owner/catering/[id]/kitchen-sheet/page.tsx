export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { getCateringEvent, getCateringEventMenus, getCateringSetMenuItemsForSets } from "../../actions";
import { SET_MENU_SECTIONS } from "../../shared-utils";
import { groupBySection } from "@/lib/function-sheet";
import { priceCell } from "@/lib/kitchen-sheet";
import { KitchenSheetClient, type KitchenRow, type KitchenBlock } from "./KitchenSheetClient";

// ── ใบฟังก์ชั่นงาน — ฝ่ายครัว (document B) ─────────────────────────────────
//
// The kitchen's copy. Different document from the service sheet: same
// booking, different columns, different reader.
//
// THE ราคา COLUMN IS A PORTION SIZE, NOT MONEY THE KITCHEN ACTS ON. The
// reasoning is in src/lib/kitchen-sheet.ts, where the rule is tested; the
// short version is that Sompong sells the same dish at several sizes, so the
// à la carte selling price is how the chef is told which size to plate. The
// second number is DISHES PER TABLE, so "180 x 1" reads "one plate of the
// ฿180 size". It prints literally — never multiplied, no row total, no grand
// total.
//
// No cost anywhere: no getCostingContext(), no computeMenuCost(). This is
// requireSales(), and menus.selling_price is a customer price the sales role
// already reads through getCateringDishOptions.

export default async function CateringKitchenSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSales();
  const { id } = await params;

  const [event, eventMenus] = await Promise.all([
    getCateringEvent(id),
    getCateringEventMenus(id),
  ]);

  if (!event) notFound();

  const setMenuIds = [...new Set(eventMenus.filter((m) => m.set_menu_id).map((m) => m.set_menu_id as string))];
  const itemsBySet = await getCateringSetMenuItemsForSets(setMenuIds);

  // Header only. The ราคา column does NOT use this — see below.
  const tableCount = event.table_count;

  // Package dishes, grouped by section, numbered continuously down the block
  // the way the paper sheet numbers its rows. groupBySection drops any
  // section with no rows, so an absent ขนมหวาน prints nothing at all.
  const packages: KitchenBlock[] = eventMenus
    .filter((m) => m.set_menu_id)
    .map((m) => {
      const source = itemsBySet.get(m.set_menu_id as string) ?? [];
      const groups = groupBySection(source, SET_MENU_SECTIONS);
      const priceById = new Map(source.map((r) => [r.id, r.selling_price]));
      const qtyById = new Map(source.map((r) => [r.id, r.quantity]));
      let n = 0;
      return {
        id: m.id,
        title: m.name,
        sections: groups.map((g) => ({
          label: g.label,
          rows: g.lines.map((l): KitchenRow => ({
            id: l.id,
            index: ++n,
            name: l.name,
            // price × DISHES OF THIS ITEM PER TABLE, from
            // catering_set_menu_items.quantity — not event.table_count, which
            // is what this shipped as in 0f14a7f and was wrong on paper.
            // Nik: "หอยตลับผัดฉ่า (เล็ก) 180 x 1 ทำหอยตลับผัดฉ่าไซส์ 180
            // 1 จาน" — which size, how many plates, for one table.
            price: priceCell(priceById.get(l.id) ?? null, qtyById.get(l.id) ?? 1),
            note: l.note,
          })),
        })),
      };
    });

  // รายการอาหารเพิ่มเติม — dishes added to the booking outside any package.
  // Its own numbering, because it is the sheet's second list, not a
  // continuation of the first.
  const extras: KitchenRow[] = eventMenus
    .filter((m) => !m.set_menu_id)
    .map((m, i) => ({
      id: m.id,
      index: i + 1,
      name: m.name,
      // A dish line on the booking carries no menus join here, and its
      // quantity is a count of servings rather than a portion size. Blank,
      // for the kitchen to fill in, rather than a number that means
      // something different from every other number in the column.
      price: null,
      note: m.note,
    }));

  return (
    <KitchenSheetClient
      event={event}
      tableCount={tableCount}
      packages={packages}
      extras={extras}
    />
  );
}
