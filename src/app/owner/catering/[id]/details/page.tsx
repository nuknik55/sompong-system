export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { PageShell } from "@/components/ui/page";
import { blocksForVenue } from "@/lib/event-sheet";
import {
  isBookingId, readLibraryBlocks, readLibraryImages, readSheetBlocks, readSheetEvent, readSheetImages, sheetToken, signImages, venueNames,
} from "./sheet-data";
import { DetailsClient } from "./DetailsClient";

// ── ใบรายละเอียดงาน — a booking's event-details sheet (Nik, 2026-09-24) ─────
//
// What the customer gets with the quotation besides the prices: the food,
// the free items, the job notes, and what sales picks from the two
// libraries — terms texts and images (room photos, layout diagrams) — the
// library's entries for this booking's venue offered first. Sales edits a
// picked text, or a picked image's caption, for this booking only; the
// library never changes. Images for this booking alone are not kept: they
// are picked on the print page, for that print.
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
  const [blocks, images, libraryBlocks, libraryImages] = await Promise.all([
    readSheetBlocks(id), readSheetImages(id), readLibraryBlocks(), readLibraryImages(),
  ]);
  const urls = await signImages(libraryImages.map((g) => g.image_path));
  const names = venueNames(event);

  return (
    <PageShell>
      <DetailsClient
        eventId={id}
        token={sheetToken(event.sheet_notes, blocks, images)}
        notes={event.sheet_notes ?? ""}
        blocks={blocks.map((b) => ({ id: b.id, block_id: b.block_id, title: b.title, body: b.body }))}
        images={images.map((g) => ({ id: g.id, image_id: g.image_id, caption: g.caption }))}
        terms={blocksForVenue(libraryBlocks, names)}
        library={blocksForVenue(libraryImages, names)}
        venueNames={names}
        urls={urls}
        readOnly={event.status === "cancelled" ? "cancelled" : event.cost_locked_at ? "locked" : null}
        customerName={event.customer_name}
        eventDate={event.event_date}
      />
    </PageShell>
  );
}
