/**
 * Run with: npm test — the one on-screen date format (thai-date.ts).
 *
 * The timestamp cases are fixed instants, not the clock, so they bite at
 * every hour: 18:30 UTC on the 17th is 01:30 on the 18th in Bangkok, and a
 * formatter that read the UTC day would say 17.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { thaiDate, thaiDateWithDay, thaiDateTime, thaiDayMonth } from "./thai-date.ts";

test("a calendar date is shown as written, in the Buddhist year", () => {
  assert.equal(thaiDate("2026-09-18"), "18/9/2569");
  assert.equal(thaiDate("2026-01-05"), "5/1/2569");
  assert.equal(thaiDate("2025-12-31"), "31/12/2568");
});

test("the day of the week, as the booking list shows it", () => {
  assert.equal(thaiDateWithDay("2026-09-18"), "ศ 18/9/2569"); // a Friday
  assert.equal(thaiDateWithDay("2026-09-20"), "อา 20/9/2569"); // a Sunday
});

test("a timestamp is read in Bangkok, not in UTC", () => {
  const lateUtc = "2026-09-17T18:30:00Z"; // 01:30 on the 18th in Bangkok
  assert.equal(thaiDate(lateUtc), "18/9/2569");
  assert.equal(thaiDateTime(lateUtc), "18/9/2569 01:30");
  assert.equal(thaiDateWithDay(lateUtc), "ศ 18/9/2569");
  assert.equal(thaiDate(new Date(lateUtc)), "18/9/2569");
  assert.equal(thaiDateTime("2026-09-18T07:05:00+07:00"), "18/9/2569 07:05");
});

test("a calendar date is never shifted by a zone", () => {
  // Parsed as a date, "2026-09-18" would be midnight UTC; the day must stay 18.
  assert.equal(thaiDate("2026-09-18"), "18/9/2569");
  assert.equal(thaiDayMonth("2026-09-01"), "1/9");
});

test("empty shows a dash; an unreadable value shows as it came", () => {
  assert.equal(thaiDate(null), "–");
  assert.equal(thaiDate(undefined), "–");
  assert.equal(thaiDate(""), "–");
  assert.equal(thaiDate("not a date"), "not a date");
  assert.equal(thaiDate("2026-13-40"), "2026-13-40");
});
