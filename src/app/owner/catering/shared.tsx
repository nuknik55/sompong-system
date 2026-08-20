"use client";

// Shared between the list page (create-only modal) and the event detail page
// (edit modal) — both need the exact same form, options, and helpers.

import { useState, useRef, useEffect } from "react";
import type { CateringEvent, CateringCustomer, StaffOption } from "./actions";

export const MONTHS_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const DAYS_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

// Values mirror the CHECK constraints in supabase/catering_migration.sql +
// supabase/catering_location_migration.sql.
export const LOCATION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "in_house", label: "ภายในร้าน" },
  { value: "offsite",  label: "นอกสถานที่" },
];
// 'offsite' dropped: it is now its own location_type, not a venue.
export const VENUE_OPTIONS: { value: string; label: string }[] = [
  { value: "air_shared", label: "แอร์รวม" },
  { value: "room_v1",    label: "ห้อง V1" },
  { value: "room_v2",    label: "ห้อง V2" },
  { value: "room_v1_v2", label: "ห้อง V1 + V2" },
];
export const ROOM_PORTION_OPTIONS: { value: string; label: string }[] = [
  { value: "half", label: "ครึ่งห้อง" },
  { value: "full", label: "เต็มห้อง" },
];
export const BOOKING_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "table",    label: "จองโต๊ะ" },
  { value: "room",     label: "จองห้อง" },
  { value: "catering", label: "จองงานจัดเลี้ยง" },
];
export const FOOD_FORMAT_OPTIONS: { value: string; label: string }[] = [
  { value: "chinese_table", label: "โต๊ะจีน" },
  { value: "buffet",        label: "บุฟเฟต์" },
  { value: "a_la_carte",    label: "A la carte" },
  { value: "set_menu",      label: "ชุดเมนู" },
  { value: "box_set",       label: "อาหารกล่อง" },
];
export const MUSIC_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "none",         label: "ไม่มี" },
  { value: "karaoke_shop", label: "คาราโอเกะ (ร้าน)" },
  { value: "own_band",     label: "วงดนตรีลูกค้านำมาเอง" },
  { value: "other",        label: "อื่นๆ" },
];
export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "inquiry",          label: "สอบถาม" },
  { value: "awaiting_deposit", label: "รอมัดจำ" },
  { value: "deposit_paid",     label: "มัดจำแล้ว" },
  { value: "confirmed",        label: "คอนเฟิร์มแล้ว" },
  { value: "done",             label: "เสร็จสิ้น" },
  { value: "cancelled",        label: "ยกเลิก" },
];
// Values mirror the CHECK constraint in supabase/catering_migration.sql.
export const CHARGE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "food",      label: "อาหาร" },
  { value: "drink",     label: "เครื่องดื่ม" },
  { value: "venue",     label: "สถานที่" },
  { value: "service",   label: "บริการ" },
  { value: "transport", label: "ขนส่ง" },
  { value: "equipment", label: "อุปกรณ์" },
  { value: "other",     label: "อื่นๆ" },
  { value: "discount",  label: "ส่วนลด" },
];
// Values mirror the CHECK constraint in supabase/catering_quotation_migration.sql.
// Order here is also the group order shown in the rate picker.
export const RATE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "room",        label: "ห้อง/สถานที่" },
  { value: "food_set",    label: "อาหาร/ชุดโต๊ะ" },
  { value: "drink",       label: "เครื่องดื่ม" },
  { value: "delivery",    label: "ค่าขนส่ง" },
  { value: "music",       label: "ดนตรี" },
  { value: "staff_bonus", label: "เบี้ยเลี้ยงพนักงาน" },
  { value: "other",       label: "อื่นๆ" },
];
/** rate_type -> charge_type, applied when a charge row is inserted from the rate picker. */
export const RATE_TYPE_TO_CHARGE_TYPE: Record<string, string> = {
  room: "venue",
  delivery: "transport",
  food_set: "food",
  drink: "drink",
  music: "other",
  staff_bonus: "other",
  other: "other",
};

