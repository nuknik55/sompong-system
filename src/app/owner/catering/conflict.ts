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
 */
function timesOverlap(aStart: string | null, aEnd: string | null, bStart: string | null, bEnd: string | null): boolean {
  if (!aStart || !aEnd || !bStart || !bEnd) return true;
  return aStart < bEnd && bStart < aEnd;
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
