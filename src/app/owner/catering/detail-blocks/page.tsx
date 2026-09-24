export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { PageShell } from "@/components/ui/page";
import { VENUE_OPTIONS, LOCATION_TYPE_OPTIONS } from "../location";
import { readLibraryBlocks, signImages } from "../[id]/details/sheet-data";
import { LibraryClient } from "./LibraryClient";

// ── คลังรายละเอียดงาน — the event-details sheet's library (Nik, 2026-09-24) ─
//
// Any number of blocks, each a terms text, a photo or a diagram, tagged with
// the venues it suits (free text: there is no fixed list of venue types; the
// booking's own venue names are offered as suggestions). Owner and admin keep
// it (requireAdmin). On a booking, the blocks whose tags match its venue are
// offered first and sales picks; the booking keeps its own copy.

export default async function DetailBlocksPage() {
  await requireAdmin();
  const supabase = await createClient();
  const blocks = await readLibraryBlocks();
  // How many bookings hold a copy of each block: a count per block, so no
  // row cap can make a used block read as unused.
  const counts = await Promise.all(blocks.map((b) =>
    supabase.from("catering_event_detail_blocks").select("id", { count: "exact", head: true }).eq("block_id", b.id)));
  const usage: Record<string, number> = {};
  blocks.forEach((b, i) => {
    if (counts[i].error) throw counts[i].error;
    usage[b.id] = counts[i].count ?? 0;
  });
  const urls = await signImages(blocks.map((b) => b.image_path));
  const suggestions = [...LOCATION_TYPE_OPTIONS.map((o) => o.label), ...VENUE_OPTIONS.map((o) => o.label)];

  return (
    <PageShell>
      <CateringSubNav isAdmin={true} />
      <LibraryClient blocks={blocks} usage={usage} urls={urls} suggestions={suggestions} />
    </PageShell>
  );
}