export const LOCATION_TYPE_LABEL = Object.fromEntries(LOCATION_TYPE_OPTIONS.map((o) => [o.value, o.label]));
export const VENUE_LABEL         = Object.fromEntries(VENUE_OPTIONS.map((o) => [o.value, o.label]));
export const ROOM_PORTION_LABEL  = Object.fromEntries(ROOM_PORTION_OPTIONS.map((o) => [o.value, o.label]));
export const BOOKING_TYPE_LABEL  = Object.fromEntries(BOOKING_TYPE_OPTIONS.map((o) => [o.value, o.label]));
export const FOOD_FORMAT_LABEL   = Object.fromEntries(FOOD_FORMAT_OPTIONS.map((o) => [o.value, o.label]));
export const MUSIC_TYPE_LABEL    = Object.fromEntries(MUSIC_TYPE_OPTIONS.map((o) => [o.value, o.label]));
export const STATUS_LABEL        = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
export const CHARGE_TYPE_LABEL   = Object.fromEntries(CHARGE_TYPE_OPTIONS.map((o) => [o.value, o.label]));
export const RATE_TYPE_LABEL     = Object.fromEntries(RATE_TYPE_OPTIONS.map((o) => [o.value, o.label]));

export const STATUS_COLOR: Record<string, string> = {
  inquiry:          "text-neutral-600 bg-neutral-50 border-neutral-200",
  awaiting_deposit: "text-amber-700 bg-amber-50 border-amber-200",
  deposit_paid:     "text-blue-700 bg-blue-50 border-blue-200",
  confirmed:        "text-green-700 bg-green-50 border-green-200",
  done:             "text-neutral-500 bg-neutral-100 border-neutral-300",
  cancelled:        "text-red-700 bg-red-50 border-red-200",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function thDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dow = new Date(d + "T00:00:00").getDay();
  return `${DAYS_SHORT[dow]} ${day}/${m}/${(y ?? 2500) + 543}`;
}

export function thFullDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dow = new Date(d + "T00:00:00").getDay();
  return `${DAYS_SHORT[dow]} ${day} ${MONTHS_TH[(m ?? 1) - 1]} ${(y ?? 2500) + 543}`;
}

