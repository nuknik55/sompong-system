/**
 * The booking screen's price box as it is loaded from the charge rows and as
 * it is sent to saveBooking: the pure half of BookingScreen.tsx, moved here
 * (2026-09-21) so that the round trip can be tested with the real functions.
 *
 * ── A MENU LINE'S QUANTITY IS SAVED AS TYPED (Nik, 2026-09-21) ────────────
 *
 * Until then every set and dish line was saved as Math.max(1, typed), on
 * every save of the booking: half a kilo of a dish sold by weight became a
 * kilo and the quotation doubled. The two kinds now have a rule each, and
 * neither is ever changed silently: a quantity outside its rule is refused
 * with a message, by the screen (naming the line) and again by saveBooking.
 *
 *   - DISH: portions of that dish in its own unit (for a dish sold by weight
 *     one unit is one kilo), so any number above 0, decimals included: half
 *     a kilo is 0.5.
 *   - SET: the tables (or boxes, or sets) the package is served at. The
 *     kitchen sheet multiplies every per-table portion by it and the quote
 *     charges the price per table times it, so it is a whole number, at
 *     least 1: there is no half table. A smaller portion is a dish quantity.
 *   - Neither above MENU_LINE_QUANTITY_MAX: a quantity so large that price
 *     × quantity overflows would reach the charge insert as null, after the
 *     save has already deleted the booking's charge rows (review, 2026-09-21).
 *
 * saveBooking judges a line it already stores by the STORED kind, not the
 * kind the caller sends: a set line cannot be held to the dish rule by
 * calling it a dish.
 */
import type { BookingLine, CateringCharge } from "./actions";
import { toNum } from "./to-num.ts";

export type Line = {
  key: string;
  /** set/dish: a menu line (unit price locked to the menu). rate: from catering_rates. manual: typed. discount: negative. */
  kind: "set" | "dish" | "rate" | "manual" | "discount";
  section: Section;
  refId: string | null;
  eventMenuId: string | null;
  label: string;
  unitPrice: string;
  quantity: string;
  amount: string;
  chargeType: string;
};

export type Section = "menu" | "room" | "drink" | "delivery" | "music" | "other" | "discount";

const SECTION_BY_CHARGE_TYPE: Record<string, Section> = {
  venue: "room", drink: "drink", transport: "delivery", discount: "discount", food: "menu",
};

/** rate_type -> price-box section, for charges that KNOW their rate. */
const SECTION_BY_RATE_TYPE: Record<string, Section> = {
  room: "room", delivery: "delivery", drink: "drink", music: "music",
  staff_bonus: "other", food_set: "other", other: "other",
};

/**
 * Which price-box section a STORED charge belongs to, on reload. While the
 * screen is open the section is known exactly — the row was added from that
 * section's own rate picker — but nothing persists it, so it has to be
 * reconstructed from the charge.
 *
 * ── THE ดนตรี BRANCH WAS DEAD, AND THIS IS THE PARTIAL FIX ────────────────
 *
 * It tested charge_type === 'service'. No rate maps to 'service':
 * RATE_TYPE_TO_CHARGE_TYPE sends rate_type 'music' to **'other'**. So every
 * music charge added from the rate picker — including the karaoke sets and
 * ค่าไฟวงดนตรีลูกค้า — reloaded into อื่นๆ, and the ดนตรี section was
 * unreachable except for a hand-typed row somebody had set to บริการ. Both
 * charge types are now tested, so the rate-picker path works.
 *
 * ── NOW STRUCTURAL, WITH A LEGACY TAIL ────────────────────────────────────
 *
 * catering_rate_provenance_migration.sql gave charges a rate_id, so a
 * rate-backed charge maps rate_type -> section directly — no label reading.
 * The label regex below survives ONLY for legacy rows saved before the
 * column existed (rate_id NULL forever, by design: history was not given
 * provenance it never had). It shrinks to nothing as old bookings close,
 * and it can still misfile a legacy อื่นๆ line named "ค่าวงดนตรี" — known,
 * bounded, and dying.
 */
function sectionForCharge(c: CateringCharge): Section {
  if (c.event_menu_id) return "menu";
  if (c.rate_type) return SECTION_BY_RATE_TYPE[c.rate_type] ?? "other";
  if (c.charge_type === "discount") return "discount";
  if ((c.charge_type === "service" || c.charge_type === "other") && /ดนตรี|คาราโอเกะ|วง/.test(c.label)) return "music";
  return SECTION_BY_CHARGE_TYPE[c.charge_type] ?? "other";
}

