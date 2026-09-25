export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSales, isAdminOrAbove } from "@/lib/auth";
import {
  getCateringEvent, getCateringCustomers, getStaffOptions, getCateringCharges, getCateringRates,
  getCateringEventTypes, getCateringSetMenuOptions, getCateringDishOptions, getCateringActivityLog, getEventMenuDishes,
  getCateringEventMenus,
} from "../actions";
import { thDate, BookingStatusBadge } from "../shared-utils";
import { buttonClass } from "@/components/ui/button";
import { ButtonGroup, PageHeader, PageShell } from "@/components/ui/page";
import { dishNamesForPriceBox } from "../event-menu";
import { BookingScreen } from "../BookingScreen";
import { ActivityLogSection } from "./ActivityLogSection";

/**
 * A booking: the one screen, filled. The former split detail page (booking
 * above, charges below, separate edit and save) is gone.
 *
 * Below the screen, a secondary row of BUTTONS — the customer's page (which
 * also feeds the booking screen's name autocomplete), the cost P&L for
 * admins, and the activity log. These lived behind an เพิ่มเติม collapse
 * until Nik used the page for a real job: two clicks to reach anything, and
 * the collapse read as "nothing important here". One click to anything now;
 * the log still expands in place because it is a section, not a page. The
 * 12-task sales checklist that once sat here was deleted — Nik does not use
 * it, and it shares no item with the 13-check venue sheet his team actually
 * fills in by hand.
 */
export default async function CateringEventPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireSales();
  const { id } = await params;

  const [event, customers, staffOptions, charges, rates, eventTypes, setMenuOptions, dishOptions, activityLog, dishesByLine, eventMenus] = await Promise.all([
    getCateringEvent(id), getCateringCustomers(), getStaffOptions(), getCateringCharges(id), getCateringRates(),
    getCateringEventTypes(), getCateringSetMenuOptions(), getCateringDishOptions(), getCateringActivityLog(id), getEventMenuDishes(id),
    getCateringEventMenus(id),
  ]);
  if (!event) notFound();

  // What each set line serves, for the price box (item 5, Nik 2026-09-19).
  // The same resolver the sheets, the quotation and the menu page read.
  const dishNamesByMenuLine: Record<string, string[]> = {};
  for (const [lineId, served] of dishesByLine) dishNamesByMenuLine[lineId] = dishNamesForPriceBox(served.dishes);
  // The saved lines priced per guest: the price box labels their count ท่าน.
  const perHeadMenuLines = eventMenus.filter((m) => m.per_head).map((m) => m.id);

  const isAdmin = isAdminOrAbove(profile.role);

  return (
    <PageShell>
      <PageHeader
        back={{ href: "/owner/catering", label: "รายการจอง" }}
        title={event.customer_name ?? "การจอง"}
        subtitle={<><BookingStatusBadge status={event.status} /><span>{thDate(event.event_date)}</span></>}
        // AT THE TOP AS WELL AS THE BOTTOM. The bottom row sits under the
        // entire booking form — a screen or two of scrolling — and on the
        // day this shipped the head chef could not find it there
        // (2026-09-19). The button below stays: that row is where someone
        // who has just finished editing a booking looks next.
        actions={
          <Link href={`/owner/catering/${event.id}/menu`} className={buttonClass("secondary")}>
            รายการอาหารของงาน
          </Link>
        }
      />

      {/* KEYED ON THE BOOKING ALONE (queue item 41, Nik 2026-09-21). It used
          to be keyed on the charge rows, so that after a save the screen did
          not keep the state it was saved FROM (review, 2026-09-19); but then
          ANY refresh that brought changed rows — another tab's save, the menu
          page — remounted it and threw away unsaved typing, with the guard
          reporting clean. The screen now decides itself: it takes new data
          when its form is clean or its own save lands, and otherwise keeps
          the draft and says the booking changed (serverViewAction). */}
      <BookingScreen
        key={event.id}
        event={event}
        initialCharges={charges}
        customers={customers}
        staffOptions={staffOptions}
        rates={rates}
        eventTypes={eventTypes}
        setMenuOptions={setMenuOptions}
        dishOptions={dishOptions}
        defaultStaffId={profile.employee_id}
        dishNamesByMenuLine={dishNamesByMenuLine}
        perHeadMenuLines={perHeadMenuLines}
      />

      {/* ดูข้อมูลเพิ่ม: the pages about this booking, in Nik's order
          (2026-09-22). Each keeps its old condition. */}
      <ButtonGroup label="ดูข้อมูลเพิ่ม">
        {/* The booking's own menu (catering per-event menus): sales views, owner and admin edit — decided on that page. */}
        <Link href={`/owner/catering/${event.id}/menu`} className={buttonClass("secondary")}>
          รายการอาหารของงาน
        </Link>
        {event.customer_id && (
          <Link href={`/owner/catering/customers/${event.customer_id}`} className={buttonClass("secondary")}>
            ข้อมูลลูกค้า · ประวัติการจอง
          </Link>
        )}
        {isAdmin && (
          <Link href={`/owner/catering/${event.id}/cost`} className={buttonClass("secondary")}>
            ต้นทุน-กำไร ของงานนี้
          </Link>
        )}
        {/* Edit and delete buttons for the owner alone (Nik, 2026-09-17);
            the database allows the same account and nothing more. */}
        <ActivityLogSection eventId={event.id} entries={activityLog} canEdit={profile.role === "owner"} />
      </ButtonGroup>
    </PageShell>
  );
}
