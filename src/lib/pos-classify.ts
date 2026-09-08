import type { PosMonthlyExport } from "./pos-parse";

/**
 * One POS product, aggregated across every sale mode it was sold in, with the
 * two numbers the classification screen needs to show a coffee total that is
 * NET OF DISCOUNT AND PLATFORM GP.
 *
 * The screen compares its running total against the figure Nik books, and
 * that figure is net: gross, less POS discounts, less what Grab and LineMan
 * keep. So the contribution of an item depends on WHICH CHANNEL each unit was
 * sold through, and the client — which only sees one row per product — cannot
 * recompute that. These two numbers fold the per-channel work in here so the
 * client is left with a multiplication:
 *
 *   category = coffee            → contributes netWhole
 *   carve-out of s baht per unit → contributes s × carveWeight
 */
export type ClassificationItem = {
  productName: string;
  /** Every POS group/category this item appeared under, joined for display. */
  where: string;
  qty: number;
  /** รวมราคา, before discount — the basis revenue is booked on. */
  gross: number;
  /** Σ over lines of (gross − discount) × (1 − rate): the whole line, net. */
  netWhole: number;
  /** Σ over lines of qty × (1 − rate): multiply by a per-unit carve-out to net it. */
  carveWeight: number;
};

/** Sale modes that carry no platform commission. */
const NO_COMMISSION_MODES = new Set(["Eat In", "อาหารห่อ"]);

/** Sale mode → the Sheet2 payment row that carries its commission. */
const DELIVERY_MODE_METHOD: Record<string, RegExp> = {
  Grab: /^grab$/i,
  Lineman: /^line\s*man$/i,
};

/**
 * Sale mode → platform commission rate, read from Sheet2 of the SAME file.
 *
 * Grab and LineMan genuinely differ (August 2569: 30.00% and 26.75%) and the
 * rate is read per import so a renegotiation needs no code change — see
 * PosPaymentLine.platformFee.
 *
 * `missing` lists any sale mode in the lines that could not be given a rate:
 * a delivery mode whose payment row is absent, or a mode this function has
 * never heard of. The caller MUST refuse on a non-empty list. Defaulting to 0
 * would put a figure labelled "net of GP" on screen that is not.
 */
export function platformRates(report: PosMonthlyExport): { rates: Map<string, number>; missing: string[] } {
  const rates = new Map<string, number>();
  const missing: string[] = [];
  for (const mode of new Set(report.lines.map((l) => l.saleMode))) {
    if (NO_COMMISSION_MODES.has(mode)) {
      rates.set(mode, 0);
      continue;
    }
    const pattern = DELIVERY_MODE_METHOD[mode];
    const payment = pattern ? report.payments.find((p) => pattern.test(p.method.trim())) : undefined;
    if (!payment || payment.amount <= 0) {
      missing.push(mode);
      continue;
    }
    rates.set(mode, payment.platformFee / payment.amount);
  }
  return { rates, missing };
}

/**
 * Aggregate by product name across sale modes, because the classification is
 * a property of the item: ชานม is coffee whether it was sold in the shop, via
 * Grab, or via LineMan. parsePosMonthlyExport has already stripped the
 * (Grab)/(LM)/(ห่อ) prefixes, so the three collapse to one row here.
 *
 * GP is applied to (gross − line discount) — what the platform actually
 * settles on — and a carve-out on a delivery line bears that channel's rate
 * like any other unit sold there.
 *
 * Caller must have checked platformRates().missing first; a mode with no rate
 * is a programming error here, not a data condition, so it throws.
 */
export function aggregateForClassification(
  report: PosMonthlyExport,
  rates: Map<string, number>,
): ClassificationItem[] {
  const agg = new Map<string, ClassificationItem & { whereSet: Set<string> }>();
  for (const line of report.lines) {
    if (!line.productName) continue;
    const rate = rates.get(line.saleMode);
    if (rate === undefined) throw new Error(`no platform rate for sale mode "${line.saleMode}"`);
    const keep = 1 - rate;

    const e = agg.get(line.productName) ?? {
      productName: line.productName,
      where: "",
      qty: 0,
      gross: 0,
      netWhole: 0,
      carveWeight: 0,
      whereSet: new Set<string>(),
    };
    e.qty += line.qty;
    e.gross += line.gross;
    e.netWhole += (line.gross - line.discount) * keep;
    e.carveWeight += line.qty * keep;
    if (line.group) e.whereSet.add(line.category ? `${line.group} :: ${line.category}` : line.group);
    agg.set(line.productName, e);
  }

  // Largest first: the biggest items account for most of the coffee total, so
  // the tail can be skimmed once the running total reconciles.
  return Array.from(agg.values())
    .map(({ whereSet, ...item }) => ({ ...item, where: Array.from(whereSet).join(", ") }))
    .sort((a, b) => b.gross - a.gross);
}
