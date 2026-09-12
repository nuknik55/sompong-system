export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSales, isAdminOrAbove } from "@/lib/auth";
import {
  getCateringEvent, getCateringCustomers, getStaffOptions, getCateringCharges, getCateringRates,
  getCateringSetMenuOptions, getCateringDishOptions, getCateringActivityLog,
} from "../actions";
import { thFullDate, StatusBadge } from "../shared-utils";
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

  const [event, customers, staffOptions, charges, rates, setMenuOptions, dishOptions, activityLog] = await Promise.all([
    getCateringEvent(id), getCateringCustomers(), getStaffOptions(), getCateringCharges(id), getCateringRates(),
    getCateringSetMenuOptions(), getCateringDishOptions(), getCateringActivityLog(id),
  ]);
  if (!event) notFound();

  const isAdmin = isAdminOrAbove(profile.role);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">{event.customer_name ?? "การจอง"}</h1>
          <StatusBadge status={event.status} />
          <span className="text-sm text-neutral-500">{thFullDate(event.event_date)}</span>
        </div>
        <Link href="/owner/catering" className="text-sm text-neutral-500 hover:text-neutral-800">← รายการจอง</Link>
      </div>

      <BookingScreen
        event={event}
        initialCharges={charges}
        customers={customers}
        staffOptions={staffOptions}
        rates={rates}
        setMenuOptions={setMenuOptions}
        dishOptions={dishOptions}
        defaultStaffId={profile.employee_id}
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {event.customer_id && (
          <Link
            href={`/owner/catering/customers/${event.customer_id}`}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            ข้อมูลลูกค้า · ประวัติการจอง
          </Link>
        )}
        {isAdmin && (
          <Link
            href={`/owner/catering/${event.id}/cost`}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            ต้นทุน-กำไร ของงานนี้
          </Link>
        )}
        <ActivityLogSection entries={activityLog} />
      </div>
    </div>
  );
}
