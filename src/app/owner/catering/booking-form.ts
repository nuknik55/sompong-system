/**
 * The booking screen's form: its state, how it is built, how a customer is
 * picked or typed, and the payload a save sends. Moved out of shared-utils.tsx
 * (2026-09-22) so that the tests import these functions rather than copies of
 * them; shared-utils.tsx re-exports every one.
 *
 * ── THE CUSTOMER: PICKED, OR TYPED — never guessed (queue item 50) ─────────
 *
 * Picking a customer from the list used to be undone in the same click: the
 * list called onPick, then onQueryChange with the name, and typing clears the
 * pick. Every booking then went through the save's name match with no phone,
 * which took the first customer of that name. A pick is now ONE update, the
 * id and the name shown together (pickCustomer); typing clears it
 * (typeCustomerName), and a typed name is matched by customer-match.ts.
 *
 * ── A BOOKING SAVE NEVER CHANGES A CUSTOMER'S DETAILS (queue item 49) ──────
 *
 * The screen has no inputs for a customer's address, contact person, LINE or
 * company, yet the form carried the ones it loaded and every save wrote them
 * back to the customer, undoing whatever the customer page had changed since.
 * They are gone from the form and from the payload, and saveBooking ignores
 * them from an older screen: the customer page is the one place a customer's
 * details are edited. A new customer made by a booking save gets what this
 * screen asks for, the name and the phone.
 */
import type { CateringEvent } from "./actions";
import { toNum } from "./to-num.ts";

/** Postgres TIME comes back as HH:MM:SS; <input type="time"> wants HH:MM. */
export function toTimeInput(t: string | null): string {
  return t ? t.slice(0, 5) : "";
}

export type FormState = {
  /** The customer picked from the list; null while the name is typed. */
  customerId: string | null;
  /** The name box: the picked customer's name, or what is typed. */
  customerQuery: string;
  /** A NEW customer's phone. A picked customer's shows read-only instead. */
  newPhone: string;
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
  /** ประเภทงาน. "" = not chosen, which is normal and saves as NULL. */
  event_type_id: string;
  food_format: string;
  table_count: string;
  reserve_tables: string;
  table_label: string;
  guest_count: string;
  music_type: string;
  music_note: string;
  status: string;
  deposit_amount: string;
  deposit_percent: string;
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
    customerId: null, customerQuery: "", newPhone: "",
    event_date: "", start_time: "", end_time: "",
    location_type: "in_house", venue: "room_v2", room_portion: "",
    offsite_address: "", offsite_distance_km: "", floor_level: "",
    booking_type: "table", event_type_id: "", food_format: "",
    table_count: "", reserve_tables: "", table_label: "", guest_count: "",
    music_type: "none", music_note: "",
    // deposit_percent pre-fills 30 on a NEW booking only — Nik's starting
    // point, editable, clearable to blank (NULL = not yet discussed) and
    // settable to 0 (agreed: no deposit). A FORM default, deliberately not a
    // column default: existing bookings keep NULL and are never handed terms
    // retroactively. formFromEvent below reads the stored value untouched.
    status: "inquiry", deposit_amount: "", deposit_percent: "30", deposit_paid_at: "",
    detail_note: "", kitchen_note: "", staff_ids: defaultStaffId ? [defaultStaffId] : [],
  };
}

export function formFromEvent(e: CateringEvent): FormState {
  return {
    customerId: e.customer_id,
    customerQuery: e.customer_name ?? "",
    newPhone: "",
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
    event_type_id: e.event_type_id ?? "",
    food_format: e.food_format ?? "",
    table_count: e.table_count?.toString() ?? "",
    reserve_tables: e.reserve_tables?.toString() ?? "",
    table_label: e.table_label ?? "",
    guest_count: e.guest_count?.toString() ?? "",
    music_type: e.music_type,
    music_note: e.music_note ?? "",
    status: e.status,
    deposit_amount: e.deposit_amount?.toString() ?? "",
    deposit_percent: e.deposit_percent?.toString() ?? "",
    deposit_paid_at: e.deposit_paid_at ?? "",
    detail_note: e.detail_note ?? "",
    kitchen_note: e.kitchen_note ?? "",
    staff_ids: e.staff_ids,
  };
}

/**
 * The person picked `c` from the list, or cleared the pick (null). ONE update
 * for the id and the name shown, so nothing after it can clear the id again —
 * the list used to call onQueryChange right after onPick, and typing clears a
 * pick (queue item 50).
 */
export function pickCustomer(form: FormState, c: { id: string; name: string } | null): FormState {
  return c
    ? { ...form, customerId: c.id, customerQuery: c.name, newPhone: "" }
    : { ...form, customerId: null, customerQuery: "", newPhone: "" };
}

/**
 * The person typed in the name box: it is no longer a pick. The save then
 * finds the one customer the name and phone mean, adds a new one, or refuses
 * (matchTypedCustomer, customer-match.ts).
 */
export function typeCustomerName(form: FormState, text: string): FormState {
  return { ...form, customerQuery: text, customerId: null };
}

/**
 * Builds upsertCateringEvent's payload from form state. id omitted = create.
 * The customer is the picked one (customer_id), or the name and phone typed
 * (new_customer). Nothing else about a customer is sent: a booking save never
 * changes a customer's details (the file header, queue item 49).
 */
export function formToUpsertPayload(form: FormState, id?: string) {
  const venue = form.location_type === "in_house" ? form.venue : null;
  const roomPortionApplies = venue === "room_v1" || venue === "room_v2";
  return {
    id,
    customer_id: form.customerId,
    new_customer: form.customerId ? null : { name: form.customerQuery, phone: form.newPhone },
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
    event_type_id: form.event_type_id || null,
    food_format: form.food_format || null,
    table_count: toNum(form.table_count),
    reserve_tables: toNum(form.reserve_tables),
    table_label: form.table_label,
    guest_count: toNum(form.guest_count),
    music_type: form.music_type,
    music_note: form.music_note,
    status: form.status,
    deposit_amount: toNum(form.deposit_amount),
    deposit_percent: toNum(form.deposit_percent),
    deposit_paid_at: form.deposit_paid_at || null,
    detail_note: form.detail_note,
    kitchen_note: form.kitchen_note,
    staff_ids: form.staff_ids,
  };
}
