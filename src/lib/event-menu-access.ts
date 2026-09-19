/**
 * Who may do what with a booking's OWN menu — the dishes copied into an event
 * from a shared set menu, or added to it from scratch (catering per-event
 * menus, round 1, Nik 2026-09-19).
 *
 *   "edit"  owner and admin: add, swap, remove and re-count dishes, and start
 *           a custom set for the booking.
 *   "view"  sales: read the event's menu and the discount against the dishes'
 *           own prices. Never a cost figure — that is decided by the PAGE never
 *           computing one for this access level, not by hiding it.
 *   "none"  every other role.
 *
 * ONE PLACE, on purpose. Nik may open editing to sales later; when he does,
 * the change is the one line below and nothing else. The page reads this to
 * decide what to render, every write action reads it to decide whether to
 * refuse, and the database's own rule (catering_event_menu_items policies,
 * owner and admin write) will then need its own one-line change to match.
 *
 * The cost lock is a SEPARATE rule, applied on top: a locked booking's menu is
 * frozen for everyone, "edit" included — assertCostNotLocked in the actions,
 * as for every other write to a booking.
 */
export type EventMenuAccess = "edit" | "view" | "none";

export function eventMenuAccess(role: string | null | undefined): EventMenuAccess {
  if (role === "owner" || role === "admin") return "edit";
  if (role === "sales") return "view";
  return "none";
}
