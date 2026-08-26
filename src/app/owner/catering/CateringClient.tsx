"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { upsertCateringEvent, deleteCateringEvent } from "./actions";
import type { CateringEvent, CateringCustomer, StaffOption } from "./actions";
import {
  MONTHS_TH, BOOKING_TYPE_LABEL, FOOD_FORMAT_LABEL,
  thDate, timeRange, staffLabel, locationLabel, formToUpsertPayload,
  StatusBadge, EventFormModal,
} from "./shared";
import type { FormState } from "./shared";

export function CateringClient({
  initialEvents,
  customers,
  staffOptions,
  year,
  month,
  view,
  defaultStaffId,
}: {
  initialEvents: CateringEvent[];
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  year: number;
  month: number;
  view: "month" | "year";
  /** The current user's linked employee, pre-selected on new bookings only. */
  defaultStaffId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CateringEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staffById = new Map(staffOptions.map((s) => [s.id, s]));

  function goMonth(delta: number) {
    let y = year, m = month + delta;
    if (m > 12) { y++; m = 1; }
    if (m < 1)  { y--; m = 12; }
    router.push(`/owner/catering?year=${y}&month=${m}`);
  }

  function goYear(delta: number) {
    router.push(`/owner/catering?year=${year + delta}&view=year`);
  }

  function switchView(next: "month" | "year") {
    if (next === view) return;
    router.push(next === "year" ? `/owner/catering?year=${year}&view=year` : `/owner/catering?year=${year}&month=${month}`);
  }

  // Reused verbatim so both view modes render identical row markup — only
  // the grouping/nav around this loop differs (see the table body below).
  type RowItem =
    | { kind: "header"; label: string; count: number }
    | { kind: "event"; event: CateringEvent; zebra: number };

  const rows: RowItem[] = (() => {
    if (view !== "year") return initialEvents.map((e, i) => ({ kind: "event" as const, event: e, zebra: i }));
    const byMonth = new Map<number, CateringEvent[]>();
    for (const e of initialEvents) {
      const m = parseInt(e.event_date.slice(5, 7), 10);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m)!.push(e);
    }
    const out: RowItem[] = [];
    for (const [m, evs] of [...byMonth.entries()].sort(([a], [b]) => a - b)) {
      out.push({ kind: "header", label: `${MONTHS_TH[m - 1]} ${year + 543}`, count: evs.length });
      evs.forEach((e, i) => out.push({ kind: "event", event: e, zebra: i }));
    }
    return out;
  })();

  function openNew() { setError(null); setShowForm(true); }
  function closeForm() { setShowForm(false); setError(null); }

  function handleSave(form: FormState) {
    setError(null);
    startTransition(async () => {
      try {
        await upsertCateringEvent(formToUpsertPayload(form));
        closeForm();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function handleDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    startTransition(async () => {
      try {
        await deleteCateringEvent(id);
        setConfirmDelete(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      {/* Header: h1 LEFT, view toggle + nav RIGHT — matches InventoryListClient.tsx's
          title/description-left, control-right shape. Toggle styling mirrors
          ToggleGroup's active/inactive classes (shared.tsx) for visual
          consistency with the rest of the module's toggle affordances. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-kanit text-xl font-semibold text-neutral-900">จองงานจัดเลี้ยง</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1">
            <button
              onClick={() => switchView("month")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "month" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              เดือน
            </button>
            <button
              onClick={() => switchView("year")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "year" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              ปี
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => (view === "year" ? goYear(-1) : goMonth(-1))} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">←</button>
            <span className="min-w-[150px] text-center text-sm font-medium">
              {view === "year" ? year + 543 : `${MONTHS_TH[month - 1]} ${year + 543}`}
            </span>
            <button onClick={() => (view === "year" ? goYear(1) : goMonth(1))} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">→</button>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={openNew} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          + บันทึกการจอง
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-800 text-left text-xs text-neutral-100">
              <th className="px-3 py-2 whitespace-nowrap">วันที่</th>
              <th className="px-3 py-2 whitespace-nowrap">เวลา</th>
              <th className="px-3 py-2">ลูกค้า</th>
              <th className="px-3 py-2">สถานที่</th>
              <th className="px-3 py-2">ประเภท</th>
              <th className="px-3 py-2">อาหาร</th>
              <th className="px-3 py-2 text-center">โต๊ะ</th>
              <th className="px-3 py-2 text-center">แขก</th>
              <th className="px-3 py-2">สถานะ</th>
              <th className="px-3 py-2">ผู้รับผิดชอบงาน</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {initialEvents.length === 0 && (
              <tr>
                <td colSpan={11} className="py-10 text-center text-neutral-400">
                  {view === "year" ? "ไม่มีการจองในปีนี้" : "ไม่มีการจองในเดือนนี้"}
                </td>
              </tr>
            )}
            {rows.map((r, i) =>
              r.kind === "header" ? (
                // Month-group separator in ปี view — same bg/text treatment
                // as the table's own <thead>, so it reads as a real section
                // break while scrolling, not just a thin divider line.
                <tr key={`h-${i}`}>
                  <td colSpan={11} className="border-b border-neutral-700 bg-neutral-800 px-3 py-2 text-sm font-semibold text-neutral-100">
                    {r.label} <span className="font-normal text-neutral-400">({r.count})</span>
                  </td>
                </tr>
              ) : (
                <tr key={r.event.id} className={`border-b border-neutral-100 last:border-0 ${r.zebra % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-700">{thDate(r.event.event_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600 tabular-nums">{timeRange(r.event.start_time, r.event.end_time)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-900">{r.event.customer_name ?? "–"}</div>
                    {r.event.customer_phone && <div className="text-xs text-neutral-400 tabular-nums">{r.event.customer_phone}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{locationLabel(r.event)}</td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{BOOKING_TYPE_LABEL[r.event.booking_type] ?? r.event.booking_type}</td>
                  <td className="px-3 py-2 text-xs text-neutral-600">{r.event.food_format ? FOOD_FORMAT_LABEL[r.event.food_format] ?? r.event.food_format : "–"}</td>
                  <td className="px-3 py-2 text-center text-xs tabular-nums text-neutral-600">
                    {r.event.table_count ?? (r.event.table_label ? "" : "–")}
                    {r.event.reserve_tables ? <span className="text-neutral-400"> +{r.event.reserve_tables}</span> : null}
                    {r.event.table_label && <div className="text-[10px] text-neutral-400">{r.event.table_label}</div>}
                  </td>
                  <td className="px-3 py-2 text-center text-xs tabular-nums text-neutral-600">{r.event.guest_count ?? "–"}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.event.status} /></td>
                  <td className="px-3 py-2 text-xs text-neutral-600">
                    {r.event.staff_ids.length === 0
                      ? "–"
                      : r.event.staff_ids.map((id) => {
                          const s = staffById.get(id);
                          return s ? staffLabel(s) : "?";
                        }).join(", ")}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/owner/catering/${r.event.id}`} className="text-xs text-blue-600 hover:underline">ดู</Link>
                    <button onClick={() => setConfirmDelete(r.event)} className="ml-2 text-xs text-neutral-400 hover:text-red-600">ลบ</button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {error && !showForm && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {/* Form modal — create only; editing happens on the event detail page */}
      {showForm && (
        <EventFormModal
          initial={null}
          customers={customers}
          staffOptions={staffOptions}
          isPending={isPending}
          error={error}
          onSave={handleSave}
          onCancel={closeForm}
          defaultStaffId={defaultStaffId}
        />
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 font-kanit text-base font-semibold text-neutral-900">ลบการจอง?</h3>
            <p className="mb-4 text-sm text-neutral-500">
              {confirmDelete.customer_name ?? "ไม่ระบุลูกค้า"} · {thDate(confirmDelete.event_date)}
              <br />
              ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">
                ยกเลิก
              </button>
              <button onClick={handleDelete} disabled={isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {isPending ? "กำลังลบ…" : "ลบถาวร"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .input-base { width: 100%; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; font-size: 0.875rem; outline: none; background: white; }
        .input-base:focus { border-color: #6b7280; box-shadow: 0 0 0 2px rgba(107,114,128,0.15); }
      `}</style>
    </>
  );
}
