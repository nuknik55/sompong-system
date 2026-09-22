/**
 * Run with: npm test — which customer a TYPED name means (queue item 50).
 *
 * The save used to take the first customer of a name, whatever the phone
 * said, and every pick from the list reached it as a typed name. With two
 * customers of one name, a booking could attach to the other one. The rule
 * that replaced it guesses nothing; these are its cases, including the ones
 * the review of 2026-09-22 found: a placeholder phone must not make two
 * people one, and a namesake with no phone on file must not become a silent
 * duplicate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ambiguousCustomerMessage, matchTypedCustomer, normalizeCustomerName, sameCustomerName, typedCustomerHint, usablePhone,
  type CustomerForMatch,
} from "./customer-match.ts";

// By code point, so that no invisible character sits in this source.
const NBSP = String.fromCharCode(0x00a0);
const ZWSP = String.fromCharCode(0x200b);
const COMBINING_ACUTE = String.fromCharCode(0x0301);

const pom1: CustomerForMatch = { id: "pom-1", name: "คุณป้อม", phone: "081-111-1111" };
const pom2: CustomerForMatch = { id: "pom-2", name: "คุณป้อม", phone: "0822222222" };
const kai: CustomerForMatch = { id: "kai", name: "พี่ไก่", phone: null };
const other: CustomerForMatch = { id: "x", name: "บริษัท เอ", phone: null };

test("A NAME NOBODY HAS is a new customer", () => {
  assert.deepEqual(matchTypedCustomer("คุณนก", "", [pom1, pom2, other]), { kind: "new", sameName: 0 });
  assert.deepEqual(matchTypedCustomer("คุณนก", "0811111111", []), { kind: "new", sameName: 0 });
});

test("THE FIRST OF THE NAME IS NEVER TAKEN: the name alone is refused, however many have it", () => {
  assert.deepEqual(matchTypedCustomer("คุณป้อม", "", [pom1, pom2]), { kind: "ambiguous", sameName: 2, reason: "no-phone" });
  assert.deepEqual(matchTypedCustomer("คุณป้อม", null, [pom1, pom2]), { kind: "ambiguous", sameName: 2, reason: "no-phone" });
  assert.deepEqual(matchTypedCustomer("คุณป้อม", "", [pom1]), { kind: "ambiguous", sameName: 1, reason: "no-phone" });
});

test("THE NAME AND THE PHONE single one customer out: that one, whichever of the two", () => {
  assert.deepEqual(matchTypedCustomer("คุณป้อม", "0822222222", [pom1, pom2]), { kind: "same", id: "pom-2" });
  assert.deepEqual(matchTypedCustomer("คุณป้อม", "081 111 1111", [pom1, pom2]), { kind: "same", id: "pom-1" });
});

test("THE NAME WITH ANOTHER REAL PHONE, when every namesake has a real phone of their own, is another person", () => {
  assert.deepEqual(matchTypedCustomer("คุณป้อม", "0899999999", [pom1, pom2]), { kind: "new", sameName: 2 });
});

test("A PLACEHOLDER PHONE PROVES NOTHING: '000' can neither match a customer nor tell a new one apart", () => {
  const kai2: CustomerForMatch = { id: "kai-2", name: "พี่ไก่", phone: "000" };
  // Staff typing 000 for a second, different พี่ไก่ must not attach a third to the second.
  assert.deepEqual(matchTypedCustomer("พี่ไก่", "000", [kai, kai2]), { kind: "ambiguous", sameName: 2, reason: "no-phone" });
  assert.deepEqual(matchTypedCustomer("พี่ไก่", "123", [kai]), { kind: "ambiguous", sameName: 1, reason: "no-phone" });
  assert.equal(usablePhone("000"), "");
  assert.equal(usablePhone("12345678"), "", "8 digits is not a Thai phone");
  assert.equal(usablePhone("021234567"), "021234567", "a Bangkok landline has 9");
});

test("A NAMESAKE WITH NO PHONE ON FILE cannot be told apart by the phone typed: refused, never a silent duplicate", () => {
  assert.deepEqual(matchTypedCustomer("พี่ไก่", "0812345678", [kai]), { kind: "ambiguous", sameName: 1, reason: "phoneless-twin" });
  // A placeholder on file is no phone on file.
  assert.deepEqual(matchTypedCustomer("พี่ไก่", "0812345678", [{ ...kai, phone: "000" }]), { kind: "ambiguous", sameName: 1, reason: "phoneless-twin" });
  // But the one namesake who HAS that phone is still found.
  assert.deepEqual(matchTypedCustomer("พี่ไก่", "0812345678", [kai, { id: "kai-3", name: "พี่ไก่", phone: "081-234-5678" }]), { kind: "same", id: "kai-3" });
});

test("TWO RECORDS WITH THE SAME NAME AND PHONE are not chosen between", () => {
  const twin: CustomerForMatch = { ...pom1, id: "pom-1-twin" };
  assert.deepEqual(matchTypedCustomer("คุณป้อม", "0811111111", [pom1, twin]), { kind: "ambiguous", sameName: 2, reason: "twins" });
});

test("A PHONE TYPED IN THE NAME BOX is refused, not saved as a customer named 0812345678", () => {
  assert.deepEqual(matchTypedCustomer("0812345678", "", [pom1]), { kind: "ambiguous", sameName: 0, reason: "phone-as-name" });
  assert.deepEqual(matchTypedCustomer("081-234-5678", "", []), { kind: "ambiguous", sameName: 0, reason: "phone-as-name" });
  assert.deepEqual(matchTypedCustomer("คุณนก 2", "", []), { kind: "new", sameName: 0 }, "letters and a digit are a name");
});

test("THE SAME NAME after NFC, zero-width characters dropped, whitespace as one space, trimmed, case aside", () => {
  assert.equal(sameCustomerName("  Test ", "test"), true);
  assert.equal(sameCustomerName(`คุณ${NBSP}ป้อม`, "คุณ ป้อม"), true, "a no-break space is a space");
  assert.equal(sameCustomerName(`คุณป้อม${ZWSP}`, "คุณป้อม"), true, "a zero-width space is nothing");
  assert.equal(sameCustomerName(`Cafe${COMBINING_ACUTE}`, "Caf" + String.fromCharCode(0x00e9)), true, "decomposed and composed are one name");
  assert.equal(sameCustomerName("คุณป้อม", "ป้อม"), false, "a near-same name is another customer's");
  assert.equal(sameCustomerName("test_x", "testAx"), false, "no LIKE wildcards anywhere");
  assert.equal(normalizeCustomerName("  A  \t B  "), "a b");
});

test("A PHONE is its digits: Thai digits and +66 read as the number they are", () => {
  assert.equal(usablePhone("๐๘๑๒๓๔๕๖๗๘"), "0812345678");
  assert.equal(usablePhone("+66 81 234 5678"), "0812345678");
  assert.equal(usablePhone(`081${ZWSP}234 5678`), "0812345678");
  assert.deepEqual(matchTypedCustomer("คุณป้อม", "+66 82 222 2222", [pom1, pom2]), { kind: "same", id: "pom-2" });
});

test("EVERY REFUSAL SAYS THE WAY OUT", () => {
  const msg = (reason: "no-phone" | "phoneless-twin" | "twins" | "phone-as-name", sameName = 1) =>
    ambiguousCustomerMessage("พี่ไก่", { kind: "ambiguous", sameName, reason });
  assert.match(msg("no-phone", 2), /2 ราย.*เลือกจากรายการ.*ใส่เบอร์โทรของลูกค้าใหม่/);
  assert.match(msg("phoneless-twin"), /ยังไม่มีเบอร์โทรในระบบ.*ตั้งชื่อให้ต่างกัน/);
  assert.match(msg("twins", 2), /ใช้เบอร์นี้อยู่แล้ว 2 ราย/);
  assert.match(msg("phone-as-name", 0), /ช่องนี้เป็นชื่อลูกค้า/);
});

test("WHAT THE SCREEN SAYS before a typed name is saved — and that the booking moves only when it does", () => {
  assert.match(typedCustomerHint({ kind: "new", sameName: 0 }, "คุณนก", null), /^ลูกค้าใหม่/);
  assert.match(typedCustomerHint({ kind: "new", sameName: 1 }, "คุณป้อม", null), /คนละเบอร์/);
  assert.match(typedCustomerHint({ kind: "same", id: "pom-1" }, "คุณป้อม", null), /ชื่อและเบอร์โทรเดียวกัน/);
  const ambiguous = { kind: "ambiguous", sameName: 2, reason: "no-phone" } as const;
  assert.equal(typedCustomerHint(ambiguous, "คุณป้อม", null), ambiguousCustomerMessage("คุณป้อม", ambiguous));
  // The booking's own customer found again does not "replace" anyone; another one does.
  assert.doesNotMatch(typedCustomerHint({ kind: "same", id: "pom-1" }, "คุณป้อม", "pom-1"), /แทนลูกค้าเดิม/);
  assert.match(typedCustomerHint({ kind: "same", id: "pom-2" }, "คุณป้อม", "pom-1"), /แทนลูกค้าเดิม/);
  assert.match(typedCustomerHint({ kind: "new", sameName: 0 }, "คุณป้อมม", "pom-1"), /ลูกค้าเดิม/);
  assert.doesNotMatch(typedCustomerHint({ kind: "new", sameName: 0 }, "คุณนก", null), /ลูกค้าเดิม/);
});
