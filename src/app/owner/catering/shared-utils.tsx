// Deliberately NOT "use client" — every export here is a plain constant,
// pure function, or presentational component with no hooks/interactivity,
// so it must stay callable from server components too (see status/page.tsx,
// the only server component in this module that renders catering data
// directly). Splitting this out of shared.tsx fixed a production error:
// "Attempted to call thDate() from the server but thDate is on the client"
// — shared.tsx picked up "use client" when the เดือน/ปี toggle round added
// ToggleGroup, which made EVERY export from that file client-only, including
// unrelated formatting helpers that have nothing to do with interactivity.
//
// Anything with useState/useRef/useEffect, or that only makes sense wired to
// user interaction (ToggleGroup, CustomerCombobox, EventForm, ...), stays in
// shared.tsx. If you're adding something here, make sure it really has zero
// hooks and zero client-only browser APIs — that's the whole reason this
// file is allowed to skip "use client".

import type { CateringEvent, StaffOption } from "./actions";

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
// Values mirror the CHECK constraint in
// supabase/catering_transfer_cost_rates_migration.sql. Internal cost only —
// never shown to a customer, never on a quotation. Unrelated to
// RATE_TYPE_OPTIONS' 'staff_bonus' (a customer-facing per-diem line item).
export const COST_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "staff_labor",    label: "ค่าแรงพนักงาน/เชฟ" },
  { value: "kitchen_helper", label: "ค่าแรงผู้ช่วยครัว" },
  { value: "vehicle",        label: "ค่ารถ/น้ำมัน" },
  { value: "other",          label: "อื่นๆ" },
];
export const COST_TYPE_LABEL = Object.fromEntries(COST_TYPE_OPTIONS.map((o) => [o.value, o.label]));

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

export function locationLabel(e: Pick<CateringEvent, "location_type" | "venue" | "room_portion">): string {
  if (e.location_type === "offsite") return "นอกสถานที่";
  const room = e.venue ? VENUE_LABEL[e.venue] ?? e.venue : "–";
  const portion = e.room_portion ? ROOM_PORTION_LABEL[e.room_portion] : null;
  return portion ? `${room} (${portion})` : room;
}

export function fmtBaht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Room-conflict rule itself (ROOM_CONFLICTS + findRoomConflict) lives in
// conflict.ts, shared with the server-side enforcement in actions.ts — this
// file only adds the display label for a conflict's time.
export function conflictTimeLabel(start: string | null, end: string | null): string {
  const r = timeRange(start, end);
  return r === "–" ? "ไม่ระบุเวลา" : r;
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

// ─── Presentational components (no hooks, safe to render from a server
// component tree) ──────────────────────────────────────────────────────────

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
