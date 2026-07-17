export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getAllCoa } from "../actions";
import { CoaManagerClient } from "./CoaManagerClient";

export default async function CoaPage() {
  await requireAdmin();
  const coa = await getAllCoa();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href="/owner/accounting" className="text-sm text-neutral-400 hover:text-neutral-700">← ดูทั้งเดือน</a>
          <span className="text-neutral-300 text-sm">/</span>
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">จัดการหมวดบัญชี</h1>
        </div>
      </div>

      <CoaManagerClient coa={coa} />
    </div>
  );
}
