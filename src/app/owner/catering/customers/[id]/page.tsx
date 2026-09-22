export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSales, isAdminOrAbove } from "@/lib/auth";
import { getCateringCustomer, getCateringCustomerEvents } from "../../actions";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { CustomerDetailClient } from "./CustomerDetailClient";
import { PageShell } from "@/components/ui/page";

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
    <PageShell>
      <CateringSubNav isAdmin={isAdminOrAbove(profile.role)} />
      <CustomerDetailClient customer={customer} events={events} />
    </PageShell>
  );
}
