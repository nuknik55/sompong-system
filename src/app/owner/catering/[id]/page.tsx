export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales } from "@/lib/auth";
import { getCateringEvent, getCateringCustomers, getStaffOptions } from "../actions";
import { EventDetailClient } from "./EventDetailClient";

export default async function CateringEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSales();
  const { id } = await params;

  const [event, customers, staffOptions] = await Promise.all([
    getCateringEvent(id),
    getCateringCustomers(),
    getStaffOptions(),
  ]);

  if (!event) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <EventDetailClient event={event} customers={customers} staffOptions={staffOptions} />
    </div>
  );
}
