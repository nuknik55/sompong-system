/**
 * Run with: npm test — the booking form's customer, with the real functions:
 * what a pick keeps, what typing clears, and what a save sends (queue items
 * 49 and 50).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { blankForm, formFromEvent, formToUpsertPayload, pickCustomer, typeCustomerName } from "./booking-form.ts";
import type { CateringEvent } from "./actions";

/** A booking of คุณป้อม whose customer has an address and a contact person on file. */
const booking = (): CateringEvent => ({
  id: "e1", created_at: "2026-09-18T07:29:00Z", updated_at: "t1",
  customer_id: "pom-1", customer_name: "คุณป้อม", customer_phone: "0811111111", customer_line_id: "pomline",
  customer_company_name: "บริษัท ป้อม", customer_address: "ที่อยู่ที่หน้าลูกค้าบันทึกไว้", customer_contact_person: "คุณเอ ผู้ติดต่อ",
  event_date: "2026-10-01", start_time: "11:00:00", end_time: "14:00:00", location_type: "offsite", venue: null,
  room_portion: null, offsite_address: "บ้านลูกค้า", offsite_distance_km: 12, floor_level: null, booking_type: "catering",
  event_type_id: null, event_type_label: null, food_format: "chinese_table", table_count: 12, reserve_tables: null,
  table_label: null, guest_count: 120, music_type: "none", music_note: null, status: "inquiry", deposit_amount: null,
  deposit_percent: 30, deposit_paid_at: null, detail_note: null, kitchen_note: null, created_by: null, created_by_name: null,
  quote_number: null, quote_revision: 0, quoted_total: null, quoted_at: null, cost_locked_at: null, staff_ids: [],
});

test("A PICK KEEPS THE CUSTOMER: the id and the name shown, in one update, and the save sends that id", () => {
  const f = pickCustomer(blankForm(), { id: "pom-2", name: "คุณป้อม" });
  assert.equal(f.customerId, "pom-2");
  assert.equal(f.customerQuery, "คุณป้อม");
  const p = formToUpsertPayload({ ...f, event_date: "2026-10-01" });
  assert.equal(p.customer_id, "pom-2");
  assert.equal(p.new_customer, null, "a pick sends no name to be matched");
});

test("WHAT THE LIST USED TO DO — onPick, then onQueryChange with the name — loses the pick", () => {
  // The click handler called both, in this order, so every pick reached the
  // save as a typed name. customer-pick.test.ts keeps the list from calling
  // anything after onPick again.
  const f = typeCustomerName(pickCustomer(blankForm(), { id: "pom-2", name: "คุณป้อม" }), "คุณป้อม");
  assert.equal(f.customerId, null);
});

test("TYPING clears a pick; clearing the pick clears the name and a new customer's phone", () => {
  const picked = pickCustomer(blankForm(), { id: "pom-1", name: "คุณป้อม" });
  assert.equal(typeCustomerName(picked, "คุณป้อมม").customerId, null);
  const cleared = pickCustomer({ ...picked, newPhone: "081" }, null);
  assert.deepEqual([cleared.customerId, cleared.customerQuery, cleared.newPhone], [null, "", ""]);
  // A pick after a phone was typed for a new customer drops that phone.
  assert.equal(pickCustomer({ ...blankForm(), newPhone: "0899999999" }, { id: "pom-1", name: "คุณป้อม" }).newPhone, "");
});

test("A TYPED NEW CUSTOMER sends the name and the phone, and nothing else about a customer", () => {
  const f = { ...typeCustomerName(blankForm(), "คุณนก"), newPhone: "0812345678", event_date: "2026-10-01" };
  const p = formToUpsertPayload(f);
  assert.equal(p.customer_id, null);
  assert.deepEqual(p.new_customer, { name: "คุณนก", phone: "0812345678" });
});

test("A BOOKING SAVE NEVER CARRIES A CUSTOMER'S DETAILS: nothing it loaded about the customer goes back (queue item 49)", () => {
  const e = booking();
  const p = formToUpsertPayload(formFromEvent(e), e.id) as unknown as Record<string, unknown>;
  assert.equal("customer_edits" in p, false);
  assert.equal(p.customer_id, "pom-1");
  assert.equal(p.new_customer, null);
  const sent = JSON.stringify(p);
  for (const loaded of [e.customer_address, e.customer_contact_person, e.customer_line_id, e.customer_company_name, e.customer_phone]) {
    assert.equal(sent.includes(loaded as string), false, `the payload carries ${loaded}`);
  }
});

test("THE FORM HOLDS NO CUSTOMER DETAILS: a booking loaded, then saved, cannot write back what the customer page changed since", () => {
  const f = formFromEvent(booking()) as unknown as Record<string, unknown>;
  for (const k of ["customerAddress", "customerContactPerson", "newLineId", "newCompany"]) assert.equal(k in f, false, k);
  assert.deepEqual(Object.keys(blankForm()).filter((k) => /customer|new/i.test(k)).sort(), ["customerId", "customerQuery", "newPhone"]);
});
