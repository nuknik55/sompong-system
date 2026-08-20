export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getAllCateringRates } from "../actions";
import { RatesSettingsClient } from "./RatesSettingsClient";

export default async function CateringSettingsPage() {
  await requireAdmin();
  const rates = await getAllCateringRates();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/owner/catering" className="text-sm text-neutral-400 hover:text-neutral-700">← จองงานจัดเลี้ยง</Link>
        <span className="text-sm text-neutral-300">/</span>
        <h1 className="font-kanit text-lg font-semibold text-neutral-900">อัตราค่าบริการจัดเลี้ยง</h1>
      </div>
      <RatesSettingsClient initialRates={rates} />
    </div>
  );
}
