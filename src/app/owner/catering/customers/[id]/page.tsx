export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales, isAdminOrAbove } from "@/lib/auth";
import { getCateringCustomer, getCateringCustomerEvents } from "../../actions";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { CustomerDetailClient } from "./CustomerDetailClient";

export default async function CateringCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireSales();
  const { id } = await params;

  const [customer, events] = await Promise.all([
    getCateringCustomer(id),
    getCateringCustomerEvents(id),
  ]);

  if (!customer) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <CateringSubNav isAdmin={isAdminOrAbove(profile.role)} />
      <CustomerDetailClient customer={customer} events={events} />
    </div>
  );
}
