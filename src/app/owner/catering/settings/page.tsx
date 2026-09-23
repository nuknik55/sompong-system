export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getAllCateringRates, getAllCateringEventTypes, getCateringEventTypeUsage } from "../actions";
import { RatesSettingsClient } from "./RatesSettingsClient";
import { EventTypesSettingsClient } from "./EventTypesSettingsClient";
import { CateringSubNav } from "@/components/catering-sub-nav";
import { Tabs } from "@/components/tabs";
import { PageHeader, PageShell } from "@/components/ui/page";

// Two editable lists, one page. ประเภทงาน joined the rates here on 2026-09-15
// rather than taking a fifth sub-nav item: the sub-nav was deliberately cut
// from seven items to four because "staff book on paper because the module had
// too many places to go" (see catering-sub-nav.tsx), and a new route would
// have walked that back for a list of five words. The nav item is now ตั้งค่า
// and the h1 matches, since neither is only about prices any more.

export default async function CateringSettingsPage() {
  await requireAdmin();
  const [rates, eventTypes, eventTypeUsage] = await Promise.all([
    getAllCateringRates(),
    getAllCateringEventTypes(),
    getCateringEventTypeUsage(),
  ]);

  return (
    <PageShell>
      <CateringSubNav isAdmin={true} />

      <PageHeader title="ตั้งค่าจัดเลี้ยง" />

      <Tabs
        tabs={[
          { label: "อัตราค่าบริการ", content: <RatesSettingsClient rates={rates} /> },
          { label: `ประเภทงาน (${eventTypes.length})`, content: <EventTypesSettingsClient types={eventTypes} usage={eventTypeUsage} /> },
        ]}
      />
    </PageShell>
  );
}
