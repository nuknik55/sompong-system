// Relative and WITH the .ts extension, unlike most of this codebase.
//
// `npm test` is `node --test "src/**/*.test.ts"`, and Node resolves plain
// Node specifiers: the "@/" alias does not exist for it, and an extensionless
// relative path does not resolve either. Every other tested library module
// gets away with both because its only cross-file imports are `import type`,
// which Node strips before resolution ever happens. This module imports two
// real values, so it is the first to hit it.
//
// tsconfig already sets allowImportingTsExtensions, so tsc and the Next build
// accept this form — verified by running both, not assumed.
//
// calendar-grid is deliberately plain date math with no "use client"/"use
// server" directive, so a library module may import it.
import { daysInMonth } from "../app/owner/catering/calendar-grid.ts";
import { splitPosDiscounts, type PosMonthlyExport } from "./pos-parse.ts";

/**
 * Project one month's POS export into the rows the accounting module stores.
 *
 * Pure: no I/O, no Supabase, no env. Takes the parsed export and the stored
 * category map, returns what would be written plus every reason not to write
 * it. Nothing here decides to write — that is the RPC's job.
 *
 * ── THE SIX TYPES THIS OWNS, AND THE ONE IT DOES NOT ──────────────────────
 *
 *   food · drink · dessert · souvenir · pos_other   dine-in, by item category
 *   delivery                                        every non-coffee Grab/LM line
 *
 * `other` belongs to the outsourced accountant and the in-house bookkeeper.
 * It is absent from RevenueType entirely, so this module cannot name it and
 * the RPC's allowlist cannot receive it. See supabase/README.md.
 *
 * Coffee-shop sales are excluded from all six: they are not restaurant
 * revenue. An item whose category is `coffee` leaves completely, and an item
 * carrying a per-unit carve-out (ไอติมข้าวเหนียวมะม่วง, ฿15 of ฿129) leaves
 * only that share — the remainder stays in its own category.
 */

export const REVENUE_TYPES = [
  "food",
  "drink",
  "dessert",
  "delivery",
  "souvenir",
  "pos_other",
] as const;

export type RevenueType = (typeof REVENUE_TYPES)[number];

/** A row of pos_item_categories, as this module needs it. */
export type StoredCategory = {
  category: string;
  coffeeSharePerUnit: number | null;
};

/** Sale modes that are a delivery platform rather than the restaurant floor. */
const DELIVERY_MODES = new Set(["Grab", "Lineman"]);

/** POS item category → the revenue type its DINE-IN sales belong to. */
const DINE_IN_TYPE: Record<string, RevenueType> = {
  food: "food",
  drink: "drink",
  dessert: "dessert",
  souvenir: "souvenir",
  other: "pos_other",
};

export type ExpenseWrite = {
  coa_code: "650" | "752" | "753";
  amount: number;
  bill_ref: string;
  note: string;
};

export type RevenueProjection = {
  yearMonth: string;
  /** Last day of the month; the date the three expense entries carry. */
  entryDate: string;
  revenue: { revenue_type: RevenueType; amount: number }[];
  expenses: ExpenseWrite[];
  /** The export's own Sheet3 gross — every baht, coffee included. */
  grossTotal: number;
  /** grossTotal less everything that left for the coffee shop. */
  restaurantGross: number;
  /** Coffee-category sales plus carve-outs. Written nowhere; shown for reconciliation. */
  coffeeGross: number;
  /** The carve-out share alone, inside coffeeGross. */
  carveOut: number;
  discounts: ReturnType<typeof splitPosDiscounts>;
  platformFees: { method: string; amount: number; fee: number; ratePct: number }[];
  covers: { bills: number; customers: number; cancelledBills: number; cancelledAmount: number };
};

/**
 * A reason the projection must not be written.
 *
 * Returned as data rather than thrown: the screen has to SHOW the unstored
 * products before Nik can fix them, and a thrown message is redacted in
 * production anyway.
 */
