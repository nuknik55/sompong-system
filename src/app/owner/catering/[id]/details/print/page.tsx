export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { printFont } from "../../print-font";
import { isBookingId, readSheetContent } from "../sheet-data";
import { EventSheet } from "../EventSheet";
import { PrintToolbar } from "../PrintToolbar";

// ── ใบรายละเอียดงาน, printed alone (Nik, 2026-09-24) ─────────────────────────
//
// The same sheet the quotation prints after itself, with its own print
// button. Owner, admin and sales (requireSales). Imports nothing that
// computes cost (menu-card/cost-isolation.test.ts).

export default async function EventSheetPrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSales();
  const { id } = await params;
  if (!isBookingId(id)) notFound();
  const content = await readSheetContent(id);
  if (!content) notFound();
  return (
    <>
      <PrintToolbar eventId={id} />
      <EventSheet content={content} fontClass={printFont.className} />
    </>
  );
}
