export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { getCateringEvent, getCateringEventMenus, getEventMenuDishes, getWeightSoldMenuIds } from "../../actions";
import { isSetLine, isTypedDish } from "../../event-menu";
import { SET_MENU_SECTIONS } from "../../shared-utils";
import { groupBySection } from "@/lib/function-sheet";
import { dishAmount, dishPrice, PER_HEAD_UNIT } from "@/lib/kitchen-sheet";
import { printFont } from "../print-font";
import { KitchenSheetClient, type KitchenRow, type KitchenBlock } from "./KitchenSheetClient";

// ── ใบฟังก์ชั่นงาน — ฝ่ายครัว (document B) ─────────────────────────────────
//
// The kitchen's copy. Different document from the service sheet: same
// booking, different columns, different reader.
//
// THE ราคา COLUMN IS A PORTION SIZE, NOT MONEY THE KITCHEN ACTS ON. The
// reasoning is in src/lib/kitchen-sheet.ts, where the rule is tested; the
// short version is that Sompong sells the same dish at several sizes, so the
// à la carte selling price is how the chef is told which size to plate. It
// prints alone, never multiplied into money. The จำนวน column prints the
// per-set quantity and the set count (โต๊ะ, กล่อง or ชุด) SEPARATELY, then the total —
// "1 × 10 โต๊ะ = 10", and in kilos for a dish sold by weight, "0.5 กก. × 20
// โต๊ะ = 10 กก." — because "1,000 x 10" read as ten one-kilo plates.
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

  const [event, eventMenus, weightIds] = await Promise.all([
    getCateringEvent(id),
    getCateringEventMenus(id),
    getWeightSoldMenuIds(),
  ]);

  if (!event) notFound();

  // What is served at each set line: the booking's OWN copy, or the shared
  // set for a booking from before the copy existed (catering per-event
  // menus). The kitchen prints what this booking will serve, not what the
  // shared set says today.
  const dishesByLine = await getEventMenuDishes(id);

  // Header only. Neither the ราคา nor the จำนวน column uses this: each set
  // line prints its own count of sets, which can differ from the booking's
  // table count (it is copied only when the set is added).
  const tableCount = event.table_count;

  // A BUFFET PRINTS NO PER-DISH PRICES. Nik's paper buffet sheet has none —
  // a buffet is cooked to the guest count in the header, not per-plate
  // portions — so the stored food_format blanks the ราคา and จำนวน columns. That is the
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
    .filter(isSetLine)
    .map((m) => {
      const source = dishesByLine.get(m.id)?.dishes ?? [];
      const groups = groupBySection(source, SET_MENU_SECTIONS);
      const dishById = new Map(source.map((r) => [r.id, r]));
      let n = 0;
      return {
        id: m.id,
        // A per-head line: the guests, since its amounts are blank.
        title: m.per_head ? `${m.name} — ${m.quantity} ${PER_HEAD_UNIT}` : m.name,
        sections: groups.map((g) => ({
          label: g.label,
          rows: g.lines.map((l): KitchenRow => ({
            id: l.id,
            index: ++n,
            name: l.name,
            // The size, and then per-set count × sets ordered = the whole
            // job. The count took three readings and the print a fourth —
            // the history is in @/lib/kitchen-sheet, where it is tested.
            // A TYPED dish (not in the menu list) has no selling price, so
            // no portion size: the ราคา cell is blank (Nik, 2026-09-25).
            price: isBuffet || !dishById.get(l.id) || isTypedDish(dishById.get(l.id)!)
              ? null
              : dishPrice(dishById.get(l.id)?.selling_price ?? null, dishById.get(l.id)?.menu_id ?? null, weightIds),
            // A per-head line has no kitchen count to multiply by: blank, as
            // a buffet's (no count is invented).
            amount: isBuffet || m.per_head ? null : dishAmount(
              { quantity: dishById.get(l.id)?.quantity ?? 1, menu_id: dishById.get(l.id)?.menu_id ?? null },
              m.quantity, weightIds, event.food_format,
            ),
            note: l.note,
          })),
        })),
      };
    });

  // รายการอาหารเพิ่มเติม — dishes added to the booking outside any package.
  // Its own numbering, because it is the sheet's second list, not a
  // continuation of the first.
  const extras: KitchenRow[] = eventMenus
    .filter((m) => !isSetLine(m))
    .map((m, i) => ({
      id: m.id,
      index: i + 1,
      name: m.name,
      // Every dish row gets its size and its count, extras included (Nik,
      // from the real 10-table booking: ข้าวผัดกุ้ง (กลาง) × 10 must not
      // print a blank). The line quantity already IS the whole job's here —
      // a direct dish line has no per-set factor, so no set count.
      price: isBuffet ? null : dishPrice(m.selling_price, m.menu_id, weightIds),
      amount: isBuffet ? null : dishAmount({ quantity: m.quantity, menu_id: m.menu_id }, null, weightIds, event.food_format),
      note: m.note,
    }));

  return (
    <KitchenSheetClient
      event={event}
      tableCount={tableCount}
      packages={packages}
      extras={extras}
      fontClass={printFont.className}
    />
  );
}