export function linesFromCharges(charges: CateringCharge[]): Line[] {
  return charges.map((c) => ({
    key: c.id,
    // A stored rate-backed row round-trips as kind "rate" with its refId, so
    // the NEXT save re-sends rate_id instead of silently demoting the row to
    // a manual line — the same thread-it-through rule as event_menu_id.
    kind: c.event_menu_id ? (c.event_menu_kind === "set" ? "set" : "dish") : c.rate_id ? "rate" : c.charge_type === "discount" ? "discount" : "manual",
    section: sectionForCharge(c),
    // A menu line's refId is the set or dish it references, so the picker's
    // "one line per set" check sees a LOADED line too (review, 2026-09-19).
    refId: c.event_menu_id ? c.event_menu_ref : c.rate_id,
    eventMenuId: c.event_menu_id,
    label: c.label,
    unitPrice: String(c.unit_price),
    quantity: String(c.quantity),
    amount: String(c.amount),
    chargeType: c.charge_type,
  }));
}

/** Well above any real booking; there only so that price × quantity stays finite. */
export const MENU_LINE_QUANTITY_MAX = 100_000;

const SET_RULE = "จำนวนโต๊ะต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป";
const DISH_RULE = "จำนวนต้องมากกว่า 0 (ใส่ทศนิยมได้ เช่น 0.5)";
const TOO_MANY = "จำนวนต้องไม่เกิน 100,000";

/** Why `q` is not a valid quantity for a menu line of this kind, in Thai; null when it is (the file header). */
export function menuLineQuantityError(kind: "set" | "dish", q: unknown): string | null {
  if (typeof q !== "number" || !Number.isFinite(q)) return kind === "set" ? SET_RULE : DISH_RULE;
  if (q > MENU_LINE_QUANTITY_MAX) return TOO_MANY;
  if (kind === "set") return Number.isInteger(q) && q >= 1 ? null : SET_RULE;
  return q > 0 ? null : DISH_RULE;
}

export function menuLineQuantityOk(kind: "set" | "dish", q: unknown): boolean {
  return menuLineQuantityError(kind, q) === null;
}

/**
 * The screen's check before it saves: the first menu line whose typed
 * quantity breaks its rule, named, or null when there is none. Rate, typed
 * and discount lines are not menu lines and are not checked here.
 */
export function priceBoxQuantityProblem(lines: Line[]): string | null {
  for (const l of lines) {
    if (l.kind !== "set" && l.kind !== "dish") continue;
    const error = menuLineQuantityError(l.kind, toNum(l.quantity));
    if (error) return `“${l.label}”: ${error}`;
  }
  return null;
}

/**
 * saveBooking's own check of the same rule, on what it was sent: the screen
 * is not the only possible caller. A line of any kind but "charge" is a menu
 * line, as saveBooking treats it. A line the booking already stores is held
 * to its STORED kind (`storedKinds`, by event_menu id); any other line to
 * the kind sent, anything but "set" being a dish, as addCateringEventMenu
 * treats it. `storedKinds` is required, so that no caller can leave it out
 * and let a set line through under the dish rule (review, 2026-09-21).
 */
export function bookingLinesQuantityProblem(
  lines: BookingLine[],
  storedKinds: ReadonlyMap<string, "set" | "dish">,
): string | null {
  const bad = lines.some((l) => {
    if (l.kind === "charge") return false;
    const kind = (l.eventMenuId ? storedKinds.get(l.eventMenuId) : undefined) ?? (l.kind === "set" ? "set" : "dish");
    return !menuLineQuantityOk(kind, l.quantity);
  });
  return bad
    ? "จำนวนในกล่องราคาไม่ถูกต้อง — เมนูเดี่ยวต้องมากกว่า 0 ชุดเมนูต้องเป็นจำนวนโต๊ะเต็มตั้งแต่ 1 และไม่เกิน 100,000 ยังไม่ได้บันทึกอะไร"
    : null;
}

/**
 * A menu line's charge: price × quantity TO THE SATANG, the rounding the
 * screen already shows (updateLine). 1,300 × 0.7 is 909.9999999999999 in
 * floating point; the charge row would have kept it.
 */
export function menuChargeAmount(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity * 100) / 100;
}

/**
 * The price box as saveBooking takes it. A menu line's quantity goes as
 * typed: the screen has refused one outside its rule before it gets here
 * (priceBoxQuantityProblem), and saveBooking refuses it again.
 */
export function bookingLinesForSave(lines: Line[]): BookingLine[] {
  return lines
    .filter((l) => l.kind === "set" || l.kind === "dish" || l.label.trim() !== "")
    .map((l): BookingLine =>
      l.kind === "set" || l.kind === "dish"
        ? { kind: l.kind, refId: l.refId ?? "", eventMenuId: l.eventMenuId, quantity: toNum(l.quantity) ?? 0 }
        : { kind: "charge", label: l.label, charge_type: l.chargeType, unit_price: toNum(l.unitPrice) ?? 0, quantity: toNum(l.quantity) ?? 1, amount: toNum(l.amount) ?? 0, note: null, rate_id: l.kind === "rate" ? l.refId : null },
    );
}
