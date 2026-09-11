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
 * It follows that the cell is NOT arithmetic. "485 x 6" prints literally, the
 * two numbers unmultiplied: the price names the portion, the count says how
 * many tables get one. Multiplying them would produce ฿2,910, which is a
 * number nobody on that sheet has any use for. There is no row total and no
 * grand total, and the dishes deliberately do not sum to the package price
 * (ชุดงานนอก 3000's dishes come to ฿2,545 against a ฿3,000 package) — a total
 * would be actively misleading.
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
 * The ราคา cell, printed literally and never multiplied.
 *
 *   485, 6  -> "485 x 6"
 *   485, null -> "485"      the portion size still stands; the table count is
 *                           in the header, so repeating it is not the point
 *   0 / null price -> null  blank rather than "0 x 6", which would tell the
 *                           chef a portion size of zero
 */
export function priceCell(sellingPrice: number | null, tableCount: number | null): string | null {
  if (sellingPrice == null || sellingPrice <= 0) return null;
  const price = fmtPortionPrice(sellingPrice);
  if (tableCount == null || tableCount <= 0) return price;
  return `${price} x ${tableCount}`;
}

/**
 * "2 ที่/โต๊ะ" for a dish the package serves more than once per table, shown
 * beside the dish name.
 *
 * The paper sheet has no way to express this — every row on it is one per
 * table — but the data does: setโต๊ะพรีเมี่ยม carries กุ้งแก้ว (เล็ก) at
 * quantity 5. It goes next to the NAME rather than into ราคา, because ราคา's
 * rule is "the dish price × the number of tables" exactly, and folding a
 * third number into that cell would break the one thing the chef reads it for.
 */
export function perTableQty(quantity: number): string | null {
  return quantity > 1 ? `${quantity} ที่/โต๊ะ` : null;
}
