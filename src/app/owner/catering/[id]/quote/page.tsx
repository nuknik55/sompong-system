export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSales } from "@/lib/auth";
import { getCateringEvent, getCateringCharges, getCateringSettings } from "../../actions";
import { QuoteClient } from "./QuoteClient";

export default async function CateringQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSales();
  const { id } = await params;

  const [event, charges, settings] = await Promise.all([
    getCateringEvent(id),
    getCateringCharges(id),
    getCateringSettings(),
  ]);

  if (!event) notFound();

  // A quote_number only exists once issueCateringQuote() has run at least
  // once — no partial/unissued document is ever renderable here.
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

  return <QuoteClient event={event} charges={charges} settings={settings} />;
}
