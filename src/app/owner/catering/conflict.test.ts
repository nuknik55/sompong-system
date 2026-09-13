/**
 * Run with: npm test — the room-conflict rule, client and server both import
 * this module, so these cases cover both sides at once.
 *
 * First test file this module has ever had, written the day the verification
 * pass proved it needed one: the midnight-crossing case below shipped broken
 * and no test existed to catch it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findRoomConflict, ROOM_CONFLICTS, type RoomConflictCandidate } from "./conflict.ts";

const cand = (venue: string, start: string | null, end: string | null): RoomConflictCandidate => ({
  id: "x", customer_name: "A", venue, start_time: start, end_time: end,
});
const hit = (venue: string, s: string | null, e: string | null, c: RoomConflictCandidate) =>
  findRoomConflict(venue, s, e, [c]) !== null;

test("same room, overlapping times conflict", () => {
  assert.equal(hit("room_v1", "12:00", "15:00", cand("room_v1", "14:00", "18:00")), true);
});

test("back-to-back bookings do not conflict — half-open by design", () => {
  assert.equal(hit("room_v1", "14:00", "18:00", cand("room_v1", "10:00", "14:00")), false);
});

test("disjoint times in the same room do not conflict", () => {
  assert.equal(hit("room_v1", "10:00", "12:00", cand("room_v1", "14:00", "18:00")), false);
});

test("missing times on either side conflict conservatively", () => {
  // Early-stage inquiries often have no times; missing data must not hide a
  // real double-booking.
  assert.equal(hit("room_v1", null, null, cand("room_v1", null, null)), true);
  assert.equal(hit("room_v1", "18:00", "20:00", cand("room_v1", null, null)), true);
  assert.equal(hit("room_v1", null, null, cand("room_v1", "18:00", "20:00")), true);
});

test("the combined room blocks its halves, and each half blocks the combined", () => {
  assert.equal(hit("room_v1", "12:00", "15:00", cand("room_v1_v2", "12:00", "15:00")), true);
  assert.equal(hit("room_v1_v2", "12:00", "15:00", cand("room_v2", "12:00", "15:00")), true);
});

test("the two halves do not block each other", () => {
  assert.equal(hit("room_v1", "12:00", "15:00", cand("room_v2", "12:00", "15:00")), false);
});

test("air_shared and offsite never conflict — not exclusive rooms", () => {
  assert.equal(ROOM_CONFLICTS["air_shared"], undefined);
  assert.equal(ROOM_CONFLICTS["offsite"], undefined);
  assert.equal(hit("air_shared", "12:00", "15:00", cand("air_shared", "12:00", "15:00")), false);
});

test("Postgres TIME with seconds compares the same as HH:MM", () => {
  assert.equal(hit("room_v1", "12:00", "15:00", cand("room_v1", "14:00:00", "18:00:00")), true);
});

// ── Midnight-crossing: the case the verification pass found broken ─────────

test("a 22:00-01:00 party holds the room for a 23:00-23:30 booking", () => {
  // Shipped broken: end < start compared as raw strings was an EMPTY
  // interval, and the party's tail was invisible to both client and server.
  assert.equal(hit("room_v1", "23:00", "23:30", cand("room_v1", "22:00", "01:00")), true);
});

test("the clamp works from my side too, not only the candidate's", () => {
  assert.equal(hit("room_v1", "22:00", "01:00", cand("room_v1", "23:00", "23:30")), true);
});

test("a midnight-crossing booking still leaves the morning free", () => {
  // Clamped to END OF DAY on its own event_date: the after-midnight tail on
  // the next date is deliberately unmodelled (one event_date per booking),
  // and the morning BEFORE it starts was never held at all.
  assert.equal(hit("room_v1", "10:00", "12:00", cand("room_v1", "22:00", "01:00")), false);
});

test("end equal to start clamps to end-of-day too — per the stated rule, end <= start", () => {
  // A zero-length booking is a data-entry oddity; reading it as
  // start-to-close is the conservative side, like the missing-times rule.
  assert.equal(hit("room_v1", "19:00", "20:00", cand("room_v1", "18:00", "18:00")), true);
});
