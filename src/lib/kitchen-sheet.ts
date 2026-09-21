/**
 * The kitchen function sheet's own rules (document B). Pure and tested, for
 * the same reason as function-sheet.ts: the module holds one test booking with
 * no table count, no times and no food format, so the app cannot exercise any
 * of this.
 *
 * ── WHY A CUSTOMER PRICE IS ON A KITCHEN DOCUMENT ─────────────────────────
 *
 * Because THE CHEF READS THE PRICE TO KNOW THE PORTION SIZE. It is not
 * costing and it is not a total. Sompong's à la carte menu sells the same
 * dish at several sizes — ทอดมันปลา (ใหญ่) at ฿440 against the small one, and
 * so on — so the selling price is how the kitchen is told which size to plate
 * for a catering job. That is Nik's explanation, and it is the only thing
 * that makes a customer-facing figure on a kitchen sheet correct rather than
 * a leak.
 *
 * It follows that the price is NEVER multiplied into money. There is no baht
 * total on a row and no grand total, and the dishes deliberately do not sum
 * to the package price (ชุดงานนอก 3000's dishes come to ฿2,545 against a
 * ฿3,000 package) — a money total would be actively misleading. The only
 * total on the sheet is a quantity: plates, or kilos, in the จำนวน cell.
 *
 * ── HOW MANY THE JOB NEEDS — THE RULE TOOK THREE READINGS ─────────────────
 *
 * PLATES (OR KILOS) OF THIS DISH FOR THE WHOLE JOB: per-set count × sets ordered
 * (catering_set_menu_items.quantity × catering_event_menus.quantity).
 * See plateCount() below. Recorded in full so nobody re-derives it:
 *
 *   1. event.table_count — WRONG (shipped 0f14a7f). A booking's table count
 *      is not tied to any one package.
 *   2. per-set quantity alone — WRONG (shipped 62cd336). On Nik's real
 *      10-set booking it printed "590 x 1"; the chef cooks 10 plates.
 *   3. per-set × sets ordered — RIGHT, from that booking.
 *
 * The paper's "590 x 6" was 1-per-set × 6 sets, a product BOTH earlier
 * readings happened to equal — the example could not distinguish the three
 * rules. Only a booking with per-set qty ≠ 1 or sets ≠ 1 could, and the
 * first real one did. Nik's original readings ("180 x 1 ทำ...ไซส์ 180
 * 1 จาน") stay true: that job had one set, so plates = per-set count.
 *
 * ── AND HOW IT PRINTS — THE FOURTH READING (2026-09-21) ────────────────────
 *
 * The count used to ride in the ราคา cell as "price x plates". For a dish
 * sold by weight the unit is a KILO (README, "Dishes sold by weight"), so
 * half a kilo a table for 20 tables printed "1,000 x 10": the chef reads ten
 * plates of the 1-kg size, and the job is twenty half-kilo plates. Now the
 * ราคา cell holds the price alone (the size, "1,000/กก." for a weight-sold
 * dish), and a จำนวน cell holds the per-set quantity and the set count
 * SEPARATELY, then the total: "0.5 กก. × 20 โต๊ะ = 10 กก.", "1 × 10 โต๊ะ =
 * 10". The total is still plateCount(); what changed is that the per-table
 * figure is on the paper. The count's unit follows the booking's food
 * format — โต๊ะ for โต๊ะจีน, กล่อง for อาหารกล่อง, ชุด otherwise — because
 * a box set × 200 is not 200 tables. Both sheets print the cell through ONE
 * function, dishAmount(), so the kitchen and the service team cannot be
 * told different quantities — except that the kitchen blanks a buffet's.
 * Quantities round to three decimals BEFORE the total is taken, so 0.1 kg
 * for 3 tables prints 0.3, never 0.30000000000000004, and with a whole
 * number of sets a printed row adds up (the total is rounded to three
 * decimals too).
 */

const DAYS_FULL = [
  "วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ",
  "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์",
];

/** Abbreviated, as the paper sheet writes them. */
const MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/**
 * "วันพุธที่ 1 ก.ค. 2569" — the paper sheet's date form, which is not the
 * app's usual one. thFullDate gives "พ 1 กรกฎาคม 2569": abbreviated weekday,
 * full month, no "วัน…ที่". Both are correct Thai; this one matches what the
 * kitchen is used to reading.
 */
export function thWeekdayFullDate(iso: string): string {
  const [y, m, day] = iso.split("-").map(Number);
  const dow = new Date(`${iso}T00:00:00`).getDay();
  return `${DAYS_FULL[dow]}ที่ ${day} ${MONTHS_SHORT[(m ?? 1) - 1]} ${(y ?? 2500) + 543}`;
}

/**
 * The heading, and the colour rule that carries meaning on this document:
 * BLUE for งานภายใน, RED for งานภายนอก. From Nik — the kitchen tells the two
 * apart at a glance across the pass, which is why it is the header's colour
 * and not a word buried in a line.
 */
