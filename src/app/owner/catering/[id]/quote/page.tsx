export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSales } from "@/lib/auth";
import {
  getCateringEvent, getCateringCharges, getCateringSettings,
  getCateringEventMenus, getCateringSetMenuItemsForSets,
} from "../../actions";
import { SET_MENU_SECTIONS } from "../../shared-utils";
import { groupBySection } from "@/lib/function-sheet";
import { parseDocState, docMoney } from "@/lib/quote-doc";
import { printFont } from "../print-font";
import { QuoteClient, type QuoteLine } from "./QuoteClient";

// ── ใบเสนอราคา / ใบมัดจำ / ใบแจ้งหนี้ (document C) ─────────────────────────
//
// ONE route, three states, ONE number. ?doc=quote|deposit|invoice, defaulting
// to the quote — the booking screen's existing link carries no parameter and
// must keep working.
//
// They are the same document with different money rows and different
// conditions, which is why they are not three routes: the letterhead, the
// customer block, the line items and the dish sub-lines are identical on all
// three, and three copies of that would drift.
//
// The rules — which rows print, what the balance is computed from, and the
// conditions text — are in @/lib/quote-doc, tested.

// The document face is shared by all three documents — see ../print-font.ts.

export default async function CateringQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ doc?: string }>;
}) {
  await requireSales();
  const { id } = await params;
  const rawDoc = parseDocState((await searchParams).doc);

  const [event, charges, settings, eventMenus] = await Promise.all([
    getCateringEvent(id),
    getCateringCharges(id),
    getCateringSettings(),
    getCateringEventMenus(id),
  ]);

  if (!event) notFound();

  // 0 = agreed no deposit: the ใบมัดจำ state does not exist for this job —
  // the tab is hidden client-side, and a direct URL lands on the quote
  // rather than a deposit document that contradicts its own terms.
  const doc = rawDoc === "deposit" && event.deposit_percent === 0 ? "quote" : rawDoc;

  // A quote_number only exists once issueCateringQuote() has run at least
  // once — no partial/unissued document is ever renderable here, in any state.
  if (!event.quote_number) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="mb-4 text-neutral-600">ยังไม่ได้ออกใบเสนอราคาสำหรับงานนี้</p>
        <Link href={`/owner/catering/${id}`} className="text-sm text-blue-600 hover:underline">
          ← กลับไปหน้าจอง
        </Link>
      </div>
    );
  }

  // Dish sub-lines under each package line. The SAME expansion the service
  // sheet and the kitchen sheet use — one definition of what is inside a
  // package, so the customer, the floor and the kitchen cannot be told three
  // different things.
  const setIdByEventMenu = new Map(
    eventMenus.filter((m) => m.set_menu_id).map((m) => [m.id, m.set_menu_id as string]),
  );
  const itemsBySet = await getCateringSetMenuItemsForSets([...new Set(setIdByEventMenu.values())]);

  const lines: QuoteLine[] = charges.map((c) => {
    const setId = c.event_menu_id ? setIdByEventMenu.get(c.event_menu_id) : undefined;
    const groups = setId ? groupBySection(itemsBySet.get(setId) ?? [], SET_MENU_SECTIONS) : [];
    return {
      id: c.id,
      // The customer-facing name where the rate has one; the stored label
      // otherwise — which is also every hand-typed line, by construction.
      label: c.rate_display_label ?? c.label,
      note: c.note,
      unitPrice: c.unit_price,
      quantity: c.quantity,
      amount: c.amount,
      // Flattened to names only: the customer is being shown what is included,
      // not a second priced table. Section order is preserved, and a section
      // with no rows contributes nothing.
      dishes: groups.flatMap((g) => g.lines.map((l) => l.name)),
    };
  });

  const money = docMoney(
    charges.reduce((s, c) => s + c.amount, 0),
    event.deposit_percent,
    event.deposit_amount,
  );

  return <QuoteClient event={event} doc={doc} lines={lines} money={money} settings={settings} fontClass={printFont.className} />;
}
