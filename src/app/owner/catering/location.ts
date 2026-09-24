/**
 * Where a booking takes place: the location, room and portion options, their
 * labels, and the one line the documents print. Moved out of shared-utils.tsx
 * on 2026-09-24, verbatim (locationLabel now takes the three fields it reads
 * rather than a CateringEvent), so the menu card can print a venue without
 * importing shared-utils, which imports event-menu.ts and its cost figures.
 * shared-utils.tsx re-exports all of it. Imports nothing; pure.
 */

// Values mirror the CHECK constraints in supabase/catering_migration.sql +
// supabase/catering_location_migration.sql.
export const LOCATION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "in_house", label: "ภายในร้าน" },
  { value: "offsite",  label: "นอกสถานที่" },
];
// 'offsite' dropped: it is now its own location_type, not a venue.
export const VENUE_OPTIONS: { value: string; label: string }[] = [
  { value: "air_shared", label: "แอร์รวม" },
  { value: "room_v1",    label: "ห้อง V1" },
  { value: "room_v2",    label: "ห้อง V2" },
  { value: "room_v1_v2", label: "ห้อง V1 + V2" },
];
export const ROOM_PORTION_OPTIONS: { value: string; label: string }[] = [
  { value: "half", label: "ครึ่งห้อง" },
  { value: "full", label: "เต็มห้อง" },
];
export const LOCATION_TYPE_LABEL = Object.fromEntries(LOCATION_TYPE_OPTIONS.map((o) => [o.value, o.label]));
export const VENUE_LABEL         = Object.fromEntries(VENUE_OPTIONS.map((o) => [o.value, o.label]));
export const ROOM_PORTION_LABEL  = Object.fromEntries(ROOM_PORTION_OPTIONS.map((o) => [o.value, o.label]));

export function locationLabel(e: { location_type: string; venue: string | null; room_portion: string | null }): string {
  if (e.location_type === "offsite") return "นอกสถานที่";
  const room = e.venue ? VENUE_LABEL[e.venue] ?? e.venue : "–";
  const portion = e.room_portion ? ROOM_PORTION_LABEL[e.room_portion] : null;
  return portion ? `${room} (${portion})` : room;
}

