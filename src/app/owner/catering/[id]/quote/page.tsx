export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSales } from "@/lib/auth";
import { getCateringEvent, getCateringCharges, getCateringSettings } from "../../actions";
import { parseDocState, docMoney, sortForCustomerDoc } from "@/lib/quote-doc";
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
// customer block and the line items are identical on all three, and three
// copies of that would drift.
//
// A SET IS ONE LINE (Nik, 2026-09-24): its name, the price per table, the
// table count and the line total, as the price box has them; the food ordered
// outside a set follows as its own lines. The dishes inside a set are NOT
// listed here any more — with several sets the quotation ran past one A4
// page. They belong to the event-details sheet (README item 39); until it
// exists, sales gives the customer the dish list as before.
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

  const [event, charges, settings] = await Promise.all([
    getCateringEvent(id),
    getCateringCharges(id),
    getCateringSettings(),
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

  // SETS FIRST, then the food outside a set, then the rest, discount last —
  // Nik's paper order, the same order the booking screen's price box renders
  // in (customerDocRank). Insertion order within a kind. The total below is
  // order-independent, so it sums the raw list.
  const lines: QuoteLine[] = sortForCustomerDoc(charges).map((c) => ({
    id: c.id,
    // The customer-facing name where the rate has one; the stored label
    // otherwise — which is also every hand-typed line, by construction.
    label: c.rate_display_label ?? c.label,
    note: c.note,
    unitPrice: c.unit_price,
    quantity: c.quantity,
    amount: c.amount,
  }));

  const money = docMoney(
    charges.reduce((s, c) => s + c.amount, 0),
    event.deposit_percent,
    event.deposit_amount,
  );

  return <QuoteClient event={event} doc={doc} lines={lines} money={money} settings={settings} fontClass={printFont.className} />;
}
