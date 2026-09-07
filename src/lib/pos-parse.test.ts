// Run: npm test
//
// The discount classification decides how much of a month’s discount is
// booked as an expense. It is driven by POS promotion NAMES, which change as
// campaigns come and go, so these tests reconcile to the baht against the two
// real months rather than testing invented shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPosDiscounts } from "./pos-parse.ts";
// ─── splitPosDiscounts ─────────────────────────────────────────────────────
// Fixtures are the real Sheet3 contents of the July and August 2569 exports,
// verbatim. They are here rather than as sample files because the whole point
// is the LINE NAMES: the classification is driven by them, and new promotion
// names will appear over time. A test that reconciles to the baht is what
// catches a new name landing in the wrong bucket.

const JULY_DISCOUNTS = [
  { name: "ส่วนลดค่าอาหาร 10% VIP Member", amount: 31844 },
  { name: "ส่วนลดอาหาร 20%", amount: 27725 },
  { name: "ส่วนลดอาหาร 10%", amount: 22023 },
  { name: '120 พ้อยท์ "หอยเชลล์อบชีส" 1 ที่', amount: 1200 },
  { name: "ฟรีไอติมข้าวเหนียวมะม่วง", amount: 774 },
  { name: '150 พ้อยท์ "ต้มยำเนื้อปลาเก๋า" 1 ที่', amount: 700 },
  { name: '80 พ้อยท์ "ปีกไก่ทอดเกลือ" 1 ที่', amount: 540 },
  { name: "Other Discount", amount: 469 },
  { name: "น้ำร้านกาแฟพนักงาน(50%)", amount: 416 },
  { name: "ส่วนลดอาหาร 5%", amount: 251.5 },
  { name: '100 พ้อยท์ "กุ้งแช่น้ำปลา" 1 ที่', amount: 220 },
  { name: '60 พอยท์ "ข้าวผัดกุ้ง" 1 จาน', amount: 160 },
  { name: "GPLineMan", amount: 160 },
  { name: "Birthday My Vip Member", amount: 47.5 },
];

const AUGUST_DISCOUNTS = [
  { name: "ส่วนลดค่าอาหาร 10% VIP Member", amount: 38180.5 },
  { name: "ส่วนลดอาหาร 20%", amount: 31161 },
  { name: "ส่วนลดอาหาร 10%", amount: 29971 },
  { name: '150 พ้อยท์ "ต้มยำกุ้งมะพร้าวอ่อน" 1 ที่', amount: 2450 },
  { name: "Other Discount", amount: 1241 },
  { name: '120 พ้อยท์ "หอยเชลล์อบชีส" 1 ที่', amount: 1200 },
  { name: '100 พ้อยท์ "ยำตะไคร้กุ้งสด" 1 ที่', amount: 880 },
  { name: "ส่วนลดอาหาร 5%", amount: 679 },
  { name: "ฟรีไอติมข้าวเหนียวมะม่วง", amount: 645 },
  { name: '80 พ้อยท์ "ราดหน้าทะเล" 1 ที่', amount: 360 },
  { name: '100 พ้อยท์ "หมูผัดกะปิ" 1 ที่', amount: 200 },
  { name: "น้ำร้านกาแฟพนักงาน(50%)", amount: 193 },
  { name: "Birthday My Vip Member", amount: 34.5 },
];

test("July reconciles to the baht against the bookkeeper's own figures", () => {
  const s = splitPosDiscounts(JULY_DISCOUNTS);
  // These two are the numbers in Nik's spreadsheet, matched exactly.
  assert.equal(s.discount, 81843.5);
  assert.equal(s.crmRaw, 3641.5);
  assert.equal(s.excluded, 1045);
  assert.equal(s.total, 86530); // รวมส่วนลด on Sheet3
  assert.equal(s.discount + s.crmRaw + s.excluded, s.total);
});

test("August reconciles to the baht", () => {
  const s = splitPosDiscounts(AUGUST_DISCOUNTS);
  assert.equal(s.discount, 99991.5);
  assert.equal(s.crmRaw, 5769.5);
  assert.equal(s.excluded, 1434);
  assert.equal(s.total, 107195);
  assert.equal(s.discount + s.crmRaw + s.excluded, s.total);
});

test("CRM is booked at half, and that is deliberate", () => {
  // Nik's own July spreadsheet (budget69 AN136) records 3,642 un-halved and
  // should read 1,821. The import will disagree with that cell on purpose.
  assert.equal(splitPosDiscounts(JULY_DISCOUNTS).crmBooked, 1820.75);
  assert.equal(splitPosDiscounts(AUGUST_DISCOUNTS).crmBooked, 2884.75);
});

test("neither real month leaves anything unclassified", () => {
  assert.equal(splitPosDiscounts(JULY_DISCOUNTS).unclassified.length, 0);
  assert.equal(splitPosDiscounts(AUGUST_DISCOUNTS).unclassified.length, 0);
});

test("an unrecognised promotion is surfaced, never silently bucketed", () => {
  // The failure this guards against: a new campaign name defaults into a
  // bucket, changes the booked discount, and nothing says so. It must land in
  // `unclassified` and be counted in `total` but in no bucket.
  const s = splitPosDiscounts([
    { name: "ส่วนลดอาหาร 20%", amount: 100 },
    { name: "Songkran Special 2570", amount: 999 },
  ]);
  assert.equal(s.discount, 100);
  assert.equal(s.crmRaw, 0);
  assert.equal(s.excluded, 0);
  assert.equal(s.unclassified.length, 1);
  assert.equal(s.unclassified[0].name, "Songkran Special 2570");
  assert.equal(s.total, 1099);
});

test("both พ้อยท์ and พอยท์ spellings count as CRM", () => {
  // July's export contains both spellings. A rule matching only one would
  // silently move 160 baht into unclassified.
  const s = splitPosDiscounts([
    { name: '120 พ้อยท์ "x" 1 ที่', amount: 10 },
    { name: '60 พอยท์ "y" 1 จาน', amount: 20 },
  ]);
  assert.equal(s.crmRaw, 30);
  assert.equal(s.unclassified.length, 0);
});

test("GPLineMan is excluded, and its absence is not an error", () => {
  // July has a GPLineMan line; August does not. The exclusion list must
  // tolerate a member being absent.
  assert.equal(splitPosDiscounts([{ name: "GPLineMan", amount: 160 }]).excluded, 160);
  assert.equal(splitPosDiscounts(AUGUST_DISCOUNTS).unclassified.length, 0);
});
