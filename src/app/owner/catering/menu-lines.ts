/**
 * What a booking's food lines ARE, for every screen and document that prints
 * them: the course type, which line is a set, which rows a set line serves
 * (the booking's copy or the shared set), and the four print sections in
 * print order.
 *
 * Moved out of event-menu.ts on 2026-09-24, verbatim, so the menu card (the
 * card placed on each table, /owner/catering/[id]/menu-card) can use the same
 * definitions without importing a module that computes cost: event-menu.ts
 * also holds foodCostFigure and lineFoodCost. It re-exports everything here,
 * so its importers did not change. Imports nothing; pure.
 */

/** One course of a booking's set: a copied row, or a shared row when falling back. */
export type EventMenuDish = {
  id: string;
  menu_id: string;
  menu_name: string;
  /** menus.selling_price — a customer price, sales-readable. */
  selling_price: number;
  /** PORTIONS PER TABLE (per set), as catering_set_menu_items.quantity is. */
  quantity: number;
  section: string;
  sort_order: number;
  note: string | null;
  /** Provenance, carried so a re-save keeps it: the shared set this course came from. */
  source_set_menu_id?: string | null;
  /** Provenance: the other booking's set line this course was copied from. */
  source_event_menu_id?: string | null;
};

export type DishSource = "copy" | "shared" | "none";

/**
 * A set line is one copied from a shared set (set_menu_id) or a custom set —
 * which, by the widened CHECK, is the line that names neither a set nor a
 * dish. Decided from the two columns every screen already reads.
 */
export function isSetLine(line: { set_menu_id: string | null; menu_id: string | null }): boolean {
  return line.set_menu_id != null || line.menu_id == null;
}

/**
 * What is served at a set line.
 *
 * `copied` is whether a copy was ever MADE for the line — the line's own
 * marker (set_name, stamped by catering_copy_set_menu and by the save), not
 * its row count. The 2026-09-19 review found the row count could not tell
 * "never copied" from "copied, then every course removed": the emptied copy
 * silently fell back to the shared set on every screen. A copied line with
 * no rows is a copy with no rows. Only a line never copied reads the shared
 * set (a booking from before the feature); a line with neither is empty.
 */
export function resolveDishes(
  copy: EventMenuDish[] | undefined,
  shared: EventMenuDish[] | undefined,
  copied: boolean,
): { source: DishSource; dishes: EventMenuDish[] } {
  if (copied || (copy && copy.length > 0)) return { source: "copy", dishes: copy ?? [] };
  if (shared && shared.length > 0) return { source: "shared", dishes: shared };
  return { source: "none", dishes: [] };
}

/**
 * catering_set_menu_items.section / catering_event_menu_items.section — the
 * four groups, IN PRINT ORDER. The values mirror the CHECK constraint
 * (supabase/catering_set_menu_sections_migration.sql); the order is the order
 * the three documents print them in. ONE definition: shared-utils.tsx's
 * SET_MENU_SECTIONS, which the documents read, is built from this list.
 */
export const EVENT_MENU_SECTIONS = ["dish", "dessert", "drink", "free"] as const;
export type EventMenuSection = (typeof EVENT_MENU_SECTIONS)[number];
export const EVENT_MENU_SECTION_LABELS: Record<EventMenuSection, string> = {
  dish: "รายการอาหาร",
  dessert: "ขนมหวาน",
  drink: "เครื่องดื่ม",
  free: "รายการแถมฟรี",
};
export const EVENT_MENU_SECTION_LIST: { value: string; label: string }[] = EVENT_MENU_SECTIONS.map((value) => ({ value, label: EVENT_MENU_SECTION_LABELS[value] }));

