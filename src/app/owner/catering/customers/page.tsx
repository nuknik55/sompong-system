export const dynamic = "force-dynamic";

import { requireSales, isAdminOrAbove } from "@/lib/auth";
import { getCateringCustomerList } from "../actions";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { CustomerListClient } from "./CustomerListClient";

export default async function CateringCustomersPage() {
  const profile = await requireSales();
  const customers = await getCateringCustomerList();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <CateringSubNav isAdmin={isAdminOrAbove(profile.role)} />

      <h1 className="font-kanit text-lg font-semibold text-neutral-900">ลูกค้า</h1>

      <CustomerListClient customers={customers} />
    </div>
  );
}
