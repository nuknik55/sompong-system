"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { upsertCateringEvent, deleteCateringEvent } from "../actions";
import type {
  CateringEvent, CateringCustomer, StaffOption, CateringCharge, CateringRate,
  CateringEventMenu, CateringSetMenuOption, CateringDishOption, TaskCompletion, CateringActivityLogEntry,
} from "../actions";
import {
  VENUE_LABEL, ROOM_PORTION_LABEL, BOOKING_TYPE_LABEL, FOOD_FORMAT_LABEL, MUSIC_TYPE_LABEL,
  thFullDate, timeRange, staffLabel, formToUpsertPayload,
  StatusBadge, EventForm,
} from "../shared";
import type { FormState } from "../shared";
import { ChargesSection } from "./ChargesSection";
import { EventMenusSection } from "./EventMenusSection";
import { TaskChecklistSection } from "./TaskChecklistSection";
import { ActivityLogSection } from "./ActivityLogSection";

export function EventDetailClient({
  event,
  customers,
  staffOptions,
  charges,
  rates,
  eventMenus,
  setMenuOptions,
  dishOptions,
  taskCompletions,
  activityLog,
}: {
  event: CateringEvent;
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  charges: CateringCharge[];
  rates: CateringRate[];
  eventMenus: CateringEventMenu[];
  setMenuOptions: CateringSetMenuOption[];
  dishOptions: CateringDishOption[];
  taskCompletions: TaskCompletion[];
  activityLog: CateringActivityLogEntry[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staffById = new Map(staffOptions.map((s) => [s.id, s]));

  function handleSave(form: FormState) {
    setError(null);
    startTransition(async () => {
      try {
        await upsertCateringEvent(formToUpsertPayload(form, event.id));
        setIsEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteCateringEvent(event.id);
        router.push("/owner/catering");
      } catch (err) {
        setError(err instanceof Error ? err.message : "ลบไม่สำเร็จ");
        setConfirmDelete(false);
      }
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => router.back()} className="text-sm text-neutral-500 hover:text-neutral-800">
          ← กลับ
        </button>
        <div className="flex gap-2">
          {!isEditing && (
            <button onClick={() => setIsEditing(true)} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
              แก้ไข
            </button>
          )}
          <button onClick={() => setConfirmDelete(true)} className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
            ลบ
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="rounded-xl border border-neutral-200 bg-white">
          <EventForm
            initial={event}
            customers={customers}
            staffOptions={staffOptions}
            isPending={isPending}
            error={error}
            onSave={handleSave}
            onCancel={() => { setIsEditing(false); setError(null); }}
          />
        </div>
      ) : (
      <div className="space-y-5 rounded-xl border border-neutral-200 bg-white p-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-4">
          <div>
            <h2 className="font-kanit text-lg font-semibold text-neutral-900">
              {event.customer_id ? (
                <Link href={`/owner/catering/customers/${event.customer_id}`} className="hover:underline">
                  {event.customer_name ?? "ไม่ระบุลูกค้า"}
                </Link>
              ) : (
                event.customer_name ?? "ไม่ระบุลูกค้า"
              )}
            </h2>
            <p className="text-sm text-neutral-500">
              {event.customer_phone ?? "–"}
              {event.customer_company_name ? ` · ${event.customer_company_name}` : ""}
            </p>
          </div>
          <div className="text-right">
            <StatusBadge status={event.status} />
            <p className="mt-1 text-sm text-neutral-600">{thFullDate(event.event_date)}</p>
            <p className="text-xs text-neutral-400 tabular-nums">{timeRange(event.start_time, event.end_time)}</p>
          </div>
        </div>

        {/* Location */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">สถานที่</h3>
          {event.location_type === "in_house" ? (
            <p className="text-sm text-neutral-700">
              {event.venue ? VENUE_LABEL[event.venue] ?? event.venue : "–"}
              {event.room_portion && ` (${ROOM_PORTION_LABEL[event.room_portion]})`}
            </p>
          ) : (
            <div className="text-sm text-neutral-700">
              <p>{event.offsite_address || "ยังไม่ระบุที่อยู่"}</p>
              {(event.offsite_distance_km != null || event.floor_level != null) && (
                <p className="text-xs text-neutral-400">
                  {event.offsite_distance_km != null && `ระยะทาง ${event.offsite_distance_km} กม.`}
                  {event.offsite_distance_km != null && event.floor_level != null && " · "}
                  {event.floor_level != null && `ชั้น ${event.floor_level}`}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Event details */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-neutral-400">ประเภทการจอง</p>
            <p className="text-sm text-neutral-700">{BOOKING_TYPE_LABEL[event.booking_type] ?? event.booking_type}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-400">รูปแบบอาหาร</p>
            <p className="text-sm text-neutral-700">{event.food_format ? FOOD_FORMAT_LABEL[event.food_format] ?? event.food_format : "–"}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-400">โต๊ะ / แขก</p>
            <p className="text-sm tabular-nums text-neutral-700">
              {event.table_count ?? "–"}{event.reserve_tables ? ` (+${event.reserve_tables})` : ""} โต๊ะ · {event.guest_count ?? "–"} คน
            </p>
            {event.table_label && <p className="text-xs text-neutral-400">{event.table_label}</p>}
          </div>
          <div>
            <p className="text-xs text-neutral-400">ดนตรี</p>
            <p className="text-sm text-neutral-700">{MUSIC_TYPE_LABEL[event.music_type] ?? event.music_type}</p>
            {event.music_note && <p className="text-xs text-neutral-400">{event.music_note}</p>}
          </div>
        </section>

        {/* Staff */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">ผู้รับผิดชอบงาน</h3>
          <p className="text-sm text-neutral-700">
            {event.staff_ids.length === 0
              ? "–"
              : event.staff_ids.map((id) => {
                  const s = staffById.get(id);
                  return s ? staffLabel(s) : "?";
                }).join(", ")}
          </p>
        </section>

        {/* Notes */}
        <section className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">รายละเอียดเพิ่มเติม</h3>
            <p className="whitespace-pre-wrap text-sm text-neutral-700">{event.detail_note || "–"}</p>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">แจ้งครัว</h3>
            <p className="whitespace-pre-wrap text-sm text-neutral-700">{event.kitchen_note || "–"}</p>
          </div>
        </section>

        {/* Footer */}
        <div className="border-t border-neutral-100 pt-3 text-xs text-neutral-400">
          จองโดย {event.created_by_name ?? "ไม่ทราบ"}
        </div>
      </div>
      )}

      <div className="mt-5">
        <EventMenusSection eventId={event.id} initialMenus={eventMenus} setMenuOptions={setMenuOptions} dishOptions={dishOptions} />
      </div>

      <div className="mt-5">
        <ChargesSection event={event} initialCharges={charges} rates={rates} />
      </div>

      <div className="mt-5">
        <TaskChecklistSection event={event} initialCompletions={taskCompletions} />
      </div>

      <div className="mt-5">
        <ActivityLogSection entries={activityLog} />
      </div>

      {error && !isEditing && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 font-kanit text-base font-semibold text-neutral-900">ลบการจอง?</h3>
            <p className="mb-4 text-sm text-neutral-500">
              {event.customer_name ?? "ไม่ระบุลูกค้า"} · {thFullDate(event.event_date)}
              <br />
              ข้อมูลจะถูกลบถาวร ไม่สามารถกู้คืนได้
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-4 py-2 text-sm hover:bg-neutral-100">
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
