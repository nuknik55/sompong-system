export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getAllSuppliers } from "../actions";
import { SuppliersClient } from "./SuppliersClient";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function SuppliersPage() {
  await requireAdmin();
  const suppliers = await getAllSuppliers();

  return (
    <PageShell>
      <PageHeader back={{ href: "/owner/accounting", label: "บัญชี", reload: true }} title="จัดการซัพพลายเออร์" />

      <SuppliersClient initialSuppliers={suppliers} />
    </PageShell>
  );
}
