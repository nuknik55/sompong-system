export const dynamic = "force-dynamic";

import { requireSales, isAdminOrAbove } from "@/lib/auth";
import { getCateringCustomerList } from "../actions";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { CustomerListClient } from "./CustomerListClient";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function CateringCustomersPage() {
  const profile = await requireSales();
  const customers = await getCateringCustomerList();

  return (
    <PageShell>
      <CateringSubNav isAdmin={isAdminOrAbove(profile.role)} />

      <PageHeader title="ลูกค้า" />

      <CustomerListClient customers={customers} />
    </PageShell>
  );
}
