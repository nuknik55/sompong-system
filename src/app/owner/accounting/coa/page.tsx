export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getAllCoa } from "../actions";
import { CoaManagerClient } from "./CoaManagerClient";
import { PageHeader, PageShell } from "@/components/ui/page";

export default async function CoaPage() {
  await requireAdmin();
  const coa = await getAllCoa();

  return (
    <PageShell>
      <PageHeader back={{ href: "/owner/accounting", label: "ดูทั้งเดือน", reload: true }} title="จัดการหมวดบัญชี" />

      <CoaManagerClient coa={coa} />
    </PageShell>
  );
}
