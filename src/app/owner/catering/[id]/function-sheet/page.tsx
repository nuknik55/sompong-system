export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { getCateringEvent, getCateringEventMenus, getCateringCharges, getStaffOptions } from "../../actions";
import { FunctionSheetClient, type FunctionSheetItem } from "./FunctionSheetClient";

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

  // Reuses the existing event_menu_id link (see actions.ts) rather than a
  // new query: group each item's linked charges and derive its price from
  // them, instead of re-deriving from catering_set_menus/menus — the charge
  // is the actual agreed price, which may have been hand-adjusted after the
  // fact. A repeat-add bumps quantity on the same catering_event_menus row
  // but always inserts a fresh charge row, so a row can have more than one
  // linked charge — sum their amounts and divide by the item's total
  // quantity so the displayed price stays correct either way. A row from
  // before this link existed has no linked charge at all; its price shows
  // as unknown ("-") rather than a misleading ฿0.00.
  const chargesByMenuId = new Map<string, typeof charges>();
  for (const c of charges) {
    if (!c.event_menu_id) continue;
    const list = chargesByMenuId.get(c.event_menu_id) ?? [];
    list.push(c);
    chargesByMenuId.set(c.event_menu_id, list);
  }
  const items: FunctionSheetItem[] = eventMenus.map((m) => {
    const linked = chargesByMenuId.get(m.id) ?? [];
    const totalAmount = linked.reduce((s, c) => s + c.amount, 0);
    return {
      id: m.id,
      name: m.name,
      quantity: m.quantity,
      unit_price: linked.length > 0 && m.quantity > 0 ? totalAmount / m.quantity : null,
      note: m.note,
    };
  });

  return <FunctionSheetClient event={event} items={items} staffOptions={staffOptions} />;
}
