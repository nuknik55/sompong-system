// Run: npm test
//
// The discount classification decides how much of a month’s discount is
// booked as an expense. It is driven by POS promotion NAMES, which change as
// campaigns come and go, so these tests reconcile to the baht against the two
// real months rather than testing invented shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPosExportPlausibility, splitPosDiscounts, type PosMonthlyExport, type PosSalesLine } from "./pos-parse.ts";
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

// ─── checkPosExportPlausibility ─────────────────────────────────────────────
//
// Synthetic reports only. The data-layer check — every SaleData_*.xls on disk,
// 24 genuine exports passing and 12 refused each on a named rule — is run by
// hand because those files live outside the repo.

function plausibleLine(over: Partial<PosSalesLine> = {}): PosSalesLine {
  return { saleMode: "Eat In", group: "อาหาร", category: "", productName: "ข้าวผัด", qty: 2, unitPrice: 50, gross: 100, discount: 0, net: 100, ...over };
}

function plausibleReport(over: Partial<PosMonthlyExport> = {}): PosMonthlyExport {
  return {
    dateFrom: "สิงหาคม 2569",
    dateTo: "สิงหาคม 2569",
    lines: [plausibleLine(), plausibleLine({ productName: "ชานม", qty: 1, gross: 50, net: 50 })],
    grossTotal: 150,
    discountTotal: 0,
    netTotal: 150,
    discounts: [],
    payments: [{ method: "Cash", amount: 150, platformFee: 0, actual: 150 }],
    customerCount: 3,
    billCount: 2,
    cancelledBills: 0,
    cancelledAmount: 0,
    ...over,
  };
}

test("a genuine-shaped export passes", () => {
  assert.equal(checkPosExportPlausibility(plausibleReport()), null);
});

test("rule 1: no period, no Sheet3 total, or no Sheet2 total → not a POS export", () => {
  for (const over of [{ dateFrom: "" }, { grossTotal: 0 }, { netTotal: 0 }] as Partial<PosMonthlyExport>[]) {
    const why = checkPosExportPlausibility(plausibleReport(over));
    assert.match(why ?? "", /ไม่ใช่ไฟล์ที่ export จาก POS/);
    assert.match(why ?? "", /69-MMSaleData.xlsx/);
  }
});

test("rule 2: totals present but Sheet1 empty → re-export, not wrong file", () => {
  const why = checkPosExportPlausibility(plausibleReport({ lines: [] }));
  assert.match(why ?? "", /แผ่นที่ 1 ไม่มีรายการสินค้า/);
  assert.doesNotMatch(why ?? "", /ไม่ใช่ไฟล์ที่ export จาก POS/);
});

test("rule 3: every line zero → refused; some zero lines → fine (August has 19 free items)", () => {
  const allZero = plausibleReport({ lines: [plausibleLine({ qty: 0, gross: 0, net: 0 })] });
  assert.match(checkPosExportPlausibility(allZero) ?? "", /เป็นศูนย์ทั้งหมด/);
  const someZero = plausibleReport({
    lines: [plausibleLine(), plausibleLine({ productName: "ฟรี", qty: 1, gross: 0, net: 0 })],
    grossTotal: 100,
    netTotal: 100,
    payments: [{ method: "Cash", amount: 100, platformFee: 0, actual: 100 }],
  });
  assert.equal(checkPosExportPlausibility(someZero), null);
});

test("rule 4: Sheet1 gross ≠ Sheet3 header beyond ฿1 → refused with both figures; ฿1 rounding passes", () => {
  const why = checkPosExportPlausibility(plausibleReport({ grossTotal: 1500 }));
  assert.match(why ?? "", /150/);
  assert.match(why ?? "", /1,500/);
  assert.equal(checkPosExportPlausibility(plausibleReport({ grossTotal: 150.6 })), null);
});

test("rule 5: Sheet2 payments ≠ Sheet2 net → refused", () => {
  const why = checkPosExportPlausibility(plausibleReport({ payments: [{ method: "Cash", amount: 100, platformFee: 0, actual: 100 }] }));
  assert.match(why ?? "", /แผ่นที่ 2/);
});

test("order: rule 1 wins over rules 2 and 3 when several apply", () => {
  // The hand-built file: one zero line, no period, no totals. Rule 1 is the
  // sentence that sends Nik back to the POS.
  const nik = plausibleReport({ dateFrom: "", grossTotal: 0, netTotal: 0, lines: [plausibleLine({ qty: 0, gross: 0, net: 0 })], payments: [] });
  assert.match(checkPosExportPlausibility(nik) ?? "", /ไม่ใช่ไฟล์ที่ export จาก POS/);
  // A browser save: nothing at all. Still rule 1, not "empty Sheet1".
  const save = plausibleReport({ dateFrom: "", grossTotal: 0, netTotal: 0, lines: [], payments: [] });
  assert.match(checkPosExportPlausibility(save) ?? "", /ไม่ใช่ไฟล์ที่ export จาก POS/);
});
