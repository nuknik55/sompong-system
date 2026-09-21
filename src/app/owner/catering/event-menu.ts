/**
 * A booking's OWN menu — catering per-event menus (Nik, 2026-09-19; round 2
 * brought forward the same day).
 *
 * THE MODEL. A shared set menu (catering_set_menus + _items) is reference
 * data, edited by owner and admin. Picking one for a booking COPIES its
 * dishes into catering_event_menu_items, keyed by the booking's set line
 * (catering_event_menus.id). From then on the copy is the record: editing it
 * never touches the shared set, and the shared set changing later never
 * changes what a past booking shows. A booking may also start a custom set
 * (a set line with a name and no shared source) and build it from nothing,
 * or fill any set line from a standard set or from another booking's own
 * list — the chooser. Provenance is recorded per course
 * (source_set_menu_id / source_event_menu_id), never followed live.
 *
 * BOOKINGS FROM BEFORE THIS FEATURE have set lines with no copy. They fall
 * back to the shared set, exactly as every screen read them until now
 * (`source: "shared"`). The first save of such a line on the menu page
 * writes what the screen showed as the booking's own copy — nothing is
 * materialised behind anyone's back.
 *
 * THE SCREEN IS ONE FLAT LIST PER SET, in the order dishes were added, with
 * one picker (Nik, 2026-09-19: "it works, but you have to be familiar with
 * it"). The section column (dish / dessert / drink / free) STAYS in the
 * database and on every row: the kitchen sheet, the function sheet and the
 * quotation group or order by it, and the shared set editor assigns it. A
 * copied course keeps its section, a course added here starts as a `dish`,
 * and each row carries a small selector to change it (Nik, 2026-09-20) —
 * a field of the row, not a grouping of the list. Nothing prices a section
 * differently anywhere — "free" is a print heading only.
 *
 * EDITS ARE HELD ON THE SCREEN and written by ONE save (Nik): the draft
 * model at the bottom of this file is what the screen holds, what "dirty"
 * means, and what the save sends. The database writes it in one
 * transaction (catering_save_event_menus), so a save either lands whole or
 * not at all.
 *
 * QUANTITY IS PORTIONS PER TABLE (Nik, 2026-09-19, confirmed): a course
 * priced 250 with quantity 5 is worth 1,250 bought singly, and its cost is
 * five portions' cost. Every figure here multiplies the same way. The one
 * defect found was DISPLAY — the row showed 250 and 5 in separate columns
 * and never their product, so the rows could not be added up to the total
 * under them. dishLineTotal is now the row's figure AND the term the total
 * sums, so they cannot disagree.
 *
 * Pure — no import of a value — so every figure here is a test, and the page
 * that renders them can be given exactly what it will send to the browser
 * (buildEventMenuView), which is how "sales never receives a cost" is tested
 * rather than asserted.
 */
import type { EventMenuAccess } from "@/lib/event-menu-access";
import { menuLineQuantityError } from "./booking-lines.ts";

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

/** A set line of the booking, with what is served at it. */
export type EventMenuLine = {
  /** catering_event_menus.id */
  id: string;
  name: string;
  /** catering_event_menus.quantity — tables. */
  tables: number;
  /**
   * THE price per table: the linked charge's unit_price. One stored number,
   * read here and by the booking screen's price box; the menu page is where
   * it is edited. null when the line has no charge (should not happen).
   */
  pricePerTable: number | null;
  /** Provenance: the shared set it was copied from, or null for a custom set. */
  sourceSetMenuId: string | null;
  source: DishSource;
  dishes: EventMenuDish[];
};

/** The food cost of ONE portion of a dish. Built for owner and admin only — see buildEventMenuView. */
export type DishCost = { unit_cost: number; has_unknown_cost: boolean };