/** Postgres TIME comes back as HH:MM:SS; <input type="time"> wants HH:MM. */
export function toTimeInput(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

export function timeRange(start: string | null, end: string | null): string {
  const s = toTimeInput(start);
  const e = toTimeInput(end);
  if (s && e) return `${s}–${e}`;
  return s || e || "–";
}

export function toNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function staffLabel(s: StaffOption): string {
  return s.nickname ?? s.full_name;
}

export function locationLabel(e: CateringEvent): string {
  if (e.location_type === "offsite") return "นอกสถานที่";
  const room = e.venue ? VENUE_LABEL[e.venue] ?? e.venue : "–";
  const portion = e.room_portion ? ROOM_PORTION_LABEL[e.room_portion] : null;
  return portion ? `${room} (${portion})` : room;
}

export function fmtBaht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Form state ───────────────────────────────────────────────────────────────

export type FormState = {
  customerId: string | null;
  customerQuery: string;
  newPhone: string;
  newLineId: string;
  newCompany: string;
  customerAddress: string;
  customerContactPerson: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location_type: string;
  venue: string;
  room_portion: string;
  offsite_address: string;
  offsite_distance_km: string;
  floor_level: string;
  booking_type: string;
  food_format: string;
  table_count: string;
  reserve_tables: string;
  table_label: string;
  guest_count: string;
  music_type: string;
  music_note: string;
  status: string;
  deposit_amount: string;
  deposit_paid_at: string;
  detail_note: string;
  kitchen_note: string;
  staff_ids: string[];
};

/**
 * defaultStaffId pre-selects whoever is creating the booking, resolved from
 * their profiles.employee_id. Only applies to new bookings — an existing event
 * always loads its own saved staff list via formFromEvent(). Fully editable
 * either way; the creator can remove themselves.
 */
export function blankForm(defaultStaffId?: string | null): FormState {
  return {
    customerId: null, customerQuery: "", newPhone: "", newLineId: "", newCompany: "",
    customerAddress: "", customerContactPerson: "",
    event_date: "", start_time: "", end_time: "",
    location_type: "in_house", venue: "room_v2", room_portion: "",
    offsite_address: "", offsite_distance_km: "", floor_level: "",
    booking_type: "table", food_format: "",
    table_count: "", reserve_tables: "", table_label: "", guest_count: "",
    music_type: "none", music_note: "",
    status: "inquiry", deposit_amount: "", deposit_paid_at: "",
    detail_note: "", kitchen_note: "", staff_ids: defaultStaffId ? [defaultStaffId] : [],
  };
}

export function formFromEvent(e: CateringEvent): FormState {
  return {
    customerId: e.customer_id,
    customerQuery: e.customer_name ?? "",
    newPhone: "", newLineId: "", newCompany: "",
    customerAddress: e.customer_address ?? "",
    customerContactPerson: e.customer_contact_person ?? "",
    event_date: e.event_date,
    start_time: toTimeInput(e.start_time),
    end_time: toTimeInput(e.end_time),
    location_type: e.location_type,
    venue: e.venue ?? "",
    room_portion: e.room_portion ?? "",
    offsite_address: e.offsite_address ?? "",
    offsite_distance_km: e.offsite_distance_km?.toString() ?? "",
    floor_level: e.floor_level?.toString() ?? "",
    booking_type: e.booking_type,
    food_format: e.food_format ?? "",
    table_count: e.table_count?.toString() ?? "",
    reserve_tables: e.reserve_tables?.toString() ?? "",
    table_label: e.table_label ?? "",
    guest_count: e.guest_count?.toString() ?? "",
    music_type: e.music_type,
    music_note: e.music_note ?? "",
    status: e.status,
    deposit_amount: e.deposit_amount?.toString() ?? "",
    deposit_paid_at: e.deposit_paid_at ?? "",
    detail_note: e.detail_note ?? "",
    kitchen_note: e.kitchen_note ?? "",
    staff_ids: e.staff_ids,
  };
}

/** Builds upsertCateringEvent's payload from form state. id omitted = create. */
export function formToUpsertPayload(form: FormState, id?: string) {
  const venue = form.location_type === "in_house" ? form.venue : null;
  const roomPortionApplies = venue === "room_v1" || venue === "room_v2";
  return {
    id,
    customer_id: form.customerId,
    new_customer: form.customerId
      ? null
      : {
          name: form.customerQuery,
          phone: form.newPhone,
          line_id: form.newLineId,
          company_name: form.newCompany,
          address: form.customerAddress,
          contact_person: form.customerContactPerson,
        },
    customer_edits: form.customerId
      ? { address: form.customerAddress, contact_person: form.customerContactPerson }
      : null,
    event_date: form.event_date,
    start_time: form.start_time || null,
    end_time: form.end_time || null,
    location_type: form.location_type,
    venue,
    room_portion: roomPortionApplies ? (form.room_portion || null) : null,
    offsite_address: form.location_type === "offsite" ? form.offsite_address : null,
    offsite_distance_km: form.location_type === "offsite" ? toNum(form.offsite_distance_km) : null,
    floor_level: form.location_type === "offsite" ? toNum(form.floor_level) : null,
    booking_type: form.booking_type,
    food_format: form.food_format || null,
    table_count: toNum(form.table_count),
    reserve_tables: toNum(form.reserve_tables),
    table_label: form.table_label,
    guest_count: toNum(form.guest_count),
    music_type: form.music_type,
    music_note: form.music_note,
    status: form.status,
    deposit_amount: toNum(form.deposit_amount),
    deposit_paid_at: form.deposit_paid_at || null,
    detail_note: form.detail_note,
    kitchen_note: form.kitchen_note,
    staff_ids: form.staff_ids,
  };
}

// ─── Sub-components (module level on purpose) ─────────────────────────────────
// Declaring these inside a page component would give them a new function
// identity on every render, so React would remount them instead of updating —
// which destroys input DOM nodes and resets the caret on every keystroke.

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status] ?? ""}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

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
  /** Ignored when `initial` is set — only new bookings get a pre-selected owner. */
  defaultStaffId?: string | null;
}) {
  const [form, setForm] = useState<FormState>(() => (initial ? formFromEvent(initial) : blankForm(defaultStaffId)));

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const isNewCustomer = form.customerId === null && form.customerQuery.trim() !== "";
  const roomPortionApplies = form.location_type === "in_house" && (form.venue === "room_v1" || form.venue === "room_v2");
  const canSave = form.event_date !== "" && form.customerQuery.trim() !== "" && !isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-5 py-4">
          <h2 className="font-kanit text-base font-semibold">
            {initial ? "แก้ไขการจอง" : "บันทึกการจองใหม่"}
          </h2>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-700">✕</button>
        </div>

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
              <input type="time" className="input-base" value={form.start_time}
                onChange={(e) => set("start_time", e.target.value)} />
            </Field>
            <Field label="เวลาสิ้นสุด">
              <input type="time" className="input-base" value={form.end_time}
                onChange={(e) => set("end_time", e.target.value)} />
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
      </div>
    </div>
  );
}
