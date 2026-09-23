import { requireOrdering, isAdminOrAbove } from "@/lib/auth";
import { isOrderHead } from "@/lib/order-rules";
import { getOrderSessions, getTemplates } from "@/lib/inventory-data";
import { InventorySubNav } from "@/components/inventory-sub-nav";
import { InventoryListClient } from "./InventoryListClient";
import { PageShell } from "@/components/ui/page";

export default async function InventoryListPage() {
  const [profile, allSessions, templates] = await Promise.all([
    requireOrdering(),
    getOrderSessions(),
    getTemplates(),
  ]);

  const canReview = isOrderHead(profile.role);
  const canSend = isAdminOrAbove(profile.role);

  return (
    <PageShell>
      <InventorySubNav showTemplate={canReview} canReview={canReview} canSend={canSend} />
      <InventoryListClient
        sessions={allSessions}
        currentUserId={profile.id}
        templates={templates}
      />
    </PageShell>
  );
}