export type EventMenuView = {
  lines: EventMenuLine[];
  canEdit: boolean;
  locked: boolean;
  /**
   * Per dish (menus.id), for every dish the screen may show or add — so the
   * cost figures update live while the person edits. null for every access
   * level but "edit", whatever the caller passed.
   */
  dishCostById: Record<string, DishCost> | null;
};

/** A swap whose new dish differs in price by more than this from the old one is flagged. */
export const SWAP_WARN_RATIO = 0.1;

const baht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * A set line is one copied from a shared set (set_menu_id) or a custom set —
 * which, by the widened CHECK, is the line that names neither a set nor a
 * dish. Decided from the two columns every screen already reads.
 */
export function isSetLine(line: { set_menu_id: string | null; menu_id: string | null }): boolean {
  return line.set_menu_id != null || line.menu_id == null;
}

/**
 * The page's lines: every set line of the booking with its price per table
 * (the linked charge's unit_price) and what is served at it. Dish lines are
 * not part of any set and are left out — they print under รายการเพิ่มเติม on
 * the sheets, as before.
 */
export function buildEventMenuLines(
  eventMenus: { id: string; set_menu_id: string | null; menu_id: string | null; name: string; quantity: number }[],
  charges: { event_menu_id: string | null; unit_price: number }[],
  dishesByLine: Map<string, { source: DishSource; dishes: EventMenuDish[] }>,
): EventMenuLine[] {
  const priceByLine = new Map<string, number>();
  for (const c of charges) if (c.event_menu_id && !priceByLine.has(c.event_menu_id)) priceByLine.set(c.event_menu_id, c.unit_price);
  return eventMenus.filter(isSetLine).map((m) => {
    const resolved = dishesByLine.get(m.id) ?? { source: "none" as DishSource, dishes: [] };
    return {
      id: m.id,
      name: m.name,
      tables: m.quantity,
      pricePerTable: priceByLine.get(m.id) ?? null,
      sourceSetMenuId: m.set_menu_id,
      source: resolved.source,
      dishes: resolved.dishes,
    };
  });
}

// ── The figures ──────────────────────────────────────────────────────────────

/** One row's figure: selling price × portions per table. 250 × 5 = 1,250. */
export function dishLineTotal(d: { selling_price: number; quantity: number }): number {
  return d.selling_price * d.quantity;
}

/**
 * The row shows its arithmetic, not just its inputs: "฿250.00 × 5 = ฿1,250.00".
 * A single portion shows the price alone. Nik summed the displayed unit
 * prices by hand and got a different total from the screen (2026-09-19);
 * with the product on every row the list adds up to the total below it.
 */
export function dishLineTotalText(d: { selling_price: number; quantity: number }): string {
  if (d.quantity === 1) return `฿${baht(d.selling_price)}`;
  return `฿${baht(d.selling_price)} × ${d.quantity.toLocaleString("th-TH")} = ฿${baht(dishLineTotal(d))}`;
}

/** Σ of the rows' own figures: what the dishes would cost the customer bought singly, per table. */
export function dishesTotalPerTable(dishes: { selling_price: number; quantity: number }[]): number {
  return dishes.reduce((s, d) => s + dishLineTotal(d), 0);
}

/** The comparison's label, on the menu page and the set-menu screen alike (Nik, 2026-09-19). */
export const COMPARISON_LABEL = "ราคาอาหารชุดเทียบกับสั่งแยกจาน";

export type SetVsAlaCarte = {
  dishesTotal: number;
  pricePerTable: number;
  /** price − à-la-carte total: positive = the set sells ABOVE its dishes, negative = below. */
  diff: number;
  /** |diff| as a percentage of the à-la-carte total. */
  pct: number;
  direction: "above" | "below" | "equal";
};

/**
 * The set's price against its dishes' own prices. VISIBLE TO SALES: both
 * inputs are customer prices. 4,800 of dishes sold as a 4,500 set is BELOW
 * by 6.25%; 2,977.06 of dishes sold as a 4,500 set is ABOVE by 51.16%. The
 * direction is a field, never a sign the reader has to interpret — the first
 * version showed "−51.15%" under a label that said "discount", which read as
 * a discount (Nik, 2026-09-19).
 */
