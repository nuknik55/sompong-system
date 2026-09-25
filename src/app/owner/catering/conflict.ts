// Room-conflict rule, shared between the client-side check (EventFormModal in
// shared.tsx, a "use client" file) and the server-side enforcement
// (upsertCateringEvent in actions.ts, a "use server" file). Deliberately no
// "use client"/"use server" directive here — a "use server" file may only
// export async functions, and this logic is pure and synchronous — so it
// lives in its own plain module both sides can import directly, instead of
// being duplicated.

export type RoomConflictCandidate = {
  id: string;
  customer_name: string | null;
  venue: string;
  start_time: string | null;
  end_time: string | null;
};

// Only exclusive rooms can conflict, and only with each other — air_shared
// and offsite bookings never block anything (no entry here). room_portion
// (half/full) is ignored: any room_v1/room_v2/room_v1_v2 booking blocks the
// whole room.
export const ROOM_CONFLICTS: Record<string, string[]> = {
  room_v1:    ["room_v1", "room_v1_v2"],
  room_v2:    ["room_v2", "room_v1_v2"],
  room_v1_v2: ["room_v1", "room_v2", "room_v1_v2"],
};

/** Postgres TIME comes back as HH:MM:SS; normalize to HH:MM for comparison. */
function normTime(t: string | null): string | null {
  return t ? t.slice(0, 5) : null;
}

/**
 * Half-open interval overlap — e.g. 10:00–12:00 then 12:00–14:00 do not
 * conflict. Missing a time on either side (common for early-stage inquiry
 * bookings) is treated conservatively as a same-day conflict regardless of
 * time, so missing time data can't hide a real double-booking.
 *
 * ── MIDNIGHT-CROSSING BOOKINGS: CLAMPED TO END-OF-DAY ─────────────────────
 *
 * end ≤ start means the booking runs past midnight (22:00–01:00). Compared
 * as raw HH:MM strings that is an inverted, EMPTY interval — the
 * verification pass found a 22:00–01:00 party that failed to conflict with
 * 23:00–23:30 in the same room, on both client and server, since both share
 * this module. The rule, from Nik's side: such a booking holds the room from
 * its start to END OF DAY on its own event_date. "24:00" compares greater
 * than any real HH:MM, which is the whole trick.
 *
 * The after-midnight tail (00:00–01:00 on the NEXT calendar date) stays
 * deliberately unmodelled: a booking has one event_date, and that is the
 * boundary. Refusing midnight-crossing times at entry was rejected — a party
 * running past midnight is a normal booking, and refusing it would punish
 * the user for the model's limitation.
 */
function clampEnd(start: string, end: string): string {
  return end <= start ? "24:00" : end;
}

function timesOverlap(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return true;
  return aStart < clampEnd(bStart, bEnd) && bStart < clampEnd(aStart, aEnd);
}

/** First candidate (if any) whose room conflicts with `venue` on the same date. */
export function findRoomConflict(
  venue: string,
  startTime: string | null,
  endTime: string | null,
  candidates: RoomConflictCandidate[],
): RoomConflictCandidate | null {
  const conflictingVenues = ROOM_CONFLICTS[venue];
  if (!conflictingVenues) return null;
  const aStart = normTime(startTime);
  const aEnd = normTime(endTime);
  for (const c of candidates) {
    if (!conflictingVenues.includes(c.venue)) continue;
    const bStart = normTime(c.start_time);
    const bEnd = normTime(c.end_time);
    if (timesOverlap(aStart, aEnd, bStart, bEnd)) return c;
  }
  return null;
}

/** Where and when a booking sits: the fields the room rule reads, and whether it is cancelled. */
export type RoomPlacement = {
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location_type: string | null;
  venue: string | null;
  cancelled: boolean;
};

function samePlacement(a: RoomPlacement, b: RoomPlacement): boolean {
  return a.event_date === b.event_date
    && normTime(a.start_time || null) === normTime(b.start_time || null)
    && normTime(a.end_time || null) === normTime(b.end_time || null)
    && (a.location_type ?? "") === (b.location_type ?? "")
    && (a.venue ?? "") === (b.venue ?? "");
}

/**
 * Does a room conflict REFUSE this save? (Queue item 40, 2026-09-25.)
 *
 * The rule exists to stop a save from CREATING a double booking. It used to
 * refuse every save of a booking in conflict, so a booking the other one
 * had moved onto, or that an unrelated inquiry with no times had "hit",
 * could not be corrected, re-issued or cost-locked at all. Now a conflict
 * refuses only a save that puts the booking somewhere it was not: a new
 * booking, a different date, time, room or location type, or a cancelled
 * booking taken back. A save that leaves the booking exactly where it was
 * stored changes no room, so it goes through (the screen still warns). A
 * save that cancels never holds a room, so a conflict never refuses it.
 *
 * `before` is the booking as STORED (null for a new one); `after` is what
 * this save writes. Callers ask only when there is a conflict.
 */
export function conflictBlocksSave(before: RoomPlacement | null, after: RoomPlacement): boolean {
  if (after.cancelled) return false;
  if (!before) return true;
  if (before.cancelled) return true;
  return !samePlacement(before, after);
}
