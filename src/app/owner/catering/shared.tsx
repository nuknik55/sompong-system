"use client";

// Shared between the list page (create-only modal) and the event detail page
// (edit modal) — both need the exact same form. Only the interactive pieces
// live here (hooks, event handlers, browser-only APIs) — plain constants,
// formatters, and non-interactive components moved to shared-utils.tsx so
// they stay callable from server components. See shared-utils.tsx's header
// comment for why that split exists.

import { useState, useRef, useEffect } from "react";
import { getRoomConflictCandidates } from "./actions";
import type { CateringEvent, CateringCustomer, StaffOption } from "./actions";
import { ROOM_CONFLICTS, findRoomConflict } from "./conflict";
import type { RoomConflictCandidate } from "./conflict";
import {
  LOCATION_TYPE_OPTIONS, VENUE_OPTIONS, ROOM_PORTION_OPTIONS, BOOKING_TYPE_OPTIONS,
  FOOD_FORMAT_OPTIONS, MUSIC_TYPE_OPTIONS, STATUS_OPTIONS, VENUE_LABEL,
  staffLabel, conflictTimeLabel, blankForm, formFromEvent, Field,
} from "./shared-utils";
import type { FormState } from "./shared-utils";

// ─── Sub-components (module level on purpose) ─────────────────────────────────
// Declaring these inside a page component would give them a new function
// identity on every render, so React would remount them instead of updating —
// which destroys input DOM nodes and resets the caret on every keystroke.