export function setVsAlaCarte(dishesTotal: number, pricePerTable: number | null): SetVsAlaCarte | null {
  if (pricePerTable == null || !Number.isFinite(pricePerTable) || !(dishesTotal > 0)) return null;
  const diff = pricePerTable - dishesTotal;
  const direction = Math.abs(diff) < 0.005 ? "equal" : diff > 0 ? "above" : "below";
  return { dishesTotal, pricePerTable, diff, pct: (Math.abs(diff) / dishesTotal) * 100, direction };
}

/** The big figure: direction first, then by how much. */
export function comparisonHeadline(fig: SetVsAlaCarte | null): string {
  if (!fig) return "—";
  if (fig.direction === "equal") return "เท่ากับสั่งแยกจาน";
  return `${fig.direction === "above" ? "สูงกว่า" : "ต่ำกว่า"}สั่งแยกจาน ${fig.pct.toFixed(2)}%`;
}

/** The supporting line: both totals, the direction in words, the difference in baht and in percent. */
export function comparisonText(fig: SetVsAlaCarte | null): string {
  if (!fig) return "ยังเทียบไม่ได้ — ต้องมีเมนูในชุดและราคาต่อโต๊ะ";
  if (fig.direction === "equal") return `ราคาชุด ${baht(fig.pricePerTable)} บาท เท่ากับราคาสั่งแยกจานรวม ${baht(fig.dishesTotal)} บาท พอดี`;
  const word = fig.direction === "above" ? "สูงกว่า" : "ต่ำกว่า";
  return (
    `ราคาชุด ${baht(fig.pricePerTable)} บาท ${word}ราคาสั่งแยกจานรวม ${baht(fig.dishesTotal)} บาท ` +
    `อยู่ ${baht(Math.abs(fig.diff))} บาท (${fig.pct.toFixed(2)}% ของราคาสั่งแยกจาน)`
  );
}

/** OWNER AND ADMIN ONLY — the caller decides whether to compute the cost at all. 2,000 against 4,500 = 44.44%. */
export function foodCostFigure(costPerTable: number, pricePerTable: number | null): { cost: number; pct: number | null } {
  const pct = pricePerTable != null && pricePerTable > 0 ? (costPerTable / pricePerTable) * 100 : null;
  return { cost: costPerTable, pct };
}

/**
 * A set line's food cost per table from the per-dish costs: Σ portion cost ×
 * portions per table — the same multiplication as dishLineTotal, so the two
 * figures on a card describe the same set. A dish with no cost entry counts
 * as unknown, not as zero-and-silent.
 */
export function lineFoodCost(
  dishes: { menu_id: string; quantity: number }[],
  costById: Record<string, DishCost>,
): { costPerTable: number; hasUnknownCost: boolean } {
  let costPerTable = 0;
  let hasUnknownCost = false;
  for (const d of dishes) {
    const c = costById[d.menu_id];
    if (!c) { hasUnknownCost = true; continue; }
    costPerTable += c.unit_cost * d.quantity;
    if (c.has_unknown_cost) hasUnknownCost = true;
  }
  return { costPerTable, hasUnknownCost };
}

/**
 * Swapping a course for one whose price differs by more than 10% from the
 * one it replaces is flagged. A WARNING: the swap goes ahead if the person
 * confirms. Exactly 10% is not "more than".
 */
export function swapPriceWarning(oldPrice: number, newPrice: number): { warn: boolean; diffPct: number | null } {
  if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice) || oldPrice <= 0) return { warn: false, diffPct: null };
  const diffPct = ((newPrice - oldPrice) / oldPrice) * 100;
  return { warn: Math.abs(newPrice - oldPrice) / oldPrice > SWAP_WARN_RATIO + 1e-12, diffPct };
}

