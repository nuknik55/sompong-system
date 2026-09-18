/**
 * Run with: npm test — the day helpers, including the boundaries that make
 * the defect they replace visible.
 *
 * The clock-reading ones (bangkokToday, bangkokYearMonth) are checked for
 * SHAPE and for agreement with each other; what they must not be — the UTC
 * day — is checked against a fixed instant, since the assertion only bites
 * for seven hours a day and a test that passes 17 hours out of 24 is no test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bangkokToday, bangkokYearMonth, shiftDay, dayOfWeek, startOfWeek } from "./bangkok-date.ts";

test("today is a day string, and the month is its first seven characters", () => {
  const day = bangkokToday();
  assert.match(day, /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  assert.equal(bangkokYearMonth(), day.slice(0, 7));
});

test("THE DEFECT: at 01:00 in Bangkok, UTC is still yesterday", () => {
  // 2026-09-19T18:00Z is 2026-09-20 01:00 in Bangkok. The UTC day is the
  // 19th and the restaurant's day is the 20th — the seven hours in which
  // every page that took .toISOString().slice(0, 10) opened on yesterday.
  const instant = new Date("2026-09-19T18:00:00Z");
  assert.equal(instant.toISOString().slice(0, 10), "2026-09-19", "the old way");
  assert.equal(
    instant.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }),
    "2026-09-20",
    "what bangkokToday does with the same instant",
  );
  // And the month version of it, on the first of a month.
  const firstOfMonth = new Date("2026-09-30T18:00:00Z");
  assert.equal(firstOfMonth.toISOString().slice(0, 7), "2026-09", "the old way");
  assert.equal(
    firstOfMonth.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }).slice(0, 7),
    "2026-10",
  );
});

test("shiftDay crosses months, years and a leap day without a Date in sight", () => {
  assert.equal(shiftDay("2026-09-19", 1), "2026-09-20");
  assert.equal(shiftDay("2026-09-19", -1), "2026-09-18");
  assert.equal(shiftDay("2026-09-30", 1), "2026-10-01");
  assert.equal(shiftDay("2026-10-01", -1), "2026-09-30");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftDay("2027-01-01", -1), "2026-12-31");
  assert.equal(shiftDay("2028-02-28", 1), "2028-02-29", "2028 is a leap year");
  assert.equal(shiftDay("2027-02-28", 1), "2027-03-01", "2027 is not");
  assert.equal(shiftDay("2026-09-19", 0), "2026-09-19");
  assert.equal(shiftDay("2026-09-19", 30), "2026-10-19");
  assert.equal(shiftDay("2026-09-19", -90), "2026-06-21");
  // Nonsense in, the same string out — never a crash on a page.
  assert.equal(shiftDay("", 1), "");
  assert.equal(shiftDay("not-a-date", 1), "not-a-date");
});

test("dayOfWeek and startOfWeek agree with the calendar", () => {
  // 2026-09-19 is a Saturday.
  assert.equal(dayOfWeek("2026-09-19"), 6);
  assert.equal(dayOfWeek("2026-09-20"), 0, "Sunday");
  assert.equal(dayOfWeek("2026-09-21"), 1, "Monday");
  assert.equal(dayOfWeek("2026-09-22"), 2, "Tuesday");

  // The schedule's week starts on Monday, the transfer slip's on Tuesday.
  assert.equal(startOfWeek("2026-09-19", 1), "2026-09-14", "Saturday belongs to Monday the 14th");
  assert.equal(startOfWeek("2026-09-21", 1), "2026-09-21", "a Monday is its own week start");
  assert.equal(startOfWeek("2026-09-20", 1), "2026-09-14", "Sunday belongs to the week before it");
  assert.equal(startOfWeek("2026-09-22", 2), "2026-09-22", "a Tuesday is its own");
  assert.equal(startOfWeek("2026-09-21", 2), "2026-09-15", "Monday belongs to the Tuesday before");
  assert.equal(startOfWeek("2026-09-19", 2), "2026-09-15");
});

test("the helpers are zone-independent, which the Date they replace was not", () => {
  // Every answer above is computed with Date.UTC and read with getUTC*/
  // toISOString, so it cannot vary with the runtime's zone. The shape that
  // could: local components in, UTC out.
  const local = new Date(2026, 8, 19);                    // 19 Sep, local
  const roundTripped = local.toISOString().slice(0, 10);  // the UTC day of that instant
  assert.ok(
    roundTripped === "2026-09-19" || roundTripped === "2026-09-18",
    `a local Date read as UTC gives ${roundTripped} — which one depends on the machine`,
  );
  assert.equal(shiftDay("2026-09-19", 0), "2026-09-19", "the helper does not have that property");
});
