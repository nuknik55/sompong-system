/**
 * The customer page's form: what it holds, what a save sends, and what counts
 * as an unsaved edit (queue item 51, Nik 2026-09-22). Plain TypeScript, so
 * the tests import these functions rather than copies of them.
 *
 * ── A CUSTOMER EDIT IS NEVER WRITTEN OVER ANOTHER ──────────────────────────
 *
 * The page filled its form once, when it opened, and its save wrote all eight
 * fields with no check, so an older copy of the page — a second tab, a second
 * login, one the browser's Back button brought back — wrote its stale values
 * over a newer edit, silently. Now an edit starts from the customer as the
 * page shows it at that moment, carries the updated_at it started from, and
 * the save is a compare-and-set on it (updateCateringCustomer): refused, with
 * nothing written, when anyone saved the customer in between. The page also
 * asks before leaving with an unsaved edit, and locks the form while a save
 * is in flight.
 */
import type { CateringCustomer } from "./actions";

export type CustomerFormState = {
  name: string;
  phone: string;
  line_id: string;
  company_name: string;
  address: string;
  contact_person: string;
  tax_id: string;
  note: string;
};

export function formFromCustomer(c: CateringCustomer): CustomerFormState {
  return {
    name: c.name,
    phone: c.phone ?? "",
    line_id: c.line_id ?? "",
    company_name: c.company_name ?? "",
    address: c.address ?? "",
    contact_person: c.contact_person ?? "",
    tax_id: c.tax_id ?? "",
    note: c.note ?? "",
  };
}

/** What a save sends: every field, an empty one as null (the server trims). */
export function customerPayload(f: CustomerFormState) {
  return {
    name: f.name,
    phone: f.phone || null,
    line_id: f.line_id || null,
    company_name: f.company_name || null,
    address: f.address || null,
    contact_person: f.contact_person || null,
    tax_id: f.tax_id || null,
    note: f.note || null,
  };
}

/**
 * An unsaved edit: what a save would send differs from what the edit started
 * from, field by field. Compared as sent, not trimmed — so a trailing space
 * the server would drop still asks before leaving, the safe direction.
 */
export function customerFormDirty(form: CustomerFormState, start: CustomerFormState): boolean {
  const a = customerPayload(form);
  const b = customerPayload(start);
  return (Object.keys(a) as (keyof typeof a)[]).some((k) => a[k] !== b[k]);
}
