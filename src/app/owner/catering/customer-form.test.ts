/**
 * Run with: npm test — the customer page's form, with the real functions
 * (queue item 51): what a save sends, and what counts as an unsaved edit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { customerFormDirty, customerPayload, formFromCustomer } from "./customer-form.ts";
import type { CateringCustomer } from "./actions";

const pom: CateringCustomer = {
  id: "pom-1", name: "คุณป้อม", phone: "0811111111", line_id: null, company_name: "บริษัท ป้อม",
  address: "ที่อยู่เดิม", contact_person: null, tax_id: null, note: null,
};

test("A FORM NOBODY TOUCHED IS CLEAN, whichever fields are empty", () => {
  const f = formFromCustomer(pom);
  assert.equal(customerFormDirty(f, f), false);
  assert.equal(customerFormDirty({ ...f }, formFromCustomer(pom)), false, "a copy is not an edit");
  const empty = formFromCustomer({ ...pom, phone: null, company_name: null, address: null });
  assert.equal(customerFormDirty(empty, empty), false);
});

test("EVERY FIELD IS WATCHED: a missed edit is a lost one", () => {
  const start = formFromCustomer(pom);
  for (const k of Object.keys(start) as (keyof typeof start)[]) {
    assert.equal(customerFormDirty({ ...start, [k]: `${start[k]}x` }, start), true, k);
  }
});

test("EMPTY AND NULL ARE THE SAME TO A SAVE, so clearing an empty field is no edit, but clearing a filled one is", () => {
  const start = formFromCustomer(pom);
  assert.equal(customerFormDirty({ ...start, line_id: "" }, start), false);
  assert.equal(customerFormDirty({ ...start, address: "" }, start), true);
});

test("A SAVE SENDS EVERY FIELD, an empty one as null", () => {
  assert.deepEqual(customerPayload({ ...formFromCustomer(pom), address: "" }), {
    name: "คุณป้อม", phone: "0811111111", line_id: null, company_name: "บริษัท ป้อม",
    address: null, contact_person: null, tax_id: null, note: null,
  });
});