export function swapWarningText(oldName: string, oldPrice: number, newName: string, newPrice: number): string {
  const { diffPct } = swapPriceWarning(oldPrice, newPrice);
  const dir = newPrice > oldPrice ? "แพงกว่า" : "ถูกกว่า";
  return (
    `${newName} (${newPrice.toLocaleString("th-TH")} บาท) ${dir} ${oldName} (${oldPrice.toLocaleString("th-TH")} บาท) ` +
    `อยู่ ${Math.abs(diffPct ?? 0).toFixed(1)}% — เกิน 10% ตรวจสอบราคาชุดก่อนยืนยัน`
  );
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
 * What the page sends to the browser. THE COST MAP IS DROPPED unless the
 * access is "edit" — so even a page that computed one by mistake could not
 * ship it to a sales session. The page does not compute one for sales
 * either; this is the second lock, and it is the one a test can hold.
 */
export function buildEventMenuView(input: {
  access: EventMenuAccess;
  locked: boolean;
  lines: EventMenuLine[];
  dishCostById: Record<string, DishCost> | null;
}): EventMenuView {
  const edit = input.access === "edit";
  return {
    lines: input.lines,
    canEdit: edit && !input.locked,
    locked: input.locked,
    dishCostById: edit ? input.dishCostById : null,
  };
}

/**
 * A short fingerprint of what the person edits: the lines, the lock, the
 * access. The editor adopts new server data when this changes and its draft
 * is clean (or the change is its own save landing); while dirty it keeps the
 * draft and says the data moved. The cost map is deliberately NOT hashed —
 * an ingredient price changing elsewhere in the restaurant must not read as
 * "this booking changed" (review, 2026-09-19).
 */
export function viewVersion(view: EventMenuView): string {
  const s = JSON.stringify({ lines: view.lines, locked: view.locked, canEdit: view.canEdit });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + ":" + s.length.toString(36);
}

// ── The draft: what the screen holds until บันทึก ────────────────────────────

export type DraftDish = {
  /** Client key, stable while the row is on screen. */
  key: string;
  menu_id: string;
  menu_name: string;
  selling_price: number;
  /** The input's text; parsed by draftDishes. */
  quantity: string;
  section: string;
  note: string | null;
  source_set_menu_id: string | null;
  source_event_menu_id: string | null;
};

export type LineDraft = {
  /** The line's id, or a client key for a custom set not yet created. */
  key: string;
  eventMenuId: string | null;
  name: string;
  tables: number;
  /** The input's text for THE price per table. */
  price: string;
  sourceSetMenuId: string | null;
  /** What the screen opened with; "shared" is a line whose copy the save will make. */
  source: DishSource;
  /**
   * A "shared" line the person chose to keep as the booking's own list, or to
   * start empty, without changing a course: nothing else in the draft moves,
   * so this is what makes it dirty and what sends it.
   */
  materialize: boolean;
  dishes: DraftDish[];
  /**
   * THE CONFLICT TOKEN: the ids of the copy's rows and the price per table as
   * the page read them. Every save rewrites a line's rows (new ids), so if
   * anyone else saved this line since, the live ids differ and the function
   * refuses instead of writing this draft over their work (review,
   * 2026-09-19: last write silently won). Empty for a line with no copy yet.
   */
  knownItemIds: string[];
  knownPrice: number | null;
  /**
   * Marked for deletion, committed by บันทึก like every other edit (Nik,
   * 2026-09-20: a set created with สร้างชุดเมนูเอง could not be removed from
   * the screen that created it). A removed line is not sent to the save
   * function — it is deleted afterwards, which takes its courses and its
   * food charge with it by ON DELETE CASCADE. ยกเลิก clears the mark. A
   * line that was never saved is dropped from the draft outright instead:
   * there is nothing on the server to delete.
   */
  removed: boolean;
};

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

export function draftFromLine(line: EventMenuLine): LineDraft {
  return {
    key: line.id,
    eventMenuId: line.id,
    name: line.name,
    tables: line.tables,
    price: line.pricePerTable == null ? "" : String(line.pricePerTable),
    sourceSetMenuId: line.sourceSetMenuId,
    source: line.source,
    materialize: false,
    knownItemIds: line.source === "copy" ? line.dishes.map((d) => d.id) : [],
    knownPrice: line.pricePerTable,
    removed: false,
    dishes: line.dishes.map((d) => ({
      key: d.id,
      menu_id: d.menu_id,
      menu_name: d.menu_name,
      selling_price: d.selling_price,
      quantity: String(d.quantity),
      section: d.section,
      note: d.note,
      // A fallback row materialised by a save came from the shared set the
      // line points at; a copied row keeps whatever it was copied with.
      source_set_menu_id: d.source_set_menu_id ?? (line.source === "shared" ? line.sourceSetMenuId : null),
      source_event_menu_id: d.source_event_menu_id ?? null,
    })),
  };
}

/**
 * A custom set for this booking, started empty (Nik: a menu may be built from
 * nothing). ALWAYS ONE TABLE: the real count is set in the price box on the
 * booking screen, where Nik already sets it (A4, 2026-09-19).
 */
export function newCustomLineDraft(key: string, name: string, pricePerTable: number): LineDraft {
  return { key, eventMenuId: null, name: name.trim(), tables: 1, price: String(pricePerTable), sourceSetMenuId: null, source: "none", materialize: true, dishes: [], knownItemIds: [], knownPrice: null, removed: false };
}

/**
 * The name a set line is known by when two are compared: trimmed,
 * case-folded. The SAME expression the save function's own duplicate check
 * folds with, so the screen, the server action and the database agree on
 * what "the same name" means.
 */
export const foldSetName = (s: string) => s.trim().toLocaleLowerCase("th");
const nameKey = foldSetName;

/**
 * A set name already used by another set line of the same booking, or null.
 * Three sets called t2000 at three prices all counted toward one total with
 * nothing to tell them apart (Nik, 2026-09-19), so a NEW set may not take a
 * name another line already has. Existing lines are compared, never refused:
 * Nik removes his own duplicates himself.
 *
 * A line MARKED FOR DELETION still counts as present, because the save
 * creates before it deletes: reusing the name of a set being removed has to
 * be two saves, not one.
 */
export function duplicateSetName(drafts: LineDraft[]): string | null {
  for (const d of drafts) {
    if (d.eventMenuId != null) continue;
    if (drafts.some((o) => o !== d && nameKey(o.name) === nameKey(d.name))) return d.name.trim();
  }
  return null;
}

/**
 * A WHOLE SET COPIED IN, line and all (Nik, 2026-09-20). Deleting every set
 * line left a booking with no cards, and the copy button lived on a card —
 * so the only way back was the price box on the other screen. Copying into
 * an empty booking now creates the line itself: the source's name, the
 * source's price per table, and the booking's own table count. The save
 * writes the line, its food charge and its courses together, which is what
 * puts it in the price box.
 */
export function newLineDraftFromSource(
  key: string,
  source: { name: string; pricePerTable: number; dishes: EventMenuDish[] },
  tables: number,
  provenance: { set_menu_id: string } | { event_menu_id: string },
  keyFor: (i: number) => string,
): LineDraft {
  return applySourceDishes(
    { ...newCustomLineDraft(key, source.name, source.pricePerTable), tables },
    source.dishes,
    provenance,
    keyFor,
  );
}

/** Would this name collide with a set line the booking already has? The same rule the save applies. */
export function isSetNameTaken(drafts: LineDraft[], name: string): boolean {
  const k = nameKey(name);
  return k !== "" && drafts.some((d) => nameKey(d.name) === k);
}

/** The draft's courses as figures see them: an unparsable or non-positive quantity counts as 0. */
export function draftDishes(d: LineDraft): EventMenuDish[] {
  return d.dishes.map((x, i) => {
    const q = Number(x.quantity);
    return {
      id: x.key, menu_id: x.menu_id, menu_name: x.menu_name, selling_price: x.selling_price,
      quantity: Number.isFinite(q) && q > 0 ? q : 0, section: x.section, sort_order: (i + 1) * 10, note: x.note,
      source_set_menu_id: x.source_set_menu_id, source_event_menu_id: x.source_event_menu_id,
    };
  });
}

export function draftPrice(d: LineDraft): number | null {
  const n = Number(d.price.trim());
  return d.price.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** Fill a line from a source — a standard set or another booking's line — replacing what it held. */
export function applySourceDishes(
  draft: LineDraft,
  dishes: EventMenuDish[],
  source: { set_menu_id: string } | { event_menu_id: string },
  keyFor: (i: number) => string,
): LineDraft {
  return {
    ...draft,
    materialize: true,
    dishes: dishes.map((d, i) => ({
      key: keyFor(i),
      menu_id: d.menu_id,
      menu_name: d.menu_name,
      selling_price: d.selling_price,
      quantity: String(d.quantity),
      section: d.section,
      note: d.note,
      source_set_menu_id: "set_menu_id" in source ? source.set_menu_id : null,
      source_event_menu_id: "event_menu_id" in source ? source.event_menu_id : null,
    })),
  };
}

/** One line of the save payload — what catering_save_event_menus takes, per line. */
export type EventMenuSaveLine = {
  key: string;
  event_menu_id: string | null;
  set_name: string | null;
  tables: number | null;
  price_per_table: number;
  /** The conflict token (LineDraft.knownItemIds / knownPrice); empty and null for a new set. */
  known_item_ids: string[];
  known_price: number | null;
  items: {
    menu_id: string;
    quantity: number;
    section: string;
    sort_order: number;
    note: string | null;
    source_set_menu_id: string | null;
    source_event_menu_id: string | null;
  }[];
};

function normalizeLine(d: LineDraft) {
  return JSON.stringify({
    id: d.eventMenuId, name: d.name, tables: d.tables, price: draftPrice(d), m: d.materialize, rm: d.removed,
    dishes: d.dishes.map((x) => [x.menu_id, Number(x.quantity), x.section, x.note ?? null]),
  });
}

/** Two drafts describe the same menu — the definition of "nothing to save". */
export function lineDraftsEqual(a: LineDraft, b: LineDraft): boolean {
  return normalizeLine(a) === normalizeLine(b);
}

export function draftsEqual(a: LineDraft[], b: LineDraft[]): boolean {
  return a.length === b.length && a.every((x, i) => lineDraftsEqual(x, b[i]!));
}

/** The first thing wrong with the draft, in the words the screen shows; null when it may be saved. */
export function validateDrafts(drafts: LineDraft[]): string | null {
  const dup = duplicateSetName(drafts);
  if (dup !== null) return `มีชุดชื่อ “${dup}” อยู่ในงานนี้แล้ว — ตั้งชื่อชุดใหม่ให้ต่างกัน`;
  for (const d of drafts) {
    // A line being deleted is not checked: its price and its courses are
    // about to stop existing, so a set that cannot be saved can still be
    // removed. It is still compared for a duplicate name above, because the
    // save function creates before the deletions run.
    if (d.removed) continue;
    if (d.eventMenuId == null && d.name.trim() === "") return "ชุดเมนูต้องมีชื่อ";
    // A new set's tables follow the price box's rule — whole, at least 1 —
    // or the booking screen would refuse every later save (booking-lines.ts).
    const tablesError = d.eventMenuId == null ? menuLineQuantityError("set", d.tables) : null;
    if (tablesError) return `${d.name}: ${tablesError}`;
    const price = draftPrice(d);
    if (price == null || price < 0) return `${d.name}: ราคาต่อโต๊ะต้องเป็นตัวเลข 0 หรือมากกว่า`;
    const seen = new Set<string>();
    for (const x of d.dishes) {
      const q = Number(x.quantity);
      if (x.quantity.trim() === "" || !Number.isFinite(q) || q <= 0) return `${d.name}: จำนวนต่อโต๊ะของ ${x.menu_name} ต้องมากกว่า 0`;
      if (!(EVENT_MENU_SECTIONS as readonly string[]).includes(x.section)) return `${d.name}: หมวดของ ${x.menu_name} ไม่ถูกต้อง`;
      if (seen.has(x.menu_id)) return `${d.name}: ${x.menu_name} อยู่ในชุดนี้ซ้ำกัน`;
      seen.add(x.menu_id);
    }
  }
  return null;
}

/**
 * What the save sends: every line that differs from how the screen opened,
 * whole — a new custom set, a changed price, an edited list, or a fallback
 * line the person chose to keep. An untouched line is not sent, so a save
 * never rewrites what nobody changed. validateDrafts must have returned null.
 */
export function toSavePayload(drafts: LineDraft[], baseline: LineDraft[]): EventMenuSaveLine[] {
  const base = new Map(baseline.map((b) => [b.key, b]));
  const out: EventMenuSaveLine[] = [];
  for (const d of drafts) {
    // A line marked for deletion is not saved; removedLineIds carries it.
    if (d.removed) continue;
    const b = base.get(d.key);
    if (b && lineDraftsEqual(b, d)) continue;
    out.push({
      key: d.key,
      event_menu_id: d.eventMenuId,
      set_name: d.eventMenuId == null ? d.name.trim() : null,
      tables: d.eventMenuId == null ? d.tables : null,
      price_per_table: draftPrice(d) ?? 0,
      known_item_ids: d.eventMenuId == null ? [] : d.knownItemIds,
      known_price: d.eventMenuId == null ? null : d.knownPrice,
      items: d.dishes.map((x, i) => ({
        menu_id: x.menu_id,
        quantity: Number(x.quantity),
        section: x.section,
        sort_order: (i + 1) * 10,
        note: x.note?.trim() || null,
        source_set_menu_id: x.source_set_menu_id,
        source_event_menu_id: x.source_event_menu_id,
      })),
    });
  }
  return out;
}

/** One set line to DELETE, carrying the same conflict token an edit carries. */
export type EventMenuRemoveLine = {
  event_menu_id: string;
  known_item_ids: string[];
  known_price: number | null;
};

/**
 * The set lines the save must DELETE: those marked removed that exist on the
 * server. A line that was never saved is dropped from the draft outright, so
 * it never reaches here. Deleting the line takes its copied courses and its
 * food charge with it (ON DELETE CASCADE on both).
 *
 * EACH CARRIES ITS CONFLICT TOKEN, for the reason an edit does: deleting a
 * set someone else has just rewritten would throw their work away without
 * saying so, and a deletion is the one edit nothing can undo (review,
 * 2026-09-20).
 */
export function removedLineIds(drafts: LineDraft[]): EventMenuRemoveLine[] {
  return drafts.flatMap((d) =>
    d.removed && d.eventMenuId != null
      ? [{ event_menu_id: d.eventMenuId, known_item_ids: d.knownItemIds, known_price: d.knownPrice }]
      : [],
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server's own check of the lines to delete. Ids are UUIDs, so a malformed one is refused here and not by Postgres. */
export function validateRemoveIds(ids: unknown): string | null {
  if (!Array.isArray(ids)) return "รูปแบบข้อมูลไม่ถูกต้อง";
  const seen = new Set<string>();
  for (const r of ids as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") return "รูปแบบข้อมูลไม่ถูกต้อง";
    const id = r.event_menu_id;
    if (typeof id !== "string" || !UUID.test(id)) return "รูปแบบข้อมูลไม่ถูกต้อง";
    if (seen.has(id)) return "รูปแบบข้อมูลไม่ถูกต้อง";
    seen.add(id);
    if (!Array.isArray(r.known_item_ids) || (r.known_item_ids as unknown[]).some((x) => typeof x !== "string")) return "รูปแบบข้อมูลไม่ถูกต้อง";
    if (!(r.known_price === null || (typeof r.known_price === "number" && Number.isFinite(r.known_price)))) return "รูปแบบข้อมูลไม่ถูกต้อง";
  }
  return null;
}

/**
 * The server's own check of a payload — the same rules, on what actually
 * arrived rather than on what the screen validated. Null when it may go to
 * the database.
 */
export function validateSavePayload(lines: unknown): string | null {
  if (!Array.isArray(lines) || lines.length === 0) return "ไม่มีรายการที่เปลี่ยนแปลง";
  const newNames = new Set<string>();
  for (const l of lines as Record<string, unknown>[]) {
    if (!l || typeof l !== "object") return "รูปแบบข้อมูลไม่ถูกต้อง";
    const isNew = l.event_menu_id == null;
    if (isNew && (typeof l.set_name !== "string" || l.set_name.trim() === "")) return "ชุดเมนูต้องมีชื่อ";
    if (isNew) {
      const k = nameKey(l.set_name as string);
      if (newNames.has(k)) return `มีชุดชื่อ “${(l.set_name as string).trim()}” อยู่ในงานนี้แล้ว — ตั้งชื่อชุดใหม่ให้ต่างกัน`;
      newNames.add(k);
    }
    if (isNew) {
      const tablesError = menuLineQuantityError("set", l.tables);
      if (tablesError) return tablesError;
    }
    if (!isNew && typeof l.event_menu_id !== "string") return "รูปแบบข้อมูลไม่ถูกต้อง";
    if (!(typeof l.price_per_table === "number" && Number.isFinite(l.price_per_table) && l.price_per_table >= 0)) return "ราคาต่อโต๊ะต้องเป็นตัวเลข 0 หรือมากกว่า";
    if (!Array.isArray(l.known_item_ids) || (l.known_item_ids as unknown[]).some((x) => typeof x !== "string")) return "รูปแบบข้อมูลไม่ถูกต้อง";
    if (!(l.known_price === null || (typeof l.known_price === "number" && Number.isFinite(l.known_price)))) return "รูปแบบข้อมูลไม่ถูกต้อง";
    if (!Array.isArray(l.items)) return "รูปแบบข้อมูลไม่ถูกต้อง";
    const seen = new Set<string>();
    for (const it of l.items as Record<string, unknown>[]) {
      if (typeof it.menu_id !== "string") return "รูปแบบข้อมูลไม่ถูกต้อง";
      if (!(typeof it.quantity === "number" && Number.isFinite(it.quantity) && it.quantity > 0)) return "จำนวนต่อโต๊ะต้องมากกว่า 0";
      if (!(EVENT_MENU_SECTIONS as readonly string[]).includes(it.section as string)) return "หมวดไม่ถูกต้อง";
      if (seen.has(it.menu_id)) return "เมนูซ้ำในชุดเดียวกัน";
      seen.add(it.menu_id);
    }
  }
  return null;
}

/**
 * The names under a set line in the price box (Nik: the names, not a count),
 * in section order then as served. The screen clamps the line to two rows
 * with the full list in the tooltip, so nothing here truncates.
 */
export function dishNamesForPriceBox(dishes: EventMenuDish[], sectionOrder: readonly string[] = EVENT_MENU_SECTIONS): string[] {
  const rank = (s: string) => { const i = sectionOrder.indexOf(s); return i < 0 ? sectionOrder.length : i; };
  return [...dishes]
    .sort((a, b) => rank(a.section) - rank(b.section) || a.sort_order - b.sort_order)
    .map((d) => d.menu_name);
}
