"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unstable_rethrow } from "next/navigation";
import { setMonthlyRevenue } from "../actions";

// Six of these are written by the POS import; "other" is compiled by the
// accountants and hand-entered. Once a month has been imported the six are
// read-only here, because a hand edit would survive only until the next
// import run and nothing on screen would say so.
const REVENUE_TYPES = [
  { key: "food" as const, label: "อาหาร", imported: true },
  { key: "drink" as const, label: "เครื่องดื่ม", imported: true },
  { key: "dessert" as const, label: "ของหวาน", imported: true },
  { key: "delivery" as const, label: "เดลิเวอรี่", imported: true },
  { key: "souvenir" as const, label: "ของฝาก", imported: true },
  { key: "pos_other" as const, label: "อื่นๆ (POS)", imported: true },
  { key: "other" as const, label: "อื่นๆ (บัญชี)", imported: false },
];

export function RevenueEntryClient({
  yearMonth,
  initialRevenue,
  importedAt,
}: {
  yearMonth: string;
  initialRevenue: Record<string, number>;
  /** ISO timestamp when this month was imported from POS, or null. */
  importedAt: string | null;
}) {
  const locked = importedAt !== null;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      REVENUE_TYPES.map((t) => [t.key, initialRevenue[t.key] ? String(initialRevenue[t.key]) : ""])
    )
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = REVENUE_TYPES.reduce((s, t) => {
    const v = parseFloat(values[t.key]?.replace(/,/g, "") ?? "");
    return s + (isNaN(v) ? 0 : v);
  }, 0);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        for (const t of REVENUE_TYPES) {
          // A locked type is not sent at all. Skipping the write rather than
          // only disabling the input means a stale value in component state
          // cannot overwrite an imported figure.
          if (locked && t.imported) continue;
          const raw = values[t.key]?.replace(/,/g, "") ?? "";
          const num = raw === "" ? 0 : parseFloat(raw);
          if (!isNaN(num)) {
            await setMonthlyRevenue(yearMonth, t.key, num);
          }
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        router.refresh();
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-neutral-700">รายได้เดือนนี้</p>
        {locked ? (
          <span className="text-xs text-neutral-500">
            นำเข้าจาก POS แล้วเมื่อ {new Date(importedAt).toLocaleString("th-TH")} —{" "}
            <a href="/owner/accounting/revenue-import" className="underline hover:text-neutral-800">
              แก้ที่หน้านำเข้ารายได้
            </a>
          </span>
        ) : (
          <span className="text-xs text-neutral-400">กรอกยอดขายแยกประเภท</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {REVENUE_TYPES.map((t) => {
          const readOnly = locked && t.imported;
          return (
            <div key={t.key}>
              <label className="mb-1 block text-xs text-neutral-500">{t.label}</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                value={values[t.key]}
                readOnly={readOnly}
                title={readOnly ? "มาจากการนำเข้า POS — แก้ที่หน้านำเข้ารายได้" : undefined}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [t.key]: e.target.value.replace(/[^0-9.]/g, ""),
                  }))
                }
                className={`w-full rounded-md border px-2 py-1.5 text-sm tabular-nums ${
                  readOnly
                    ? "border-neutral-200 bg-neutral-100 text-neutral-500"
                    : "border-neutral-300"
                }`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className="text-sm text-neutral-500">
          รวม:{" "}
          <span className="font-semibold text-neutral-900 tabular-nums">
            {total.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿
          </span>
        </span>
        <div className="flex items-center gap-3">
          {error && <p className="text-xs text-red-600">{error}</p>}
          {saved && <p className="text-xs text-green-600">บันทึกแล้ว ✓</p>}
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-brand-green px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-green/90 disabled:opacity-50"
          >
            {isPending ? "กำลังบันทึก..." : "บันทึกรายได้"}
          </button>
        </div>
      </div>
    </div>
  );
}
