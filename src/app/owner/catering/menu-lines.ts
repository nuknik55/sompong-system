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
  /** menus.id for a dish from the menu list; null for a TYPED dish (Nik, 2026-09-25). */
  menu_id: string | null;
  /**
   * A dish that is not in the menu list, typed by name; null (or absent) for
   * a menu dish. Exactly one of menu_id and dish_name, as the database checks.
   */
  dish_name?: string | null;
  /** A typed dish linked to a real menu for its COST only (owner, admin); the typed name still prints. */
  linked_menu_id?: string | null;
  /** The name every document prints: the typed name, or the menu's. */
  menu_name: string;
  /** menus.selling_price — a customer price, sales-readable. 0 for a typed dish, which has none. */
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

/** A dish typed by name rather than picked from the menu list. */
export function isTypedDish(d: { menu_id: string | null }): boolean {
  return d.menu_id == null;
}

/**
 * The menu whose cost a course carries: its own for a menu dish, the link
 * for a typed dish that owner or admin linked, and none for an unlinked
 * typed dish, whose cost is unknown.
 */
export function recipeMenuId(d: { menu_id: string | null; linked_menu_id?: string | null }): string | null {
  return d.menu_id ?? d.linked_menu_id ?? null;
}

/** The one key a course is compared by in a list: its menu, or its typed name case-folded. */
export function dishKey(d: { menu_id: string | null; dish_name?: string | null; menu_name?: string }): string {
  return d.menu_id != null ? "m:" + d.menu_id : "t:" + (d.dish_name ?? d.menu_name ?? "").trim().toLocaleLowerCase("th");
}

/** A typed name's rules, as the database checks them (catering_dish_name_ok): 1-120 characters once trimmed. */
export const TYPED_DISH_MAX = 120;
/**
 * The characters a typed name may not hold, by code point — a tab, a line
 * break, a no-break space and the zero-width ones: a name of them printed
 * blank, and two names differing only by one passed the one-name rule
 * (review, 2026-09-25). Code points, never escapes: an escape can be decoded
 * into the invisible character itself by the tools that write this file.
 */
const UNPRINTABLE = new Set([9, 10, 13, 160, 8203, 8204, 8205, 8288, 65279]);
export function typedDishNameError(name: string): string | null {
  const t = name.trim();
  if (t === "") return "พิมพ์ชื่อเมนู";
  if (t.length > TYPED_DISH_MAX) return `ชื่อเมนูยาวได้ไม่เกิน ${TYPED_DISH_MAX} ตัวอักษร`;
  for (const ch of t) if (UNPRINTABLE.has(ch.codePointAt(0) as number)) return "ชื่อเมนูมีอักขระที่พิมพ์ไม่ออก (เว้นวรรคพิเศษหรือขึ้นบรรทัด) — พิมพ์ใหม่";
  return null;
}

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

