export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getAllCateringRates } from "../actions";
import { RatesSettingsClient } from "./RatesSettingsClient";
import { CateringSubNav } from "@/components/catering-sub-nav";

export default async function CateringSettingsPage() {
  await requireAdmin();
  const rates = await getAllCateringRates();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <CateringSubNav isAdmin={true} />

      <h1 className="font-kanit text-lg font-semibold text-neutral-900">อัตราค่าบริการจัดเลี้ยง</h1>
      <RatesSettingsClient initialRates={rates} />
    </div>
  );
}
