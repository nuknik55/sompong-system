export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { getCateringEvent, getCateringEventMenus, getCateringSetMenuItemsForSets } from "../../actions";
import { SET_MENU_SECTIONS } from "../../shared-utils";
import { groupBySection } from "@/lib/function-sheet";
import { priceCell, plateCount } from "@/lib/kitchen-sheet";
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
// second number is PLATES FOR THE WHOLE JOB — per-set count × sets ordered,
// plateCount() — so "200 x 50" reads "fifty plates of the ฿200 size". It
// prints literally — never multiplied, no row total, no grand total.
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

  // A BUFFET PRINTS NO PER-DISH PRICES. Nik's paper buffet sheet has none —
  // a buffet is cooked to the guest count in the header, not per-plate
  // portions — so the stored food_format blanks the ราคา column. That is the
  // only buffet rule built so far, because it is the only one the paper
  // attests: how a buffet BOOKING is even shaped (a per-head set? dish
  // lines?) has no real data yet, and the multiplier's three readings are
  // the argument for not guessing — see README, the catering documents
  // section. The จำนวน semantics wait for the first real buffet booking.
  const isBuffet = event.food_format === "buffet";

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
            // price × plates for the WHOLE JOB: per-set count × sets
            // ordered. This rule took three readings — the history is in
            // @/lib/kitchen-sheet beside plateCount(), where it is tested.
            price: isBuffet ? null : priceCell(priceById.get(l.id) ?? null, plateCount(qtyById.get(l.id) ?? 1, m.quantity)),
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
      // Every dish row gets price × count, extras included (Nik, from the
      // real 10-table booking: ข้าวผัดกุ้ง (กลาง) × 10 must print
      // "160 x 10", not a blank). The line quantity already IS the plate
      // count here — a direct dish line has no per-set factor.
      price: isBuffet ? null : priceCell(m.selling_price, m.quantity),
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
