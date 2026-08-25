export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales, isAdminOrAbove } from "@/lib/auth";
import {
  getCateringEvent, getCateringCustomers, getStaffOptions, getCateringCharges, getCateringRates,
  getCateringEventMenus, getCateringSetMenuOptions, getCateringDishOptions, getCateringTaskCompletions,
  getCateringActivityLog,
} from "../actions";
import { EventDetailClient } from "./EventDetailClient";

export default async function CateringEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireSales();
  const { id } = await params;

  const [event, customers, staffOptions, charges, rates, eventMenus, setMenuOptions, dishOptions, taskCompletions, activityLog] = await Promise.all([
    getCateringEvent(id),
    getCateringCustomers(),
    getStaffOptions(),
    getCateringCharges(id),
    getCateringRates(),
    getCateringEventMenus(id),
    getCateringSetMenuOptions(),
    getCateringDishOptions(),
    getCateringTaskCompletions(id),
    getCateringActivityLog(id),
  ]);

  if (!event) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <EventDetailClient
        event={event}
        customers={customers}
        staffOptions={staffOptions}
        charges={charges}
        rates={rates}
        eventMenus={eventMenus}
        setMenuOptions={setMenuOptions}
        dishOptions={dishOptions}
        taskCompletions={taskCompletions}
        activityLog={activityLog}
        isAdmin={isAdminOrAbove(profile.role)}
      />
    </div>
  );
}