export function kitchenHeading(locationType: string): { text: string; offsite: boolean } {
  const offsite = locationType !== "in_house";
  return { text: offsite ? "งานจัดเลี้ยงภายนอก" : "งานจัดเลี้ยงภายใน", offsite };
}

/** 485 -> "485", 1000 -> "1,000", 547.06 -> "547.06". No ฿, no forced decimals. */
function fmtPortionPrice(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * The ราคา cell: the portion price, which is how the chef knows the SIZE to
 * plate. Printed literally, never multiplied, never a money total. A dish
 * sold by weight is priced per kilo, and says so.
 *
 *   180            -> "180"
 *   1000, weight   -> "1,000/กก."
 *   0 / null price -> null   blank, never a portion size of zero
 */
export function priceCell(sellingPrice: number | null, byWeight = false): string | null {
  if (sellingPrice == null || sellingPrice <= 0) return null;
  return fmtPortionPrice(sellingPrice) + (byWeight ? "/กก." : "");
}

/** A quantity as the kitchen reads it: grouped, at most three decimals. */
export function fmtQty(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

/** What a set line's count counts, by the booking's food format. */
export function setCountUnit(foodFormat: string | null): string {
  if (foodFormat === "chinese_table") return "โต๊ะ";
  if (foodFormat === "box_set") return "กล่อง";
  return "ชุด";
}

/** Between the per-set part and the total; AmountText breaks a line only here. */
export const AMOUNT_TOTAL_SEPARATOR = " = ";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The จำนวน cell: the per-set quantity and the set count separately, then
 * the total (the fourth reading, in the file header).
 *
 *   1, 10                 -> "1 × 10 โต๊ะ = 10"
 *   0.5, 20, weight       -> "0.5 กก. × 20 โต๊ะ = 10 กก."
 *   2, 200, _, "กล่อง"    -> "2 × 200 กล่อง = 400"
 *   2, 1                  -> "2"     one set: nothing to multiply
 *   3, null               -> "3"     a dish ordered directly: the whole job
 *   0 or less, either one -> null    blank, never a quantity nobody ordered
 *
 * `sets` is catering_event_menus.quantity for a package row, and null ONLY
 * for a dish ordered directly (รายการอาหารเพิ่มเติม), whose quantity already
 * is the whole job's. The per-set figure is rounded first and the total
 * taken from it, so with a whole number of sets the row adds up as printed.
 */
export function amountCell(perSet: number, sets: number | null, byWeight = false, unit = "โต๊ะ"): string | null {
  const per = round3(perSet);
  if (!(per > 0)) return null;
  const u = byWeight ? " กก." : "";
  if (sets == null || sets === 1) return `${fmtQty(per)}${u}`;
  if (!(sets > 0)) return null;
  return `${fmtQty(per)}${u} × ${fmtQty(sets)} ${unit}${AMOUNT_TOTAL_SEPARATOR}${fmtQty(plateCount(per, sets))}${u}`;
}

/** An จำนวน cell split where AmountText may break it: [per-set part, total or null]. */
export function splitAmount(text: string): [string, string | null] {
  const at = text.indexOf(AMOUNT_TOTAL_SEPARATOR);
  return at < 0 ? [text, null] : [text.slice(0, at), text.slice(at + 1)];
}

type DishLine = { quantity: number; menu_id: string | null };

/**
 * The จำนวน cell for one dish line, as BOTH function sheets print it. One
 * function, so the kitchen and the service team cannot be told different
 * quantities (the kitchen page blanks it for a buffet, by its own rule).
 * `sets` null: a dish ordered directly.
 */
export function dishAmount(line: DishLine, sets: number | null, weightIds: Set<string>, foodFormat: string | null): string | null {
  return amountCell(line.quantity, sets, line.menu_id != null && weightIds.has(line.menu_id), setCountUnit(foodFormat));
}

/** The ราคา cell for one dish line (the kitchen sheet only). */
export function dishPrice(sellingPrice: number | null, menuId: string | null, weightIds: Set<string>): string | null {
  return priceCell(sellingPrice, menuId != null && weightIds.has(menuId));
}

/**
 * The POS divisor that marks a dish sold by the kilo. Such a dish counts one
 * app unit as one kilo, and the POS sells it per ขีด, so its POS name is
 * divided by 10. River prawn is ÷4 (one 4-ขีด plate) and a half-kilo button
 * ÷2: neither makes a dish print in kilos.
 */
export const KILO_DIVISOR = 10;

/** The menus that print in kilos: those with a ÷10 POS divisor. */
export function weightSoldMenuIds(divisors: { menu_id: string; divisor: number }[]): Set<string> {
  return new Set(divisors.filter((d) => Number(d.divisor) === KILO_DIVISOR).map((d) => d.menu_id));
}

/**
 * Plates of one dish for the whole job: per-set count × sets ordered. The
 * three readings this rule went through are in the file header — do not
 * re-derive it from the paper example, which cannot distinguish them.
 * Used by BOTH function sheets, so the kitchen's plate count and the service
 * sheet's จำนวน column can never disagree.
 */
export function plateCount(perSetQty: number, setsOrdered: number): number {
  return perSetQty * setsOrdered;
}
