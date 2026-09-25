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
 *
 * ── EVERY LINE IS CHECKED BEFORE ANYTHING IS WRITTEN (Nik, 2026-09-21) ─────
 *
 * The save used to delete every charge row of the booking and then insert
 * the new list, so ONE bad line — a missing amount, a negative price, an
 * overflowing figure — failed the insert after the delete and left the
 * booking with no price lines at all. Now the screen checks every line
 * (priceBoxProblem), saveBooking checks what it was sent
 * (bookingLinesProblem), the database function checks again in a dry run
 * before the booking's own fields are written, and the price box itself is
 * written by catering_save_booking_prices in ONE transaction: whole, or not
 * at all. A dish quantity takes at most three decimals, so the quote and the
 * kitchen's sheets print the same number, and a quantity too small to print
 * (below 0.001) is refused rather than printed blank.
 */
import type { BookingLine, CateringCharge } from "./actions";
import { toNum } from "./to-num.ts";
import { freeMarkProblem } from "../../../lib/event-sheet.ts";

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
  /** The stored charge's note; null for a new line. The screen shows none; the save carries it through. */
  note: string | null;
  /**
   * แถมฟรี, ticked by hand (Nik, 2026-09-24): a ฿0 dish, rate or typed line
   * that prints under รายการแถมฟรี on the event-details sheet. Never a set
   * (a set's free items are its own "free" section) and never the discount;
   * never inferred from a ฿0 price (the screen only warns about those).
   */
  free: boolean;
  /** The price the line had when แถมฟรี was ticked on this screen: unticking gives it back. Never saved. */
  unitPriceBeforeFree?: string;
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
    note: c.note,
    // Only a line that can carry the mark loads with it: a set or the
    // discount marked by a direct write would otherwise block every save.
    free: c.is_free === true && !(c.event_menu_id ? c.event_menu_kind === "set" : c.charge_type === "discount"),
  }));
}

/** Well above any real booking; there only so that price × quantity stays finite. */
export const MENU_LINE_QUANTITY_MAX = 100_000;

/** The most one charge line may carry either way: far above any catering line, far below an overflow. */
export const CHARGE_MONEY_MAX = 100_000_000;

/** What catering_event_charges' CHECK accepts. "food" belongs to menu lines only. */
export const CHARGE_TYPES = ["food", "drink", "venue", "service", "transport", "equipment", "other", "discount"] as const;

const TOO_MANY = "จำนวนต้องไม่เกิน 100,000";
const DISH_RULE = "จำนวนต้องมากกว่า 0 และมีทศนิยมไม่เกิน 3 ตำแหน่ง (เช่น 0.5)";
const setRule = (unit: string) => `จำนวน${unit}ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`;

/**
 * At most three decimal places, read with a tolerance, because 1.005 × 1000
 * is 1004.9999999999999 in floating point and must still count as three. The
 * sheets print three decimals (dishAmount), so a fourth would print rounded
 * on the kitchen's paper and in full on the customer's quote.
 */
