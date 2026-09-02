// Run: npm test   (node:test + Node's native TS type-stripping, no deps)
//
// These cover the validator rather than the parser, because this is the layer
// that decides what a browser is allowed to write into pos_receipt_deliveries.
// A hole here writes bad cost history that later looks like real deliveries.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDeliveryRow,
  validateChunk,
  MAX_ROWS_PER_CHUNK,
} from "./pos-delivery-validation.ts";

const TODAY = new Date("2026-08-31T00:00:00Z");

const valid = () => ({
  materialCode: "GR102-1",
  materialName: "ปลากระพง (ล)",
  documentNumber: "001DR042568/000323",
  documentDate: "2025-04-23",
  vendorName: "ผู้ใหญ่เก่ง",
  unitName: "ตัว",
  qty: 10,
  totalCostIncVat: 1692,
  totalCostExcVat: 1692,
});

test("accepts a real delivery row", () => {
  assert.equal(validateDeliveryRow(valid(), TODAY), null);
});

test("accepts an empty vendorName — it is a genuine identity in this data", () => {
  assert.equal(validateDeliveryRow({ ...valid(), vendorName: "" }, TODAY), null);
});

test("accepts zero cost — free goods and corrections occur", () => {
  assert.equal(validateDeliveryRow({ ...valid(), totalCostIncVat: 0, totalCostExcVat: 0 }, TODAY), null);
});

test("accepts fractional qty — 1,986 of 20,109 backfilled rows had one", () => {
  assert.equal(validateDeliveryRow({ ...valid(), qty: 0.25 }, TODAY), null);
});

test("rejects a negative cost", () => {
  assert.match(String(validateDeliveryRow({ ...valid(), totalCostIncVat: -1 }, TODAY)), /ราคารวม VAT/);
});

test("rejects qty of zero and below", () => {
  for (const qty of [0, -1]) {
    assert.notEqual(validateDeliveryRow({ ...valid(), qty }, TODAY), null, `qty ${qty} should be rejected`);
  }
});

test("rejects a missing or blank required field", () => {
  for (const field of ["materialCode", "materialName", "documentNumber", "unitName"]) {
    assert.notEqual(validateDeliveryRow({ ...valid(), [field]: "" }, TODAY), null, `blank ${field}`);
    assert.notEqual(validateDeliveryRow({ ...valid(), [field]: undefined }, TODAY), null, `missing ${field}`);
  }
});

test("rejects a non-ISO date, including the report's own Buddhist-era format", () => {
  for (const documentDate of ["23/04/2025", "2568-04-23T00:00:00", "01 เมษายน 2569", "", "not a date"]) {
    assert.notEqual(validateDeliveryRow({ ...valid(), documentDate }, TODAY), null, documentDate);
  }
});

test("rejects a Buddhist-era year that slipped through unconverted", () => {
  // 2568 would otherwise be a syntactically valid ISO date in the far future.
  assert.match(String(validateDeliveryRow({ ...valid(), documentDate: "2568-04-23" }, TODAY)), /อนาคต/);
});

test("rejects a date before the POS rollout", () => {
  assert.match(String(validateDeliveryRow({ ...valid(), documentDate: "2019-12-31" }, TODAY)), /2020-01-01/);
});

test("allows tomorrow, because Bangkok is a day ahead of a UTC server in the evening", () => {
  assert.equal(validateDeliveryRow({ ...valid(), documentDate: "2026-09-01" }, TODAY), null);
  assert.notEqual(validateDeliveryRow({ ...valid(), documentDate: "2026-09-02" }, TODAY), null);
});

test("rejects a non-object row", () => {
  for (const row of [null, undefined, 42, "row", []]) {
    assert.notEqual(validateDeliveryRow(row, TODAY), null, String(row));
  }
});

test("rejects an over-long string rather than letting the DB truncate or error", () => {
  assert.notEqual(validateDeliveryRow({ ...valid(), materialName: "x".repeat(201) }, TODAY), null);
});

test("chunk: accepts a good chunk and returns the rows", () => {
  const result = validateChunk([valid(), valid()], TODAY);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.rows.length, 2);
});

test("chunk: rejects the WHOLE chunk on one bad row, naming the row", () => {
  const result = validateChunk([valid(), { ...valid(), qty: -5 }, valid()], TODAY);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /แถวที่ 2/);
});

test("chunk: rejects empty, oversized, and non-array payloads", () => {
  assert.equal(validateChunk([], TODAY).ok, false);
  assert.equal(validateChunk("nope", TODAY).ok, false);
  const tooMany = Array.from({ length: MAX_ROWS_PER_CHUNK + 1 }, valid);
  assert.equal(validateChunk(tooMany, TODAY).ok, false);
});

test("chunk: accepts exactly the maximum size", () => {
  const exact = Array.from({ length: MAX_ROWS_PER_CHUNK }, valid);
  assert.equal(validateChunk(exact, TODAY).ok, true);
});
