// Run: npm test
//
// Every case here is drawn from the real 22,711-delivery dataset, not invented.
// This module decides what an ingredient costs, and ingredient cost feeds every
// dish cost, margin and Menu Engineering figure in the system.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  priceFromDeliveries,
  dropOutliers,
  detectUnitRedefinition,
  median,
  NON_FOOD_MATERIALS,
  type PricingDelivery,
} from "./pos-pricing.ts";

const d = (
  documentDate: string,
  vendorName: string,
  unitName: string,
  qty: number,
  totalCostIncVat: number,
): PricingDelivery => ({ documentDate, vendorName, unitName, qty, totalCostIncVat });

// ── median ──────────────────────────────────────────────────────────────────
test("median: odd and even lengths", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
});

// ── the gap filter ──────────────────────────────────────────────────────────
test("gap filter: keeps the LARGEST cluster, not the newest — the ข้าวคั่ว case", () => {
  // 25/25/25 from June–July, then 50 on 24 Aug. Newest-wins kept the single
  // ฿50 and priced the ingredient +100% off one observation.
  const pool = [
    d("2026-06-13", "พี่ไหน", "ถุง(500g)", 1, 25),
    d("2026-06-28", "พี่ไหน", "ถุง(500g)", 1, 25),
    d("2026-07-27", "พี่ไหน", "ถุง(500g)", 1, 25),
    d("2026-08-24", "พี่ไหน", "ถุง(500g)", 1, 50),
  ];
  const { kept, dropped } = dropOutliers(pool);
  assert.equal(kept.length, 3);
  assert.equal(dropped, 1);
  assert.equal(median(kept.map((x) => x.totalCostIncVat / x.qty)), 25);
});

test("gap filter: still drops the หอยแมลงภู่ ฿2,750 anomalies", () => {
  const pool = [
    ...Array.from({ length: 9 }, (_, i) => d(`2026-07-0${(i % 9) + 1}`, "แมคโคร", "ลัง(แซนฟอร์ด)", 5, 1345)),
    d("2026-06-03", "แมคโคร", "ลัง(แซนฟอร์ด)", 1, 2750),
    d("2026-06-16", "แมคโคร", "ลัง(แซนฟอร์ด)", 1, 2750),
  ];
  const { kept, dropped } = dropOutliers(pool);
  assert.equal(dropped, 2);
  assert.equal(median(kept.map((x) => x.totalCostIncVat / x.qty)), 269);
});

test("gap filter: leaves a pool with no 2x jump alone", () => {
  const pool = [
    d("2026-07-01", "v", "โล", 1, 100),
    d("2026-07-02", "v", "โล", 1, 120),
    d("2026-07-03", "v", "โล", 1, 150),
  ];
  assert.equal(dropOutliers(pool).dropped, 0);
});

test("gap filter: on an exact size tie, the newest cluster wins", () => {
  const pool = [
    d("2026-07-01", "v", "โล", 1, 10),
    d("2026-07-02", "v", "โล", 1, 10),
    d("2026-08-01", "v", "โล", 1, 100),
    d("2026-08-02", "v", "โล", 1, 100),
  ];
  const { kept } = dropOutliers(pool);
  assert.equal(kept[0]!.totalCostIncVat, 100);
});

// ── the escalating fallback ─────────────────────────────────────────────────
test("step 1: dominant vendor and its dominant unit", () => {
  const r = priceFromDeliveries([
    d("2026-07-01", "ตลาดสี่มุมเมือง", "โล", 1, 60),
    d("2026-07-02", "ตลาดสี่มุมเมือง", "โล", 1, 55),
    d("2026-07-03", "ตลาดสี่มุมเมือง", "โล", 1, 65),
    d("2026-07-04", "พี่แจ๋ว", "โล", 1, 200),
  ])!;
  assert.equal(r.rule, "dominant-vendor");
  assert.equal(r.vendorName, "ตลาดสี่มุมเมือง");
  assert.equal(r.price, 60);
  assert.equal(r.poolSize, 3);
});

test("step 2: falls back to all vendors when the dominant vendor is thin", () => {
  const r = priceFromDeliveries([
    d("2026-07-01", "A", "โล", 1, 10),
    d("2026-07-02", "A", "โล", 1, 12),
    d("2026-07-03", "B", "โล", 1, 11),
    d("2026-07-04", "C", "โล", 1, 13),
  ])!;
  // A leads 2-1-1 but has only 2 rows; the all-vendor โล pool has 4.
  assert.equal(r.rule, "all-vendor");
  assert.equal(r.poolSize, 4);
});

test("step 3: a single delivery falls through to latest-delivery", () => {
  const r = priceFromDeliveries([d("2026-08-24", "ศักดิ์สิทธ์", "โล", 1, 280)])!;
  assert.equal(r.rule, "latest-delivery");
  assert.equal(r.price, 280);
  assert.equal(r.poolSize, 1);
});

test("latest-delivery sums every delivery on the newest date", () => {
  const r = priceFromDeliveries([
    d("2026-08-24", "v", "โล", 2, 100),
    d("2026-08-24", "v", "โล", 3, 200),
    d("2026-01-01", "v", "โล", 1, 999),
  ])!;
  assert.equal(r.rule, "latest-delivery");
  assert.equal(r.price, 60); // 300 / 5
});

