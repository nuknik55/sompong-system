export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSales, isAdminOrAbove } from "@/lib/auth";
import {
  getCateringEvent, getCateringCustomers, getStaffOptions, getCateringCharges, getCateringRates,
  getCateringSetMenuOptions, getCateringDishOptions, getCateringTaskCompletions, getCateringActivityLog,
} from "../actions";
import { thFullDate, StatusBadge } from "../shared-utils";
import { BookingScreen } from "../BookingScreen";
import { TaskChecklistSection } from "./TaskChecklistSection";
import { ActivityLogSection } from "./ActivityLogSection";

/**
 * An existing booking: the same one screen, filled. The former detail page
 * (booking above, charges below, separate edit and save) is gone; there
 * were zero live events, so nothing was stranded. The checklist, activity
 * log and cost page sit under "เพิ่มเติม", off the daily path.
 */
export default async function CateringEventPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireSales();
  const { id } = await params;

  const [event, customers, staffOptions, charges, rates, setMenuOptions, dishOptions, taskCompletions, activityLog] = await Promise.all([
    getCateringEvent(id), getCateringCustomers(), getStaffOptions(), getCateringCharges(id), getCateringRates(),
    getCateringSetMenuOptions(), getCateringDishOptions(), getCateringTaskCompletions(id), getCateringActivityLog(id),
  ]);
  if (!event) notFound();

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

      <details className="mt-6 rounded-xl border border-neutral-200 bg-neutral-50">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-neutral-700">เพิ่มเติม — เช็กลิสต์ · ประวัติการแก้ไข{isAdminOrAbove(profile.role) ? " · ต้นทุน-กำไร" : ""}</summary>
        <div className="space-y-4 border-t border-neutral-200 bg-white p-5">
          {isAdminOrAbove(profile.role) && (
            <Link href={`/owner/catering/${event.id}/cost`} className="inline-block rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
              ต้นทุน-กำไร ของงานนี้
            </Link>
          )}
          <TaskChecklistSection event={event} initialCompletions={taskCompletions} />
          <ActivityLogSection entries={activityLog} />
        </div>
      </details>
    </div>
  );
}
