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
import { STATUS_OPTIONS, STATUS_LABEL, STATUS_COLOR, STATUS_TONE } from "./event-status";
import { Badge } from "@/components/ui/badge";
import { EVENT_MENU_SECTION_LIST } from "./event-menu";
import { toNum } from "./to-num";
import { toTimeInput } from "./booking-form";

export { toNum, toTimeInput };

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
/**
 * catering_set_menu_items.section — the four groups, IN PRINT ORDER. The
 * values mirror the CHECK constraint in
 * supabase/catering_set_menu_sections_migration.sql; the order is the order
 * the three documents print them in, which is why this is an array and not a
 * label map. ONE definition: event-menu.ts holds it (the price box's dish
 * names sort by the same list), and this is that list.
 *
 * A section with no rows prints NOTHING — no heading, no empty row. A package
 * with no dessert is a package with no dessert, not a document with a blank
 * ขนมหวาน line.
 */
export const SET_MENU_SECTIONS: { value: string; label: string }[] = EVENT_MENU_SECTION_LIST;

export const MUSIC_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "none",         label: "ไม่มี" },
  { value: "karaoke_shop", label: "คาราโอเกะ (ร้าน)" },
  { value: "own_band",     label: "วงดนตรีลูกค้านำมาเอง" },
  { value: "other",        label: "อื่นๆ" },
];
// STATUS_OPTIONS/STATUS_LABEL/STATUS_COLOR live in event-status.ts (plain
// TS, no JSX) so actions.ts — a "use server" file that can't import this
// module — shares the same definitions instead of duplicating them.
// Imported (not just re-exported) because StatusBadge below uses them, and
// `export ... from` alone creates no local binding; re-exported so every
// existing importer of this module keeps working unchanged.
export { STATUS_OPTIONS, STATUS_LABEL, STATUS_COLOR };
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
/** CHARGE_TYPE_OPTIONS minus "food" — for the manual "+ เพิ่มรายการ" row's
 *  own <select> only. A manual row is never linked to catering_event_menus,
 *  so it can never have real recipe cost behind it; "food" stays a valid,
 *  displayable charge_type (menu-picker rows still carry it, and
 *  CHARGE_TYPE_OPTIONS/CHARGE_TYPE_LABEL stay unfiltered for rendering
 *  those), it's just not offered as a choice when hand-typing a row. Also
 *  refused on save: chargeLineError (booking-lines.ts) and the database
 *  function catering_save_booking_prices. */
export const MANUAL_CHARGE_TYPE_OPTIONS = CHARGE_TYPE_OPTIONS.filter((o) => o.value !== "food");
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
/** RATE_TYPE_OPTIONS minus "food_set" — for the quotation-side RatePicker
 *  (ChargesSection.tsx) only. food_set rates (โต๊ะจีน/buffet packages) have
 *  no recipe cost behind them, so quoting food goes exclusively through
 *  MenuPicker (real menus/set menus) now — RatesSettingsClient.tsx still
 *  uses the full RATE_TYPE_OPTIONS so admin can see/reactivate the existing
 *  (now deactivated) food_set rows, it just blocks *creating new* ones. */
export const RATE_PICKER_TYPE_OPTIONS = RATE_TYPE_OPTIONS.filter((o) => o.value !== "food_set");
/**
 * rate_type -> charge_type, applied when a charge row is inserted from the
 * rate picker. food_set is no longer offered anywhere in the rate picker at
 * all (see the filtered group list in ChargesSection.tsx's RatePicker, and
 * RatesSettingsClient.tsx blocking new food_set rates) — food quoting goes
 * through real catering_set_menus/menus (MenuPicker) exclusively now, so
 * every "food" charge has real recipe cost behind it. This mapping entry is
 * kept as "other" purely as a defensive backstop (never reachable through
 * the UI as of this round) in case some future/direct path ever resolves a
 * food_set rate anyway — it should still never silently become "food".
 */
export const RATE_TYPE_TO_CHARGE_TYPE: Record<string, string> = {
  room: "venue",
  delivery: "transport",
  food_set: "other",
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
export const CHARGE_TYPE_LABEL   = Object.fromEntries(CHARGE_TYPE_OPTIONS.map((o) => [o.value, o.label]));
export const RATE_TYPE_LABEL     = Object.fromEntries(RATE_TYPE_OPTIONS.map((o) => [o.value, o.label]));
// STATUS_LABEL/STATUS_COLOR are defined in event-status.ts and re-exported
// above — see the note there.

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

export function timeRange(start: string | null, end: string | null): string {
  const s = toTimeInput(start);
  const e = toTimeInput(end);
  if (s && e) return `${s}–${e}`;
  return s || e || "–";
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
// Moved to booking-form.ts (2026-09-22), where the tests import it; re-exported
// here so every importer stays as it was.

export { blankForm, formFromEvent, formToUpsertPayload, pickCustomer, typeCustomerName } from "./booking-form";
export type { FormState } from "./booking-form";

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

/** A booking's status in the shared look's colour roles (STATUS_TONE). Used by
 *  the pages already moved to that look; StatusBadge stays for the rest. */
export function BookingStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} className={status === "cancelled" ? "line-through" : undefined}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