export type ProjectionBlock =
  | { kind: "period"; message: string }
  | { kind: "unstored"; products: { productName: string; gross: number }[]; totalGross: number }
  | { kind: "sum"; label: string; computed: number; expected: number };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Sheet3 rounds its header to the baht, so equality is to ฿1, not to the satang. */
const TOLERANCE = 1;

/**
 * Project, and list every blocking reason.
 *
 * A non-empty `blocks` means do not write, whatever the projection says. The
 * projection is still returned so the preview can show the numbers beside the
 * reason they are refused.
 */
export function projectPosRevenue(
  report: PosMonthlyExport,
  yearMonth: string,
  categories: ReadonlyMap<string, StoredCategory>,
): { projection: RevenueProjection; blocks: ProjectionBlock[] } {
  const blocks: ProjectionBlock[] = [];

  // ── Split every line by category and channel ────────────────────────────
  const dineIn = new Map<RevenueType, number>();
  const delivery = new Map<RevenueType, number>();
  const unstored = new Map<string, number>();
  let coffeeGross = 0;
  let carveOut = 0;

  for (const line of report.lines) {
    if (!line.productName) continue;
    const stored = categories.get(line.productName);
    if (!stored) {
      // No default, ever — the same rule the classification screen enforces.
      // A missing row means "nobody has decided yet", and guessing here would
      // put revenue in a category no one chose.
      unstored.set(line.productName, (unstored.get(line.productName) ?? 0) + line.gross);
      continue;
    }

    if (stored.category === "coffee") {
      coffeeGross += line.gross;
      continue;
    }

    let remaining = line.gross;
    if (stored.coffeeSharePerUnit != null) {
      // The category is where the money goes; the carve-out is what LEAVES
      // for the coffee shop. ฿129 dessert with a ฿15 carve-out is ฿114
      // dessert and ฿15 coffee — not ฿129 of coffee.
      const carve = stored.coffeeSharePerUnit * line.qty;
      carveOut += carve;
      coffeeGross += carve;
      remaining -= carve;
    }

    const bucket = DELIVERY_MODES.has(line.saleMode) ? delivery : dineIn;
    // Delivery is a CHANNEL bucket: every non-coffee category sold through
    // Grab or LineMan lands on one line, because that is how Nik reads it.
    const type = DELIVERY_MODES.has(line.saleMode)
      ? "delivery"
      : DINE_IN_TYPE[stored.category];
    if (!type) {
      // A category the CHECK allows but this map does not know. Impossible
      // today (all six are mapped); a guard rather than dead code, because
      // silently dropping revenue is the failure this whole module avoids.
      unstored.set(line.productName, (unstored.get(line.productName) ?? 0) + line.gross);
      continue;
    }
    bucket.set(type, (bucket.get(type) ?? 0) + remaining);
  }

  if (unstored.size > 0) {
    const products = [...unstored.entries()]
      .map(([productName, gross]) => ({ productName, gross: round2(gross) }))
      .sort((a, b) => b.gross - a.gross);
    blocks.push({
      kind: "unstored",
      products,
      totalGross: round2(products.reduce((s, p) => s + p.gross, 0)),
    });
  }

  // ── Revenue rows ────────────────────────────────────────────────────────
  const amounts = new Map<RevenueType, number>();
  for (const [type, amount] of dineIn) amounts.set(type, (amounts.get(type) ?? 0) + amount);
  for (const [, amount] of delivery) {
    amounts.set("delivery", (amounts.get("delivery") ?? 0) + amount);
  }

  const revenue = REVENUE_TYPES.filter((t) => (amounts.get(t) ?? 0) > 0).map((t) => ({
    revenue_type: t,
    amount: round2(amounts.get(t)!),
  }));

  // ── Expense entries ─────────────────────────────────────────────────────
  //
  // All three carry the FULL figure from the file, including the part
  // attributable to coffee sales — about ฿193 of discount and ฿430 of GP in
  // August, 0.016% of revenue. That is what the bank account and the platform
  // statements actually show, and Sheet3 reports discounts by TYPE rather
  // than by item, so splitting them would mean allocating a total the file
  // does not break down. A measured approximation, recorded rather than
  // hidden — the same treatment as the CRM half.
  const discounts = splitPosDiscounts(report.discounts);
  const expenses: ExpenseWrite[] = [];

  const discountBooked = round2(discounts.discount + discounts.crmBooked);
  if (discountBooked > 0) {
    expenses.push({
      coa_code: "650",
      amount: discountBooked,
      bill_ref: `POS-DISCOUNT-${yearMonth}`,
      note: `ส่วนลด POS ${yearMonth} (ส่วนลด ${round2(discounts.discount)} + CRM ครึ่งหนึ่ง ${round2(discounts.crmBooked)})`,
    });
  }

  const platformFees: RevenueProjection["platformFees"] = [];
  for (const [pattern, coa, label] of [
    [/^line\s*man$/i, "752", "LineMan"],
    [/^grab$/i, "753", "Grab"],
  ] as const) {
    const payment = report.payments.find((p) => pattern.test(p.method.trim()));
    if (!payment || payment.platformFee <= 0) continue;
    platformFees.push({
      method: label,
      amount: round2(payment.amount),
      fee: round2(payment.platformFee),
      ratePct: payment.amount > 0 ? round2((payment.platformFee / payment.amount) * 100) : 0,
    });
    expenses.push({
      coa_code: coa,
      amount: round2(payment.platformFee),
      bill_ref: `POS-GP-${coa === "752" ? "LM" : "GRAB"}-${yearMonth}`,
      note: `GP ${label} ${yearMonth} (ยอดขาย ${round2(payment.amount)})`,
    });
  }

  // ── The two sum invariants ──────────────────────────────────────────────
  //
  // Arithmetic over the same rows the write uses, so a failure is a bug in
  // this module or in the category data, never a benign difference. Refusing
  // on them costs nothing and catches a wrong split before it reaches the
  // P&L. They are skipped when products are unstored, because those lines are
  // deliberately in neither total and the mismatch would be the symptom
  // rather than the cause.
  const restaurantGross = round2(revenue.reduce((s, r) => s + r.amount, 0));
  const everything = round2(restaurantGross + coffeeGross);

  if (unstored.size === 0) {
    if (Math.abs(everything - report.grossTotal) > TOLERANCE) {
      blocks.push({
        kind: "sum",
        label: "ยอดขายทุกหมวดรวมกัน (รวมร้านกาแฟ) ไม่เท่ากับยอดรวมในไฟล์",
        computed: everything,
        expected: report.grossTotal,
      });
    }
    const expectedRestaurant = round2(report.grossTotal - coffeeGross);
    if (Math.abs(restaurantGross - expectedRestaurant) > TOLERANCE) {
      blocks.push({
        kind: "sum",
        label: "ยอดที่จะบันทึกเป็นรายได้ ไม่เท่ากับยอดรวมหักร้านกาแฟ",
        computed: restaurantGross,
        expected: expectedRestaurant,
      });
    }
  }

  const [y, m] = yearMonth.split("-").map(Number);
  const entryDate = `${yearMonth}-${String(daysInMonth(y!, m!)).padStart(2, "0")}`;

  return {
    projection: {
      yearMonth,
      entryDate,
      revenue,
      expenses,
      grossTotal: round2(report.grossTotal),
      restaurantGross,
      coffeeGross: round2(coffeeGross),
      carveOut: round2(carveOut),
      discounts,
      platformFees,
      covers: {
        bills: report.billCount,
        customers: report.customerCount,
        cancelledBills: report.cancelledBills,
        cancelledAmount: round2(report.cancelledAmount),
      },
    },
    blocks,
  };
}
