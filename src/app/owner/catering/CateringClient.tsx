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
}: {
  initialEvents: CateringEvent[];
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  year: number;
  month: number;
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
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => goMonth(-1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">←</button>
          <span className="min-w-[150px] text-center text-sm font-medium">
            {MONTHS_TH[month - 1]} {year + 543}
          </span>
          <button onClick={() => goMonth(1)} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">→</button>
        </div>
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
              <th className="px-3 py-2">ผู้รับงาน</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {initialEvents.length === 0 && (
              <tr>
                <td colSpan={11} className="py-10 text-center text-neutral-400">
                  ไม่มีการจองในเดือนนี้
                </td>
              </tr>
            )}
            {initialEvents.map((e, i) => (
              <tr key={e.id} className={`border-b border-neutral-100 last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-neutral-50"}`}>
                <td className="px-3 py-2 whitespace-nowrap text-neutral-700">{thDate(e.event_date)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-neutral-600 tabular-nums">{timeRange(e.start_time, e.end_time)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-neutral-900">{e.customer_name ?? "–"}</div>
                  {e.customer_phone && <div className="text-xs text-neutral-400 tabular-nums">{e.customer_phone}</div>}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-600">{locationLabel(e)}</td>
                <td className="px-3 py-2 text-xs text-neutral-600">{BOOKING_TYPE_LABEL[e.booking_type] ?? e.booking_type}</td>
                <td className="px-3 py-2 text-xs text-neutral-600">{e.food_format ? FOOD_FORMAT_LABEL[e.food_format] ?? e.food_format : "–"}</td>
                <td className="px-3 py-2 text-center text-xs tabular-nums text-neutral-600">
                  {e.table_count ?? (e.table_label ? "" : "–")}
                  {e.reserve_tables ? <span className="text-neutral-400"> +{e.reserve_tables}</span> : null}
                  {e.table_label && <div className="text-[10px] text-neutral-400">{e.table_label}</div>}
                </td>
                <td className="px-3 py-2 text-center text-xs tabular-nums text-neutral-600">{e.guest_count ?? "–"}</td>
                <td className="px-3 py-2"><StatusBadge status={e.status} /></td>
                <td className="px-3 py-2 text-xs text-neutral-600">
                  {e.staff_ids.length === 0
                    ? "–"
                    : e.staff_ids.map((id) => {
                        const s = staffById.get(id);
                        return s ? staffLabel(s) : "?";
                      }).join(", ")}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link href={`/owner/catering/${e.id}`} className="text-xs text-blue-600 hover:underline">แก้ไข</Link>
                  <button onClick={() => setConfirmDelete(e)} className="ml-2 text-xs text-neutral-400 hover:text-red-600">ลบ</button>
                </td>
              </tr>
            ))}
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
