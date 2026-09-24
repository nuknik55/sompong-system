export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { buildMenuCard, defaultCopies } from "@/lib/menu-card";
import { readEventMenus, readEventMenuDishes } from "../../menu-read";
import { EVENT_MENU_SECTION_LIST } from "../../menu-lines";
import { VENUE_LABEL } from "../../location";
import { readMenuCardEvent } from "./card-data";
import { MenuCardClient } from "./MenuCardClient";

// ── การ์ดเมนูบนโต๊ะ — the menu card on each table (Nik, 2026-09-24) ─────────
//
// One A4 portrait page per table, all identical, in colour. Owner, admin and
// sales (requireSales), for every status except cancelled.
//
// COST ISOLATION: this page and its save action import nothing that computes
// cost — not actions.ts (the admin operating costs), not event-menu.ts
// (foodCostFigure, lineFoodCost), not shared-utils.tsx (which imports
// event-menu.ts). The food lines come from menu-read.ts, the SAME reads the
// kitchen sheet, the function sheet and the quotation run through actions.ts's
// wrappers. cost-isolation.test.ts walks this page's imports and fails if any
// module it reaches exports a cost figure.

export default async function CateringMenuCardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSales();
  const { id } = await params;
  const event = await readMenuCardEvent(id);
  if (!event) notFound();

  if (event.status === "cancelled") {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-8 text-center">
        <p className="text-neutral-700">งานนี้ถูกยกเลิกแล้ว จึงไม่มีการ์ดเมนูให้พิมพ์</p>
        <Link href={`/owner/catering/${id}`} className="text-sm text-neutral-500 underline hover:text-neutral-800">← กลับไปหน้างาน</Link>
      </div>
    );
  }

  const [eventMenus, dishesByLine] = await Promise.all([readEventMenus(id), readEventMenuDishes(id)]);
  const card = buildMenuCard({
    eventTypeLabel: event.event_type_label,
    customerName: event.customer_name,
    companyName: event.customer_company_name,
    eventDate: event.event_date,
    venue: event.location_type === "offsite"
      ? (event.offsite_address ?? "").split(/\r?\n/)[0] ?? null
      : event.venue ? VENUE_LABEL[event.venue] ?? null : null,
    setLines: eventMenus
      .filter((m) => m.kind === "set")
      .map((m) => ({ id: m.id, name: m.name, dishes: dishesByLine.get(m.id)?.dishes ?? [] })),
    extraNames: eventMenus.filter((m) => m.kind !== "set").map((m) => m.name),
    sections: EVENT_MENU_SECTION_LIST,
  });

  return (
    <MenuCardClient
      eventId={event.id}
      card={card}
      initialCopies={defaultCopies(event.table_count)}
      tableCount={event.table_count}
      savedLines={event.menu_card_lines ?? ""}
      locked={event.cost_locked_at != null}
    />
  );
}
