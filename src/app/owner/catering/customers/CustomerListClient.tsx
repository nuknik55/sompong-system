"use client";

import { useState } from "react";
import type { CateringCustomerListItem } from "../actions";
import { thDate } from "../shared-utils";
import { RowLink } from "@/components/ui/row-link";
import { TH_ROW } from "@/components/ui/table";

export function CustomerListClient({ customers }: { customers: CateringCustomerListItem[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q === ""
    ? customers
    : customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q));

  return (
    <div className="space-y-4">
      <input
        type="text"
        placeholder="ค้นหาชื่อ หรือ เบอร์โทร"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full max-w-sm rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-neutral-500"
      />

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className={TH_ROW}>
              <th className="px-3 py-2">ชื่อ</th>
              <th className="px-3 py-2">เบอร์โทร</th>
              <th className="px-3 py-2">บริษัท</th>
              <th className="px-3 py-2 text-center whitespace-nowrap">จำนวนงาน</th>
              <th className="px-3 py-2 whitespace-nowrap">งานล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-neutral-500">ไม่พบลูกค้า</td>
              </tr>
            )}
            {filtered.map((c, i) => (
              // The whole row opens the customer (no link inside it: one tab stop per row).
              <RowLink key={c.id} href={`/owner/catering/customers/${c.id}`} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                <td className="px-3 py-2 font-medium whitespace-nowrap text-neutral-900">{c.name}</td>
                <td className="px-3 py-2 text-neutral-600 tabular-nums">{c.phone ?? "–"}</td>
                <td className="px-3 py-2 whitespace-nowrap text-neutral-600">{c.company_name ?? "–"}</td>
                <td className="px-3 py-2 text-center tabular-nums text-neutral-600">{c.event_count}</td>
                <td className="px-3 py-2 whitespace-nowrap text-neutral-600">{c.last_event_date ? thDate(c.last_event_date) : "–"}</td>
              </RowLink>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
