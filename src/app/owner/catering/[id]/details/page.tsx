export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { PageShell } from "@/components/ui/page";
import { blocksForVenue } from "@/lib/event-sheet";
import { isBookingId, readLibraryBlocks, readSheetBlocks, readSheetEvent, sheetToken, signImages, venueNames } from "./sheet-data";
import { DetailsClient } from "./DetailsClient";

// ── ใบรายละเอียดงาน — a booking's event-details sheet (Nik, 2026-09-24) ─────
//
// What the customer gets with the quotation besides the prices: the food,
// the free items, the job notes, and blocks picked from the library (terms
// text, room photos, layout diagrams) — the library's blocks for this
// booking's venue offered first. Sales edits a picked block's text for this
// booking only; the library's copy never changes.
//
// Owner, admin and sales (requireSales). Editable as the booking's other
// non-price fields are: not on a cancelled booking, and not on a cost-locked
// one, for anyone.
//
// COST ISOLATION: this page, its client and its save action import nothing
// that computes cost (menu-card/cost-isolation.test.ts walks them).

export default async function EventDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSales();
  const { id } = await params;
  if (!isBookingId(id)) notFound();
  const event = await readSheetEvent(id);
  if (!event) notFound();
  const [blocks, library] = await Promise.all([readSheetBlocks(id), readLibraryBlocks()]);
  const urls = await signImages([...blocks.map((b) => b.image_path), ...library.map((b) => b.image_path)]);
  const names = venueNames(event);
  const { matching, others } = blocksForVenue(library, names);

  return (
    <PageShell>
      <DetailsClient
        eventId={id}
        token={sheetToken(event.sheet_notes, blocks)}
        notes={event.sheet_notes ?? ""}
        blocks={blocks.map((b) => ({ id: b.id, block_id: b.block_id, kind: b.kind, title: b.title, body: b.body, image_path: b.image_path, caption: b.caption }))}
        matching={matching}
        others={others}
        venueNames={names}
        urls={urls}
        readOnly={event.status === "cancelled" ? "cancelled" : event.cost_locked_at ? "locked" : null}
        customerName={event.customer_name}
        eventDate={event.event_date}
      />
    </PageShell>
  );
}