/** Toggle-button group shared by location_type / room_portion / music_type. */
function ToggleGroup({
  options,
  value,
  onPick,
}: {
  options: { value: string; label: string }[];
  value: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.value
              ? "border-neutral-900 bg-neutral-900 text-white"
              : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const timeSelectCls = "rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-500/15";

/**
 * Native <input type="time"> renders per the browser/OS locale, not the
 * page's <html lang>, so it can still show a 12-hour AM/PM picker even with
 * lang="th" set (confirmed in the field on at least one device/browser).
 * This controls the hour/minute segments directly instead of delegating to
 * the native widget, so the display is always 24-hour everywhere. Value
 * format matches what the native input produced ("" or "HH:MM"), so nothing
 * downstream (FormState, formToUpsertPayload, findRoomConflict, …) changes.
 */
function Time24Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = value ? value.split(":") : ["", ""];

  function setHour(hh: string) {
    onChange(hh === "" && m === "" ? "" : `${hh || "00"}:${m || "00"}`);
  }
  function setMinute(mm: string) {
    onChange(h === "" && mm === "" ? "" : `${h || "00"}:${mm || "00"}`);
  }

  return (
    <div className="flex items-center gap-1">
      <select className={timeSelectCls} value={h} onChange={(e) => setHour(e.target.value)}>
        <option value="">--</option>
        {HOURS.map((hh) => <option key={hh} value={hh}>{hh}</option>)}
      </select>
      <span className="text-neutral-400">:</span>
      <select className={timeSelectCls} value={m} onChange={(e) => setMinute(e.target.value)}>
        <option value="">--</option>
        {MINUTES.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
      </select>
      {value && (
        <button type="button" onClick={() => onChange("")} title="ล้างเวลา" className="text-xs text-neutral-400 hover:text-neutral-700">
          ✕
        </button>
      )}
    </div>
  );
}

export function CustomerCombobox({
  customers,
  customerId,
  query,
  onPick,
  onQueryChange,
}: {
  customers: CateringCustomer[];
  customerId: string | null;
  query: string;
  onPick: (c: CateringCustomer | null) => void;
  onQueryChange: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocDown(ev: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = q === ""
    ? customers.slice(0, 8)
    : customers
        .filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q))
        .slice(0, 8);

  return (
    <div ref={boxRef} className="relative">
      <input
        type="text"
        className="input-base"
        placeholder="พิมพ์ชื่อ หรือ เบอร์โทร"
        value={query}
        onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {customerId && (
        <button
          type="button"
          onClick={() => { onPick(null); onQueryChange(""); setOpen(false); }}
          className="absolute right-2 top-1.5 text-xs text-neutral-400 hover:text-neutral-700"
        >
          ล้าง
        </button>
      )}
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => { onPick(c); onQueryChange(c.name); setOpen(false); }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-neutral-50 ${c.id === customerId ? "bg-blue-50" : ""}`}
              >
                <span className="text-neutral-800">
                  {c.name}
                  {c.company_name && <span className="ml-1 text-xs text-neutral-400">{c.company_name}</span>}
                </span>
                <span className="text-xs text-neutral-400">{c.phone ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StaffMultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: StaffOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  // Offer active staff only, but keep showing anyone already assigned even if
  // they have since left — otherwise they would be stuck on the event with no
  // way to see or remove them.
  const visible = options.filter((s) => s.is_active || selected.includes(s.id));

  return (
    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-neutral-200 p-2">
      {visible.length === 0 && <span className="text-xs text-neutral-400">ไม่มีรายชื่อพนักงาน</span>}
      {visible.map((s) => {
        const on = selected.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggle(s.id)}
            title={s.is_active ? undefined : "พนักงานคนนี้ไม่ได้ทำงานแล้ว"}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              on
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {staffLabel(s)}
            {!s.is_active && <span className="ml-1 opacity-60">(ลาออก)</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The form fields + footer (cancel/save), with no outer chrome — used both
 * inside EventFormModal's backdrop+panel (create flow, and historically the
 * edit flow) and rendered directly inline on the event detail page (current
 * edit flow — see EventDetailClient.tsx). Returns two siblings (fields,
 * then footer) so EventFormModal can host them inside one scrolling panel
 * with a sticky footer exactly as before; inline on a full page "sticky"
 * simply has no scrolling ancestor to stick to, so it degrades to a normal
 * block — no separate inline-specific layout needed.
 */
export function EventForm({
  initial,
  customers,
  staffOptions,
  isPending,
  error,
  onSave,
  onCancel,
  defaultStaffId,
}: {
  initial: CateringEvent | null;
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  isPending: boolean;
  error: string | null;
  onSave: (form: FormState) => void;
  onCancel: () => void;
  /** Ignored when `initial` is set — only new bookings get a pre-selected owner. */
  defaultStaffId?: string | null;
}) {
  const [form, setForm] = useState<FormState>(() => (initial ? formFromEvent(initial) : blankForm(defaultStaffId)));

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const isNewCustomer = form.customerId === null && form.customerQuery.trim() !== "";
  const roomPortionApplies = form.location_type === "in_house" && (form.venue === "room_v1" || form.venue === "room_v2");

  // Room-conflict check — rule lives in conflict.ts, shared with the
  // server-side enforcement in upsertCateringEvent. A conflict hard-blocks
  // saving (see canSave below); the same rule is re-checked server-side so
  // two people racing to save around the same time can't both slip past
  // this client-side check.
  const excludeId = initial?.id ?? null;
  const isRoomConflictEligible = form.location_type === "in_house" && !!ROOM_CONFLICTS[form.venue];
  const [conflictCandidates, setConflictCandidates] = useState<RoomConflictCandidate[]>([]);

  useEffect(() => {
    if (!isRoomConflictEligible || !form.event_date) {
      setConflictCandidates([]);
      return;
    }
    let cancelled = false;
    // Small debounce — event_date/venue can each change a couple of times in
    // quick succession while the form settles (e.g. picking a date, then
    // switching venue right after).
    const timer = setTimeout(() => {
      getRoomConflictCandidates(form.event_date, excludeId)
        .then((rows) => { if (!cancelled) setConflictCandidates(rows); })
        .catch(() => { if (!cancelled) setConflictCandidates([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [form.event_date, excludeId, isRoomConflictEligible]);

  const conflict = isRoomConflictEligible
    ? findRoomConflict(form.venue, form.start_time, form.end_time, conflictCandidates)
    : null;

  const canSave = form.event_date !== "" && form.customerQuery.trim() !== "" && !isPending && !conflict;

  return (
    <>
      <div className="space-y-4 px-5 py-4">
          {/* Customer */}
          <Field label="ลูกค้า *">
            <CustomerCombobox
              customers={customers}
              customerId={form.customerId}
              query={form.customerQuery}
              onPick={(c) => {
                set("customerId", c?.id ?? null);
                setForm((f) => ({
                  ...f,
                  customerId: c?.id ?? null,
                  customerAddress: c?.address ?? "",
                  customerContactPerson: c?.contact_person ?? "",
                }));
              }}
              onQueryChange={(t) => setForm((f) => ({ ...f, customerQuery: t, customerId: null }))}
            />
          </Field>

          {isNewCustomer && (
            <div className="rounded-lg border border-green-200 bg-green-50/60 p-3">
              <p className="mb-2 text-xs font-medium text-green-800">
                ลูกค้าใหม่ — จะถูกสร้างเมื่อกดบันทึก: &quot;{form.customerQuery.trim()}&quot;
              </p>
              <div className="mb-2 grid grid-cols-3 gap-2">
                <Field label="เบอร์โทร">
                  <input className="input-base" value={form.newPhone}
                    onChange={(e) => set("newPhone", e.target.value)} />
                </Field>
                <Field label="LINE ID">
                  <input className="input-base" value={form.newLineId}
                    onChange={(e) => set("newLineId", e.target.value)} />
                </Field>
                <Field label="บริษัท">
                  <input className="input-base" value={form.newCompany}
                    onChange={(e) => set("newCompany", e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="ที่อยู่">
                  <input className="input-base" value={form.customerAddress}
                    onChange={(e) => set("customerAddress", e.target.value)} />
                </Field>
                <Field label="ผู้ติดต่อ (ถ้าต่างจากชื่อ)">
                  <input className="input-base" value={form.customerContactPerson}
                    onChange={(e) => set("customerContactPerson", e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {!isNewCustomer && form.customerId && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="ที่อยู่ลูกค้า">
                <input className="input-base" value={form.customerAddress}
                  onChange={(e) => set("customerAddress", e.target.value)} />
              </Field>
              <Field label="ผู้ติดต่อ (ถ้าต่างจากชื่อ)">
                <input className="input-base" value={form.customerContactPerson}
                  onChange={(e) => set("customerContactPerson", e.target.value)} />
              </Field>
            </div>
          )}

          {/* Date + time */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="วันที่จัดงาน *">
              <input type="date" className="input-base" value={form.event_date}
                onChange={(e) => set("event_date", e.target.value)} />
            </Field>
            <Field label="เวลาเริ่ม">
              <Time24Input value={form.start_time} onChange={(v) => set("start_time", v)} />
            </Field>
            <Field label="เวลาสิ้นสุด">
              <Time24Input value={form.end_time} onChange={(v) => set("end_time", v)} />
            </Field>
          </div>

          {/* Location — asked first, in-house and offsite are different shapes */}
          <Field label="สถานที่ *">
            <ToggleGroup
              options={LOCATION_TYPE_OPTIONS}
              value={form.location_type}
              onPick={(v) =>
                setForm((f) => ({
                  ...f,
                  location_type: v,
                  // venue can be blank after loading an offsite event — fall back
                  // to a valid default rather than saving an empty venue.
                  venue: v === "in_house" && f.venue === "" ? "room_v2" : f.venue,
                }))
              }
            />
          </Field>

          {form.location_type === "in_house" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="ห้อง *">
                <select className="input-base" value={form.venue} onChange={(e) => set("venue", e.target.value)}>
                  {VENUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              {roomPortionApplies && (
                <Field label="สัดส่วนห้อง">
                  <ToggleGroup options={ROOM_PORTION_OPTIONS} value={form.room_portion} onPick={(v) => set("room_portion", v)} />
                </Field>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Field label="ที่อยู่นอกสถานที่" className="col-span-3">
                <input className="input-base" value={form.offsite_address}
                  onChange={(e) => set("offsite_address", e.target.value)} />
              </Field>
              <Field label="ระยะทาง (กม.)">
                <input type="number" min={0} className="input-base" value={form.offsite_distance_km}
                  onChange={(e) => set("offsite_distance_km", e.target.value)} />
              </Field>
              <Field label="ชั้น">
                <input type="number" min={0} className="input-base" value={form.floor_level}
                  onChange={(e) => set("floor_level", e.target.value)} />
              </Field>
            </div>
          )}

          {conflict && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              <p className="font-medium">⚠ ไม่สามารถบันทึกได้ — ห้องชนกับการจองอื่น</p>
              <p>{conflict.customer_name ?? "-"} ({VENUE_LABEL[conflict.venue] ?? conflict.venue}, {conflictTimeLabel(conflict.start_time, conflict.end_time)})</p>
            </div>
          )}

          {/* Type / format */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="ประเภทการจอง *">
              <select className="input-base" value={form.booking_type} onChange={(e) => set("booking_type", e.target.value)}>
                {BOOKING_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="รูปแบบอาหาร">
              <select className="input-base" value={form.food_format} onChange={(e) => set("food_format", e.target.value)}>
                <option value="">– ไม่ระบุ –</option>
                {FOOD_FORMAT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
          </div>

          {/* Counts */}
          <div className="grid grid-cols-4 gap-3">
            <Field label="จำนวนโต๊ะ">
              <input type="number" min={0} className="input-base" value={form.table_count}
                onChange={(e) => set("table_count", e.target.value)} />
            </Field>
            <Field label="โต๊ะสำรอง">
              <input type="number" min={0} className="input-base" value={form.reserve_tables}
                onChange={(e) => set("reserve_tables", e.target.value)} />
            </Field>
            <Field label="เลขโต๊ะ / หมายเหตุโต๊ะ">
              <input className="input-base" placeholder="T61, เต็มห้อง" value={form.table_label}
                onChange={(e) => set("table_label", e.target.value)} />
            </Field>
            <Field label="จำนวนแขก">
              <input type="number" min={0} className="input-base" value={form.guest_count}
                onChange={(e) => set("guest_count", e.target.value)} />
            </Field>
          </div>

          {/* Music */}
          <Field label="ดนตรี">
            <ToggleGroup options={MUSIC_TYPE_OPTIONS} value={form.music_type} onPick={(v) => set("music_type", v)} />
          </Field>
          <Field label="รายละเอียดดนตรี">
            <input className="input-base" placeholder="ชื่อร้าน, ขนาดวง ฯลฯ" value={form.music_note}
              onChange={(e) => set("music_note", e.target.value)} />
          </Field>

          {/* Status + deposit */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="สถานะ *">
              <select className="input-base" value={form.status} onChange={(e) => set("status", e.target.value)}>
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="เงินมัดจำ (บาท)">
              <input type="number" min={0} className="input-base" value={form.deposit_amount}
                onChange={(e) => set("deposit_amount", e.target.value)} />
            </Field>
            <Field label="วันที่รับมัดจำ">
              <input type="date" className="input-base" value={form.deposit_paid_at}
                onChange={(e) => set("deposit_paid_at", e.target.value)} />
            </Field>
          </div>

          {/* Staff */}
          <Field label="ผู้รับผิดชอบงาน">
            <StaffMultiSelect
              options={staffOptions}
              selected={form.staff_ids}
              onToggle={(id) =>
                setForm((f) => ({
                  ...f,
                  staff_ids: f.staff_ids.includes(id)
                    ? f.staff_ids.filter((x) => x !== id)
                    : [...f.staff_ids, id],
                }))
              }
            />
          </Field>

          {/* Notes */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="รายละเอียดเพิ่มเติม">
              <textarea className="input-base h-20 resize-none" value={form.detail_note}
                onChange={(e) => set("detail_note", e.target.value)} />
            </Field>
            <Field label="แจ้งรายละเอียดให้ครัว">
              <textarea className="input-base h-20 resize-none" value={form.kitchen_note}
                onChange={(e) => set("kitchen_note", e.target.value)} />
            </Field>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-neutral-100 bg-white px-5 py-3">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
          ยกเลิก
        </button>
        <button
          onClick={() => onSave(form)}
          disabled={!canSave}
          className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
      </div>
    </>
  );
}

/** Modal chrome (backdrop, panel, sticky header) around EventForm — the create flow on the list page. */
export function EventFormModal({
  initial,
  customers,
  staffOptions,
  isPending,
  error,
  onSave,
  onCancel,
  defaultStaffId,
}: {
  initial: CateringEvent | null;
  customers: CateringCustomer[];
  staffOptions: StaffOption[];
  isPending: boolean;
  error: string | null;
  onSave: (form: FormState) => void;
  onCancel: () => void;
  defaultStaffId?: string | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-4">
          <h2 className="font-kanit text-base font-semibold">
            {initial ? "แก้ไขการจอง" : "บันทึกการจองใหม่"}
          </h2>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>
        <EventForm
          initial={initial}
          customers={customers}
          staffOptions={staffOptions}
          isPending={isPending}
          error={error}
          onSave={onSave}
          onCancel={onCancel}
          defaultStaffId={defaultStaffId}
        />
      </div>
    </div>
  );
}
