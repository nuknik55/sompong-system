/**
 * Run with: npm test — what counts as an unsaved edit on the booking screen.
 *
 * The screen sales uses most, so the two failure directions are not equal.
 * A warning on a form nobody touched trains the person to dismiss it; a
 * missed edit loses their typing. Both are tested here, and the first is
 * tested hardest: a snapshot of the untouched initial state must equal
 * itself for every shape of booking.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingSnapshot, type DirtyLine } from "./booking-dirty.ts";
import type { FormState } from "./shared-utils.tsx";

/**
 * blankForm's output, written out rather than imported: shared-utils is a
 * .tsx and the test runner loads .ts only.
 *
 * TypeScript checks this against FormState, so a field added to the form
 * fails the TYPECHECK here until this copy is updated. Note what that does
 * and does not buy: the snapshot itself enumerates the form's own keys, so
 * production watches a new field the moment it exists; and the typecheck is
 * a gate the build runs, not one `npm test` or CI runs. The per-field list
 * below is `Partial<FormState>[]`, so a new field would silently go
 * untested here even though it is watched in production.
 */
const blankForm = (defaultStaffId?: string | null): FormState => ({
  customerId: null, customerQuery: "", newPhone: "", newLineId: "", newCompany: "",
  customerAddress: "", customerContactPerson: "",
  event_date: "", start_time: "", end_time: "",
  location_type: "in_house", venue: "room_v2", room_portion: "",
  offsite_address: "", offsite_distance_km: "", floor_level: "",
  booking_type: "table", event_type_id: "", food_format: "",
  table_count: "", reserve_tables: "", table_label: "", guest_count: "",
  music_type: "none", music_note: "",
  status: "inquiry", deposit_amount: "", deposit_percent: "30", deposit_paid_at: "",
  detail_note: "", kitchen_note: "", staff_ids: defaultStaffId ? [defaultStaffId] : [],
});

const line = (over: Partial<DirtyLine> = {}): DirtyLine => ({
  kind: "set", section: "menu", refId: "s1", eventMenuId: "L1",
  label: "ชุด 4,500", unitPrice: "4500", quantity: "10", amount: "45000", chargeType: "food",
  ...over,
});

test("A FORM NOBODY TOUCHED IS CLEAN — for a new booking, with and without a linked employee", () => {
  assert.equal(bookingSnapshot(blankForm(), []), bookingSnapshot(blankForm(), []));
  assert.equal(bookingSnapshot(blankForm(null), []), bookingSnapshot(blankForm(null), []));
  assert.equal(bookingSnapshot(blankForm("emp-1"), []), bookingSnapshot(blankForm("emp-1"), []));
  // And for a booking that loaded with lines.
  const ls = [line(), line({ eventMenuId: "L2", label: "ชุดเจ", unitPrice: "3000", quantity: "2", amount: "6000" })];
  assert.equal(bookingSnapshot(blankForm(), ls), bookingSnapshot(blankForm(), ls));
});

test("HOW THE FORM WAS BUILT CANNOT MAKE IT DIRTY: key order never shows", () => {
  const a = blankForm("emp-1");
  const b = { ...a, detail_note: "x" } as FormState;
  assert.notEqual(bookingSnapshot(a, []), bookingSnapshot(b, []), "the note IS an edit");
  assert.equal(bookingSnapshot(b, []), bookingSnapshot({ ...b }, []), "a plain copy is not");
  // The same values with the keys in a different order — which is all a
  // spread can ever produce — must read as the same booking.
  const entries = Object.entries(a as unknown as Record<string, unknown>);
  const reordered = Object.fromEntries([...entries].reverse()) as unknown as FormState;
  assert.deepEqual(Object.keys(reordered).sort(), Object.keys(a).sort(), "same keys, reversed order");
  assert.equal(bookingSnapshot(reordered, []), bookingSnapshot(a, []), "key order alone changes nothing");
});

