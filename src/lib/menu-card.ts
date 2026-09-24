/**
 * THE MENU CARD — the card placed on each table at a catering event (Nik,
 * 2026-09-24; README item 39). One A4 portrait page per table, all identical,
 * printed in colour.
 *
 * What it shows, and what it never shows:
 * - the event (its type and whose event it is), the date in Thai, the venue;
 * - every food line the customer ordered: each set's courses grouped into
 *   the four print sections, from the SAME expansion the kitchen sheet, the
 *   function sheet and the quotation print (groupBySection over what
 *   getEventMenuDishes / readEventMenuDishes returns), so the card cannot
 *   disagree with them; then the dishes ordered outside a set; then the
 *   lines typed by hand on the print page (menu_card_lines);
 * - Thai only, NAMES only: no price, no quantity, and no note — a course's
 *   note is for the kitchen. buildMenuCard copies names and nothing else,
 *   which is what the tests hold.
 *
 * Pure, and imports only the section grouping (itself pure), so nothing here
 * can reach a cost; the page's import graph is tested for that separately.
 */
import { groupBySection } from "./function-sheet.ts";

/** Hand-typed lines: at most this many, each at most MAX_MANUAL_LINE_CHARS long. */
export const MAX_MANUAL_LINES = 20;
export const MAX_MANUAL_LINE_CHARS = 100;
/** One card per table; spares are added by hand, up to this. */
export const MAX_COPIES = 200;

export type MenuCardSection = { key: string; label: string; items: string[] };
/** One set of the booking. heading is its name, shown only when the booking has more than one set. */
export type MenuCardBlock = { key: string; heading: string | null; sections: MenuCardSection[] };
export type MenuCard = {
  /** The kind of event (catering_event_types.label), or a plain heading when it has none. */
  title: string;
  /** Whose event: the company, else the customer. */
  host: string | null;
  /** "วันศุกร์ที่ 18 กันยายน 2569" */
  date: string;
  venue: string | null;
  blocks: MenuCardBlock[];
  /** Dishes ordered outside any set (the sheets' รายการอาหารเพิ่มเติม). */
  extras: string[];
};

export type MenuCardDish = { id: string; menu_name: string; quantity: number; note: string | null; section: string };

export type MenuCardInput = {
  eventTypeLabel: string | null;
  customerName: string | null;
  companyName: string | null;
  /** ISO date, yyyy-mm-dd */
  eventDate: string;
  venue: string | null;
  /** The booking's set lines, in the booking's order, each with what it serves. */
  setLines: { id: string; name: string; dishes: MenuCardDish[] }[];
  /** The names of the dishes ordered outside a set, in the booking's order. */
  extraNames: string[];
  /** The print sections, in print order (EVENT_MENU_SECTION_LIST). */
  sections: { value: string; label: string }[];
};

export const MENU_CARD_DEFAULT_TITLE = "เมนูอาหาร";

export function buildMenuCard(input: MenuCardInput): MenuCard {
  const filled = input.setLines
    .map((line) => ({
      key: line.id,
      name: line.name,
      sections: groupBySection(line.dishes, input.sections).map((g) => ({
        key: g.key,
        label: g.label,
        items: g.lines.map((l) => l.name),
      })),
    }))
    .filter((b) => b.sections.length > 0);
  // A set's name is a heading only when there is more than one set to tell apart.
  const blocks = filled.map((b) => ({ key: b.key, heading: filled.length > 1 ? b.name : null, sections: b.sections }));
  const host = (input.companyName?.trim() || input.customerName?.trim()) || null;
  return {
    title: input.eventTypeLabel?.trim() || MENU_CARD_DEFAULT_TITLE,
    host,
    date: thaiLongDate(input.eventDate),
    venue: input.venue?.trim() || null,
    blocks,
    extras: input.extraNames.map((n) => n.trim()).filter((n) => n !== ""),
  };
}

/** "วันศุกร์ที่ 18 กันยายน 2569": the card's date, Buddhist year, from a calendar date (never shifted by a time zone). */
export function thaiLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const parts = new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}ที่ ${part("day")} ${part("month")} ${part("year")}`;
}

/** The hand-typed lines as they print: one per line, trimmed, blank lines dropped. */
export function parseManualLines(text: string | null | undefined): string[] {
  return (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
}

/** Why these hand-typed lines cannot be saved, or null. The server checks the same. */
export function manualLinesProblem(text: string): string | null {
  const lines = parseManualLines(text);
  if (lines.length > MAX_MANUAL_LINES) return `พิมพ์เพิ่มได้ไม่เกิน ${MAX_MANUAL_LINES} บรรทัด (ตอนนี้ ${lines.length} บรรทัด)`;
  const long = lines.findIndex((l) => l.length > MAX_MANUAL_LINE_CHARS);
  if (long >= 0) return `บรรทัดที่ ${long + 1} ยาวเกิน ${MAX_MANUAL_LINE_CHARS} ตัวอักษร`;
  return null;
}

/** What is stored in catering_events.menu_card_lines: the parsed lines, or null when there are none. */
export function storedManualLines(text: string): string | null {
  const lines = parseManualLines(text);
  return lines.length > 0 ? lines.join("\n") : null;
}

/** The number of cards a print starts at: one per table, at least one. */
export function defaultCopies(tableCount: number | null): number {
  if (tableCount == null || !Number.isFinite(tableCount) || tableCount <= 0) return 1;
  return Math.min(Math.ceil(tableCount), MAX_COPIES);
}

/** The copies typed on the page, as a whole number from 1 to MAX_COPIES, or null when it is not one. */
export function parseCopies(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= MAX_COPIES ? n : null;
}

/**
 * How a long menu is made to fit ONE page, in order: the full type size first,
 * then smaller in steps down to 60%, then two columns from full size down to
 * 60% again. The page takes the first step at which the menu fits; if none
 * does, it says so and does not print (a card that ran onto a second page, or
 * lost its last lines, would be wrong either way).
 */
export const FIT_STEPS: readonly { cols: 1 | 2; scale: number }[] = (() => {
  const scales = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6];
  return [...scales.map((scale) => ({ cols: 1 as const, scale })), ...scales.map((scale) => ({ cols: 2 as const, scale }))];
})();
