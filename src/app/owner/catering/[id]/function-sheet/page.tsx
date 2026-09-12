export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import {
  getCateringEvent, getCateringEventMenus, getCateringCharges,
  getCateringSetMenuItemsForSets, getStaffOptions,
} from "../../actions";
import { SET_MENU_SECTIONS } from "../../shared-utils";
import { groupBySection, moneyFields, type SheetLine, type SheetPackage } from "@/lib/function-sheet";
import { plateCount } from "@/lib/kitchen-sheet";
import { printFont } from "../print-font";
import { FunctionSheetClient } from "./FunctionSheetClient";

// ── ใบฟังก์ชั่นงาน — ฝ่ายบริการ (document A) ────────────────────────────────
//
// The service team's function sheet, rebuilt against the paper form Nik's
// team actually fills in. Not a customer document and not the kitchen's —
// the kitchen sheet (document B) is separate and prints different columns.
//
// NO PRICES ON THE FOOD LIST. The paper form has none: the service team
// needs to know what goes out, not what it costs. The four money fields in
// the header are the only figures on the sheet, and they are the four the
// paper form has.
//
// This page reads no cost and computes none — no getCostingContext(), no
// computeMenuCost(). It is requireSales(), so it must not.

export default async function CateringFunctionSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSales();
  const { id } = await params;

  const [event, eventMenus, charges, staffOptions] = await Promise.all([
    getCateringEvent(id),
    getCateringEventMenus(id),
    getCateringCharges(id),
    getStaffOptions(),
  ]);

  if (!event) notFound();

  // ── The food list ───────────────────────────────────────────────────────
  // A package line expands into its dishes, grouped by section. A dish line
  // added straight to the booking is not part of any package, so it prints
  // under รายการเพิ่มเติม — the same split document B makes with its
  // "รายการอาหารเพิ่มเติม" break.
  const setMenuIds = [...new Set(eventMenus.filter((m) => m.set_menu_id).map((m) => m.set_menu_id as string))];
  const itemsBySet = await getCateringSetMenuItemsForSets(setMenuIds);

  const packages: SheetPackage[] = eventMenus
    .filter((m) => m.set_menu_id)
    .map((m) => ({
      id: m.id,
      name: m.name,
      quantity: m.quantity,
      note: m.note,
      // Grouped here rather than in the client so the client renders what it
      // is given: a group that reaches it is a group with rows in it. Each
      // line quantity is plates for the WHOLE JOB — per-set count × sets
      // ordered, the same plateCount() the kitchen sheet uses, so the two
      // sheets can never disagree about how many go out.
      groups: groupBySection(itemsBySet.get(m.set_menu_id as string) ?? [], SET_MENU_SECTIONS).map((g) => ({
        ...g,
        lines: g.lines.map((l) => ({ ...l, quantity: plateCount(l.quantity, m.quantity) })),
      })),
    }));

  const extras: SheetLine[] = eventMenus
    .filter((m) => !m.set_menu_id)
    .map((m) => ({ id: m.id, name: m.name, quantity: m.quantity, note: m.note }));

  // The four money fields: the figure where the booking holds one, a ruled
  // line where it does not. The rule and the reason ค่าไฟ is always a ruled
  // line live in @/lib/function-sheet, with tests.
  const money = moneyFields(charges, event.deposit_amount);

  return (
    <FunctionSheetClient
      event={event}
      packages={packages}
      extras={extras}
      money={money}
      staffOptions={staffOptions}
      fontClass={printFont.className}
    />
  );
}