// ── vendor selection ────────────────────────────────────────────────────────
test('blank vendor "" wins when it dominates — the มะม่วง case', () => {
  const r = priceFromDeliveries([
    d("2026-07-01", "", "โล", 1, 120),
    d("2026-07-02", "", "โล", 1, 120),
    d("2026-07-03", "", "โล", 1, 130),
    d("2026-07-04", "ตลาดสี่มุมเมือง", "โล", 1, 90),
  ])!;
  assert.equal(r.vendorName, "");
  assert.equal(r.rule, "dominant-vendor");
});

test("a vendor tie is broken by the most recent delivery", () => {
  const r = priceFromDeliveries([
    d("2026-07-01", "OLD", "โล", 1, 10),
    d("2026-07-02", "OLD", "โล", 1, 10),
    d("2026-08-01", "NEW", "โล", 1, 20),
    d("2026-08-02", "NEW", "โล", 1, 20),
  ])!;
  assert.equal(r.vendorName, "NEW");
});

test("unsettled flag fires when the top two vendors are within 10%", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => d(`2026-07-${10 + i}`, "A", "โล", 1, 10)),
    ...Array.from({ length: 10 }, (_, i) => d(`2026-07-${20 + i}`, "B", "โล", 1, 20)),
  ];
  assert.equal(priceFromDeliveries(rows)!.vendorUnsettled, true);
});

test("unsettled flag stays off when one vendor clearly leads", () => {
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => d(`2026-07-${10 + i}`, "A", "โล", 1, 10)),
    d("2026-07-01", "B", "โล", 1, 20),
  ];
  assert.equal(priceFromDeliveries(rows)!.vendorUnsettled, false);
});

test("catch-all vendor is reported so a non-food bucket can be caught later", () => {
  const rows = Array.from({ length: 3 }, (_, i) => d(`2026-07-0${i + 1}`, "กลุ่มอื่นๆ", "หน่วย", 1, 7371));
  assert.equal(priceFromDeliveries(rows)!.catchAllVendor, true);
});

// ── guards ──────────────────────────────────────────────────────────────────
test("qty <= 0 rows are ignored, and an all-bad input returns null", () => {
  assert.equal(priceFromDeliveries([]), null);
  assert.equal(priceFromDeliveries([d("2026-07-01", "v", "โล", 0, 100)]), null);
  const r = priceFromDeliveries([
    d("2026-07-01", "v", "โล", 0, 999),
    d("2026-07-02", "v", "โล", 1, 50),
  ])!;
  assert.equal(r.price, 50);
});

test("zero cost is kept — free goods and corrections genuinely occur", () => {
  const r = priceFromDeliveries([
    d("2026-07-01", "v", "โล", 1, 0),
    d("2026-07-02", "v", "โล", 1, 0),
    d("2026-07-03", "v", "โล", 1, 0),
  ])!;
  assert.equal(r.price, 0);
});

// ── unit redefinition ───────────────────────────────────────────────────────
test("detects the หอยแมลงภู่ 10x redefinition", () => {
  const r = detectUnitRedefinition(2750, 269);
  assert.equal(r.suspected, true);
  if (r.suspected) assert.equal(r.packCount, 10);
});

test("detects a 2x redefinition, which no move-size floor would catch cheaply", () => {
  const r = detectUnitRedefinition(12, 24);
  assert.equal(r.suspected, true);
  if (r.suspected) assert.equal(r.packCount, 2);
});

test("does NOT fire on ordinary price movements", () => {
  for (const [cur, prop] of [[100, 150], [40, 60], [115, 167.5], [85, 125], [60, 35]]) {
    assert.equal(detectUnitRedefinition(cur!, prop!).suspected, false, `${cur} -> ${prop}`);
  }
});

test("does not fire on a ratio that is near an integer but off by more than 5%", () => {
  assert.equal(detectUnitRedefinition(100, 215).suspected, false); // 2.15x
  assert.equal(detectUnitRedefinition(100, 189).suspected, false); // 1.89x
});

test("fires within the 5% tolerance in both directions", () => {
  assert.equal(detectUnitRedefinition(100, 196).suspected, true); // 1.96 -> 2
  assert.equal(detectUnitRedefinition(100, 204).suspected, true); // 2.04 -> 2
});

test("no current price means nothing to compare, so no suspicion", () => {
  assert.equal(detectUnitRedefinition(null, 269).suspected, false);
  assert.equal(detectUnitRedefinition(0, 269).suspected, false);
});

// ── denylist ────────────────────────────────────────────────────────────────
test("the denylist covers every catch-all found in the data", () => {
  for (const n of ["ค่าขนส่งวัตถุดิบ", "วัตถุดิบอื่นๆ", "วัตถุดิบทดลอง", "ของไหว้อื่นๆ", "น้ำทะเล"]) {
    assert.ok(NON_FOOD_MATERIALS.has(n), n);
  }
  assert.equal(NON_FOOD_MATERIALS.has("ปลากระพง (ญ)"), false);
});
