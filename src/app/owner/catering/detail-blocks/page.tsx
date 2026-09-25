export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { PageShell } from "@/components/ui/page";
import { VENUE_OPTIONS, LOCATION_TYPE_OPTIONS } from "../location";
import { DETAILS_BUCKET, readLibraryBlocks, readLibraryImages, signImages } from "../[id]/details/sheet-data";
import { LibraryClient } from "./LibraryClient";

// ── คลังรายละเอียดงาน — the event-details sheet's libraries (Nik, 2026-09-24) ─
//
// Terms texts, and images (room photos, table-layout diagrams), each tagged
// with the venues it suits (free text: there is no fixed list of venue
// types; the booking's own venue names are offered as suggestions). Owner and
// admin keep them (requireAdmin). On a booking, the entries whose tags match
// its venue are offered first and sales picks; the booking keeps its own
// copy of a text and its own caption for an image.

export default async function DetailBlocksPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [blocks, images] = await Promise.all([readLibraryBlocks(), readLibraryImages()]);
  // How many bookings use each entry: a count per entry, so no row cap can
  // make a used entry read as unused.
  const [blockCounts, imageCounts, files] = await Promise.all([
    Promise.all(blocks.map((b) => supabase.from("catering_event_detail_blocks").select("id", { count: "exact", head: true }).eq("block_id", b.id))),
    Promise.all(images.map((g) => supabase.from("catering_event_detail_images").select("id", { count: "exact", head: true }).eq("image_id", g.id))),
    // The bucket's files, for the 100-file cap (the upload policy counts the same).
    supabase.storage.from(DETAILS_BUCKET).list("lib", { limit: 1000 }),
  ]);
  const usage: Record<string, number> = {};
  blocks.forEach((b, i) => { if (blockCounts[i].error) throw blockCounts[i].error; usage[b.id] = blockCounts[i].count ?? 0; });
  images.forEach((g, i) => { if (imageCounts[i].error) throw imageCounts[i].error; usage[g.id] = imageCounts[i].count ?? 0; });
  const urls = await signImages(images.map((g) => g.image_path));
  const suggestions = [...LOCATION_TYPE_OPTIONS.map((o) => o.label), ...VENUE_OPTIONS.map((o) => o.label)];

  return (
    <PageShell>
      <CateringSubNav isAdmin={true} />
      <LibraryClient
        blocks={blocks}
        images={images}
        usage={usage}
        urls={urls}
        fileCount={files.error ? null : (files.data ?? []).length}
        suggestions={suggestions}
      />
    </PageShell>
  );
}
