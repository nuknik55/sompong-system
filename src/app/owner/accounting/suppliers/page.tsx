export const dynamic = "force-dynamic";

import { requireAdmin } from "@/lib/auth";
import { getAllSuppliers } from "../actions";
import { SuppliersClient } from "./SuppliersClient";

export default async function SuppliersPage() {
  await requireAdmin();
  const suppliers = await getAllSuppliers();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <a href="/owner/accounting" className="text-sm text-neutral-400 hover:text-neutral-700">← บัญชี</a>
          <span className="text-neutral-300 text-sm">/</span>
          <h1 className="font-kanit text-lg font-semibold text-neutral-900">จัดการซัพพลายเออร์</h1>
        </div>
      </div>

      <SuppliersClient initialSuppliers={suppliers} />
    </div>
  );
}