export function hasAtMost3Decimals(q: number): boolean {
  const scaled = q * 1000;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * Why `q` is not a valid quantity for a menu line of this kind, in Thai; null
 * when it is (the file header). `unit` is what a set counts on THIS booking —
 * โต๊ะ, กล่อง or ชุด, the kitchen sheet's own word (setCountUnit).
 */
export function menuLineQuantityError(kind: "set" | "dish", q: unknown, unit = "โต๊ะ"): string | null {
  if (typeof q !== "number" || !Number.isFinite(q)) return kind === "set" ? setRule(unit) : DISH_RULE;
  if (q > MENU_LINE_QUANTITY_MAX) return TOO_MANY;
  if (kind === "set") return Number.isInteger(q) && q >= 1 ? null : setRule(unit);
  return q > 0 && hasAtMost3Decimals(q) ? null : DISH_RULE;
}

export function menuLineQuantityOk(kind: "set" | "dish", q: unknown): boolean {
  return menuLineQuantityError(kind, q) === null;
}

/** A rate, a typed line or the discount, as saveBooking takes it. */
export type ChargeLine = Extract<BookingLine, { kind: "charge" }>;

/**
 * Why a charge line cannot be written, in Thai and without its name (the
 * caller names the line); null when it can. Each rule is one the database
 * would otherwise enforce by failing the insert — and until
 * catering_save_booking_prices that failure came AFTER every charge row of
 * the booking had been deleted, so it left the price box empty (Nik,
 * 2026-09-21).
 */
export function chargeLineError(c: ChargeLine): string | null {
  if (typeof c.label !== "string" || c.label.trim() === "") return "ต้องมีชื่อรายการ";
  if (!(CHARGE_TYPES as readonly string[]).includes(c.charge_type)) return "ประเภทรายการไม่ถูกต้อง";
  if (c.charge_type === "food") return "อาหารต้องเลือกจากชุดเมนูหรือเมนูเดี่ยว — รายการที่พิมพ์เองหรือเลือกจากอัตราใช้ประเภทอาหารไม่ได้";
  for (const n of [c.unit_price, c.quantity, c.amount]) {
    if (typeof n !== "number" || !Number.isFinite(n)) return "ราคา จำนวน และยอดเงินต้องเป็นตัวเลข";
  }
  if (Math.abs(c.unit_price) > CHARGE_MONEY_MAX || Math.abs(c.amount) > CHARGE_MONEY_MAX) return "ยอดเงินต้องไม่เกิน 100,000,000 บาท";
  if (c.quantity < 0 || c.quantity > MENU_LINE_QUANTITY_MAX) return "จำนวนต้องอยู่ระหว่าง 0 ถึง 100,000";
  if (c.charge_type === "discount") {
    if (c.amount > 0) return "ส่วนลดต้องเป็นยอดติดลบหรือ 0";
  } else if (c.unit_price < 0 || c.amount < 0) {
    return "ราคาและยอดเงินต้องไม่ติดลบ — ถ้าเป็นส่วนลด ให้ใช้แถวส่วนลด";
  }
  if (c.rate_id !== null && typeof c.rate_id !== "string") return "รูปแบบข้อมูลไม่ถูกต้อง";
  if (c.note !== null && typeof c.note !== "string") return "รูปแบบข้อมูลไม่ถูกต้อง";
  if (c.is_free !== undefined && typeof c.is_free !== "boolean") return "รูปแบบข้อมูลไม่ถูกต้อง";
  // A free line is ฿0 a unit and ฿0 in all, and never the discount (the database's CHECK).
  if (c.is_free && (c.charge_type === "discount" || c.amount !== 0 || c.unit_price !== 0)) return "รายการแถมฟรีต้องเป็น ฿0 (ราคาต่อหน่วย 0 และยอด 0) และไม่ใช่ส่วนลด";
  return null;
}

/** A typed row nobody filled in — no name, no price, no amount: not a line. Dropped from the save, as it always was. */
export function isEmptyTypedRow(l: Line): boolean {
  return l.kind === "manual" && l.label.trim() === "" && (toNum(l.unitPrice) ?? 0) === 0 && (toNum(l.amount) ?? 0) === 0;
}

/** The charge a rate, typed or discount line sends — one mapping, for the save and for its check. */
function chargeFromLine(l: Line): ChargeLine {
  return {
    kind: "charge", label: l.label, charge_type: l.chargeType,
    unit_price: toNum(l.unitPrice) ?? 0, quantity: toNum(l.quantity) ?? 1, amount: toNum(l.amount) ?? 0,
    // The stored note, carried through: the screen shows none, and a save
    // used to write null over it (2026-09-21).
    note: l.note,
    rate_id: l.kind === "rate" ? l.refId : null,
    is_free: l.free,
  };
}

/**
 * The screen's check before it saves: the first line that cannot be written,
 * named, or null when every line can. Menu lines by the quantity rule of their
 * kind, `unit` being what a set counts on this booking; every other line by
 * chargeLineError. An empty typed row is not a line.
 */
export function priceBoxProblem(lines: Line[], unit: string | ((l: Line) => string) = "โต๊ะ"): string | null {
  for (const l of lines) {
    if (l.kind === "set" || l.kind === "dish") {
      // A per-head set line counts guests: its own word, not the booking's.
      const error = menuLineQuantityError(l.kind, toNum(l.quantity), typeof unit === "function" ? unit(l) : unit);
      if (error) return `“${l.label}”: ${error}`;
      const free = freeMarkProblem({ kind: l.kind, label: l.label, amount: toNum(l.amount) ?? 0, free: l.free });
      if (free) return `“${l.label}”: ${free}`;
      continue;
    }
    if (isEmptyTypedRow(l)) continue;
    const error = chargeLineError(chargeFromLine(l));
    if (error) {
      return l.label.trim() === ""
        ? `มีรายการที่ยังไม่มีชื่อในกล่องราคา — ${error} (ใส่ชื่อ หรือกด ✕ ลบแถวนั้น)`
        : `“${l.label.trim()}”: ${error}`;
    }
  }
  return null;
}

/**
 * saveBooking's own check, on what it was sent — the screen is not the only
 * possible caller. Every line an object of kind set, dish or charge. A menu
 * line the booking already stores is held to its STORED kind (`storedKinds`,
 * by event_menu id — required, so that no caller can leave it out and let a
 * set line through under the dish rule; review, 2026-09-21); any other line
 * to the kind sent. Charge lines by chargeLineError. Nothing has been written
 * when this refuses, and the message says so.
 */
export function bookingLinesProblem(
  lines: unknown,
  storedKinds: ReadonlyMap<string, "set" | "dish">,
  unit = "โต๊ะ",
): string | null {
  const BAD = "รูปแบบข้อมูลไม่ถูกต้อง — ยังไม่ได้บันทึกอะไร";
  if (!Array.isArray(lines)) return BAD;
  for (const raw of lines as unknown[]) {
    if (!raw || typeof raw !== "object") return BAD;
    const l = raw as BookingLine;
    if (l.kind === "charge") {
      const error = chargeLineError(l);
      if (error) {
        const name = typeof l.label === "string" && l.label.trim() !== "" ? `“${l.label.trim()}”` : "รายการที่ยังไม่มีชื่อ";
        return `${name}: ${error} — ยังไม่ได้บันทึกอะไร`;
      }
      continue;
    }
    if (l.kind !== "set" && l.kind !== "dish") return BAD;
    const kind = (typeof l.eventMenuId === "string" ? storedKinds.get(l.eventMenuId) : undefined) ?? l.kind;
    if (l.is_free !== undefined && typeof l.is_free !== "boolean") return BAD;
    if (l.is_free && kind === "set") return "ชุดเมนูทำเครื่องหมายแถมฟรีไม่ได้ — ยังไม่ได้บันทึกอะไร";
    const error = menuLineQuantityError(kind, l.quantity, unit);
    if (error) return `จำนวนในกล่องราคาไม่ถูกต้อง: ${error} — ยังไม่ได้บันทึกอะไร`;
  }
  return null;
}

/**
 * The price box as saveBooking takes it. A menu line sends its quantity as
 * typed and NO PRICE: a menu line's price is the stored charge's (THE ONE
 * PRICE — the menu page edits it), taken from the database by
 * catering_save_booking_prices. The screen has refused a line outside its
 * rule before it gets here (priceBoxProblem), and saveBooking refuses it
 * again.
 */
export function bookingLinesForSave(lines: Line[]): BookingLine[] {
  return lines
    .filter((l) => !isEmptyTypedRow(l))
    .map((l): BookingLine =>
      l.kind === "set" || l.kind === "dish"
        ? { kind: l.kind, refId: l.refId ?? "", eventMenuId: l.eventMenuId, quantity: toNum(l.quantity) ?? 0, is_free: l.kind === "dish" && l.free }
        : chargeFromLine(l),
    );
}