test("EVERY FIELD OF THE FORM IS WATCHED — a missed edit is lost typing", () => {
  const base = blankForm("emp-1");
  const edits: Partial<FormState>[] = [
    { customerQuery: "คุณสมชาย" }, { customerId: "c1" }, { newPhone: "081" }, { newLineId: "line" },
    { newCompany: "บริษัท" }, { customerAddress: "ที่อยู่" }, { customerContactPerson: "ผู้ติดต่อ" },
    { event_date: "2026-10-01" }, { start_time: "18:00" }, { end_time: "22:00" },
    { location_type: "offsite" }, { venue: "room_v1" }, { room_portion: "half" },
    { offsite_address: "นอกสถานที่" }, { offsite_distance_km: "12" }, { floor_level: "2" },
    { booking_type: "catering" }, { event_type_id: "t1" }, { food_format: "buffet" },
    { table_count: "20" }, { reserve_tables: "2" }, { table_label: "A1" }, { guest_count: "200" },
    { music_type: "other" }, { music_note: "วงดนตรี" }, { status: "confirmed" },
    { deposit_amount: "5000" }, { deposit_percent: "50" }, { deposit_paid_at: "2026-09-20" },
    { detail_note: "รายละเอียด" }, { kitchen_note: "แจ้งครัว" }, { staff_ids: ["emp-2"] },
  ];
  for (const e of edits) {
    const key = Object.keys(e)[0]!;
    assert.notEqual(bookingSnapshot({ ...base, ...e }, []), bookingSnapshot(base, []), `${key} must count as an edit`);
  }
  // จำนวนโต๊ะ is the one Nik actually lost; name it on its own.
  assert.notEqual(bookingSnapshot({ ...base, table_count: "20" }, []), bookingSnapshot(base, []));
});

test("EVERY PART OF A PRICE-BOX LINE IS WATCHED, and so are adding and removing one", () => {
  const base = [line()];
  for (const e of [
    { label: "ชุด 3,500" }, { unitPrice: "3500" }, { quantity: "11" }, { amount: "49500" },
    { chargeType: "other" }, { kind: "dish" }, { section: "other" }, { refId: "s2" }, { eventMenuId: "L9" },
  ] as Partial<DirtyLine>[]) {
    assert.notEqual(bookingSnapshot(blankForm(), [line(e)]), bookingSnapshot(blankForm(), base), JSON.stringify(e));
  }
  assert.notEqual(bookingSnapshot(blankForm(), [...base, line({ eventMenuId: "L2" })]), bookingSnapshot(blankForm(), base), "adding a row");
  assert.notEqual(bookingSnapshot(blankForm(), []), bookingSnapshot(blankForm(), base), "removing the last row");
});

test("RETYPING THE SAME MONEY IS NOT AN EDIT, but a different figure is", () => {
  const same = bookingSnapshot(blankForm(), [line({ unitPrice: "4500.00", quantity: "10.0", amount: "45000.000" })]);
  assert.equal(same, bookingSnapshot(blankForm(), [line()]), "4500.00 is 4500");
  assert.notEqual(bookingSnapshot(blankForm(), [line({ unitPrice: "4500.01" })]), bookingSnapshot(blankForm(), [line()]));
  // A blank stays blank rather than becoming 0 — they mean different things.
  assert.notEqual(bookingSnapshot(blankForm(), [line({ quantity: "" })]), bookingSnapshot(blankForm(), [line({ quantity: "0" })]));
  // And nonsense is kept as typed, so it is still visibly an edit.
  assert.notEqual(bookingSnapshot(blankForm(), [line({ amount: "abc" })]), bookingSnapshot(blankForm(), [line()]));
});

test("TEXT IS COMPARED AS TYPED — which over-warns on the fields the server trims, the safe direction", () => {
  const base = blankForm();
  assert.notEqual(bookingSnapshot({ ...base, detail_note: "ของ " }, []), bookingSnapshot({ ...base, detail_note: "ของ" }, []));
  assert.notEqual(bookingSnapshot(blankForm(), [line({ label: "ชุด 4,500 " })]), bookingSnapshot(blankForm(), [line()]));
  // The one that matters: a difference the save WOULD persist is never hidden.
  assert.notEqual(bookingSnapshot({ ...base, detail_note: "ของหวาน" }, []), bookingSnapshot({ ...base, detail_note: "ของ" }, []));
});

test("THE CLIENT KEY IS NOT PART OF IT: removing a row and adding an identical one leaves nothing to warn about", () => {
  // The screen gives a new row a fresh uuid key; the booking is unchanged.
  assert.equal(bookingSnapshot(blankForm(), [line()]), bookingSnapshot(blankForm(), [line()]));
});
