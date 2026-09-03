// How a POS delivery history becomes ONE price for an ingredient.
//
// No "server-only": pure functions over plain data, unit-tested in
// pos-pricing.test.ts. The server action calls this; nothing here does I/O.
//
// REPLACES "latest delivery wins". That rule took whichever delivery happened
// to be newest and used its unit cost, so one atypical purchase — or one
// mis-keyed row — became the standing cost until the next import. Modelling
// this rule against 22,711 real deliveries moved 25 of 242 ingredients by more
// than 20%, and in the cases we could check against supplier invoices the new
// number was the right one and the stored number was the error.

/** One delivery, as read back out of pos_receipt_deliveries. */
export type PricingDelivery = {
  documentDate: string; // "YYYY-MM-DD"
  /**
   * "month" means the day in documentDate is a PLACEHOLDER of 1 — the POS
   * report had no DocumentDate and only the month was recoverable. Defaults
   * to "day" when absent so existing callers are unaffected.
   */
  datePrecision?: "day" | "month";
  vendorName: string; // "" is a real vendor identity — never coalesce it
  unitName: string;
  qty: number;
  totalCostIncVat: number;
};

export type PricingRule = "dominant-vendor" | "all-vendor" | "latest-delivery";

export type PricingResult = {
  price: number;
  rule: PricingRule;
  /** Vendor whose deliveries were pooled, and its share of the window. */
  vendorName: string;
  vendorShare: number;
  /** The unit every pooled delivery is denominated in. */
  unitName: string;
  /** Deliveries left in the pool after outlier removal. */
  poolSize: number;
  /** Deliveries discarded by the gap filter. */
  outliersDropped: number;
  /** Top two vendors are within VENDOR_AMBIGUITY — dominance may flip. */
  vendorUnsettled: boolean;
  /** Dominant vendor is the POS catch-all group; the material is probably not food. */
  catchAllVendor: boolean;
};

/** POS materials that are accounting buckets or non-food, never ingredients. */
export const NON_FOOD_MATERIALS: ReadonlySet<string> = new Set([
  "ค่าขนส่งวัตถุดิบ", // freight
  "วัตถุดิบทดลอง", // R&D bucket
  "วัตถุดิบอื่นๆ", // catch-all
  "ของไหว้อื่นๆ", // offerings
  "ของสดอื่นๆ",
  "ผักอื่นๆ",
  "ของหวานอื่นๆ",
  "อาหารพนักงานอื่นๆ", // staff meals
  "เครื่องดื่มอื่นๆ",
  "น้ำทะเล", // sea water, billed per truckload
]);

/** Vendor the POS uses for uncategorised bookings; a price under it is a period total. */
export const CATCH_ALL_VENDOR = "กลุ่มอื่นๆ";

/** Top two vendors within this fraction -> dominance is unsettled. */
export const VENDOR_AMBIGUITY = 0.1;
/** Adjacent unit costs differing by this factor or more belong to different clusters. */
export const GAP_FACTOR = 2;
/** Below this, a "median" is not one. */
export const MIN_POOL = 3;
/** A cur/proposed ratio this close to a whole number is a pack count, not a price move. */
export const PACK_RATIO_TOLERANCE = 0.05;

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}


/**
 * Decides whether a month-precision delivery may join the pricing window.
 *
 * ONLY when its entire month lies inside the window. Not because that is
 * conservative, but because it makes the fabricated day structurally
 * incapable of deciding anything: a row whose whole month is inside is
 * inside under ANY day, so the placeholder cannot change membership.
 *
 * A future reader will see rows excluded at the window edge and be tempted
 * to 'fix' it by choosing a day — the 1st, the 15th, the last. Do not. Any
 * chosen day is still a guess; this rule means the guess never matters.
 * Measured: picking the 15th admits 22 more rows and moves one extra price
 * by 1.4%, in exchange for a fabricated value that decides an answer.
 *
 * Day-precision rows are always admitted on their own date.
 */
export function admittedToWindow(
  delivery: PricingDelivery,
  windowStart: string,
  today: string,
): boolean {
  if ((delivery.datePrecision ?? "day") === "day") return delivery.documentDate >= windowStart;
  const [y, m] = delivery.documentDate.split("-").map(Number);
  if (!y || !m) return false;
  const firstOfMonth = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastOfMonth = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return firstOfMonth >= windowStart && lastOfMonth <= today;
}

const unitCost = (d: PricingDelivery) => d.totalCostIncVat / d.qty;

/**
 * Splits a pool at any >=GAP_FACTOR jump in unit cost and keeps the LARGEST
 * cluster.
 *
 * Not the cluster holding the newest delivery, which is what this did first.
 * That inverts when the newest delivery IS the outlier: ข้าวคั่ว has
 * 25/25/25/50 with the 50 most recent, and newest-wins threw away the stable
 * majority to price the ingredient from one observation (+100%). Largest-wins
 * gets that right and leaves หอยแมลงภู่ — 9 deliveries at ~269 against 2 at
 * 2750 — unchanged.
 *
 * It is also the property a median rule should have: a real step change moves
 * the price once it is the norm, not the first time it is seen.
 */
export function dropOutliers(pool: PricingDelivery[]): { kept: PricingDelivery[]; dropped: number } {
  if (pool.length < 2) return { kept: pool, dropped: 0 };
  const sorted = [...pool].sort((a, b) => unitCost(a) - unitCost(b));
  const clusters: PricingDelivery[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = unitCost(sorted[i - 1]!);
    const cur = unitCost(sorted[i]!);
    if (prev > 0 && cur / prev >= GAP_FACTOR) clusters.push([sorted[i]!]);
    else clusters[clusters.length - 1]!.push(sorted[i]!);
  }
  if (clusters.length === 1) return { kept: pool, dropped: 0 };

  const bySize = [...clusters].sort((a, b) => b.length - a.length);
  let keep = bySize[0]!;
  // Genuine tie on size: prefer the cluster containing the most recent delivery.
  if (bySize[1] && bySize[1].length === keep.length) {
    const newest = pool.reduce((m, d) => (newerForTiebreak(d, m) < 0 ? d : m), pool[0]!);
    keep = clusters.find((c) => c.includes(newest)) ?? keep;
  }
  return { kept: keep, dropped: pool.length - keep.length };
}


/**
 * Orders two deliveries by recency for TIEBREAK purposes only.
 *
 * At an equal date, a day-precision row beats a month-precision one. The
 * month row's day is a placeholder, so letting it win a recency tiebreak
 * would be deciding on a value we invented.
 */
function newerForTiebreak(a: PricingDelivery, b: PricingDelivery): number {
  if (a.documentDate !== b.documentDate) return a.documentDate > b.documentDate ? -1 : 1;
  const ap = (a.datePrecision ?? "day") === "day" ? 0 : 1;
  const bp = (b.datePrecision ?? "day") === "day" ? 0 : 1;
  return ap - bp;
}

function dominantBy<T>(items: T[], key: (t: T) => string): { value: string; count: number; runnerUp: number } {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(key(it), (counts.get(key(it)) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { value: ranked[0]![0], count: ranked[0]![1], runnerUp: ranked[1]?.[1] ?? 0 };
}

/**
 * Picks the vendor we actually buy this material from — by QUANTITY, within a
 * unit that has already been chosen.
 *
 * Counting deliveries treats a 3 kg top-up as equal evidence to a 57 kg bulk
 * drop. For กะทิ that picked กะทิ ทรัพย์บุญชัย, who supplied 7% of the coconut
 * milk across 45% of the deliveries, over ป้อม กะทิ at 87% of the volume in 14%
 * of the deliveries. The restaurant's answer is ป้อม; the rule said otherwise.
 *
 * Quantity, NOT spend. Weighting by baht looks equivalent and is not:
 *
 *   - Spend is price x quantity, so at similar volume the DEARER vendor always
 *     wins. มะม่วงดิบ splits 49/51 by volume, and spend hands it to the vendor
 *     charging 50% more, moving the price +30% on what is really a coin-flip.
 *   - Worse, spend weighting amplifies exactly the rows the gap filter exists
 *     to suppress. A mis-key is almost always UPWARD, so a wrong row carries
 *     more weight than the correct ones. น้ำจิ้มไก่ has three deliveries at
 *     ~฿61 and one mis-keyed at ฿601, and that single row outweighs all three
 *     combined: a spend-weighted median returns ฿601.
 *
 * Do not "improve" this to spend. It has been measured and it is worse.
 *
 * Quantity is only summable once the unit is fixed — 5 กล่อง + 3 โล is not 8 of
 * anything, and 14 of 244 materials carry more than one unit in the window.
 * That is why the caller chooses the unit first and passes same-unit rows here.
 *
 * Ties are broken on the most recent delivery: without it, materials with an
 * exact tie would flip between imports for no visible reason.
 */
function dominantVendorByVolume(sameUnit: PricingDelivery[]) {
  const totals = new Map<string, { qty: number; newest: PricingDelivery | null }>();
  for (const d of sameUnit) {
    const e = totals.get(d.vendorName) ?? { qty: 0, newest: null };
    e.qty += d.qty;
    // Placeholder dates must not win this tiebreak — see newerForTiebreak.
    if (!e.newest || newerForTiebreak(d, e.newest) < 0) e.newest = d;
    totals.set(d.vendorName, e);
  }
  const ranked = [...totals.entries()].sort((a, b) =>
    b[1].qty !== a[1].qty ? b[1].qty - a[1].qty : newerForTiebreak(a[1].newest!, b[1].newest!),
  );
  const totalQty = sameUnit.reduce((t, d) => t + d.qty, 0);
  return {
    value: ranked[0]![0],
    qty: ranked[0]![1].qty,
    runnerUpQty: ranked[1]?.[1].qty ?? 0,
    share: totalQty > 0 ? ranked[0]![1].qty / totalQty : 0,
  };
}

/**
 * Prices one material from its deliveries inside the window.
 *
 * Escalating fallback, because a flat min-3 would freeze ~23% of the catalogue:
 *   1. the dominant unit, then the vendor supplying most VOLUME in it
 *   2. the dominant unit, all vendors
 *   3. latest delivery — today's rule, and the UI must not tick it by default
 *
 * The gap filter runs BEFORE each pool-size test. Running it after let a pool
 * of 4 pass the guard and then be cut to 1, so the "median" was one delivery.
 *
 * Returns null only when there is nothing usable (no deliveries, or qty <= 0
 * throughout).
 */
export function priceFromDeliveries(deliveries: PricingDelivery[]): PricingResult | null {
  const usable = deliveries.filter((d) => d.qty > 0 && Number.isFinite(d.totalCostIncVat));
  if (usable.length === 0) return null;

  // UNIT FIRST. Quantity is only comparable inside one unit, and choosing the
  // unit up front is what makes volume-based vendor selection well defined.
  const unit = dominantBy(usable, (d) => d.unitName).value;
  const sameUnit = usable.filter((d) => d.unitName === unit);

  const vendor = dominantVendorByVolume(sameUnit.length > 0 ? sameUnit : usable);
  const base = {
    vendorName: vendor.value,
    // Share of VOLUME in the chosen unit, not share of deliveries. The UI says
    // so explicitly; a percentage that quietly changed meaning would be worse
    // than no percentage.
    vendorShare: vendor.share,
    // Unsettled compares volume too. หมึกหอม is 24 deliveries each way — an
    // exact count tie, previously resolved by recency and flagged ambiguous —
    // but 80/20 by volume, which is not ambiguous at all. Comparing volume
    // makes the flag both quieter and more accurate.
    vendorUnsettled:
      vendor.runnerUpQty > 0 && (vendor.qty - vendor.runnerUpQty) / vendor.qty <= VENDOR_AMBIGUITY,
    catchAllVendor: vendor.value === CATCH_ALL_VENDOR,
  };

  const tryPool = (candidate: PricingDelivery[], rule: PricingRule): PricingResult | null => {
    if (candidate.length < MIN_POOL) return null;
    const { kept, dropped } = dropOutliers(candidate);
    if (kept.length < MIN_POOL) return null;
    return {
      ...base,
      price: median(kept.map(unitCost)),
      rule,
      unitName: kept[0]!.unitName,
      poolSize: kept.length,
      outliersDropped: dropped,
    };
  };

  // Step 1 — the volume-dominant vendor's deliveries, in the chosen unit.
  const step1 = tryPool(sameUnit.filter((d) => d.vendorName === vendor.value), "dominant-vendor");
  if (step1) return step1;

  // Step 2 — every vendor, same unit.
  const step2 = tryPool(sameUnit, "all-vendor");
  if (step2) return step2;

  const newestDate = usable.reduce((m, d) => (d.documentDate > m ? d.documentDate : m), "");
  // (Precision only breaks ties at an equal date, which the filter below keeps.)
  const latest = usable.filter((d) => d.documentDate === newestDate);
  const qty = latest.reduce((s, d) => s + d.qty, 0);
  const cost = latest.reduce((s, d) => s + d.totalCostIncVat, 0);
  if (qty <= 0) return null;
  return {
    ...base,
    price: cost / qty,
    rule: "latest-delivery",
    unitName: latest[0]!.unitName,
    poolSize: latest.length,
    outliersDropped: 0,
  };
}

/**
 * Detects a unit whose MEANING changed while its label did not.
 *
 * หอยแมลงภู่ was stored at ฿2,750 per "ลัง(แซนฟอร์ด)" with yield_qty 440 ตัว.
 * The supplier's confirmation shows ฿269/EA for a 1 kg box — and the POS calls
 * that "ลัง(แซนฟอร์ด)" too. The unit STRING is identical on both sides, so the
 * ordinary unit-change check cannot see it; the row looks like a -90% price
 * collapse. Writing ฿269 against yield 440 understates the cost 10.2x.
 *
 * The tell is the ratio. Tested against all 191 same-unit rows: a ratio within
 * 5% of a whole number >= 2 flags exactly TWO, versus six for a ">=50% move"
 * floor. Real price movements do not land on integers; pack counts do.
 *
 * Deliberately NOT gated behind a minimum move size — a 2x redefinition on a
 * cheap ingredient would slip under any such floor.
 */
export function detectUnitRedefinition(
  currentPrice: number | null,
  proposedPrice: number,
): { suspected: true; ratio: number; packCount: number } | { suspected: false } {
  if (currentPrice == null || currentPrice <= 0 || proposedPrice <= 0) return { suspected: false };
  const hi = Math.max(currentPrice, proposedPrice);
  const lo = Math.min(currentPrice, proposedPrice);
  const ratio = hi / lo;
  const nearest = Math.round(ratio);
  if (nearest < 2) return { suspected: false };
  if (Math.abs(ratio - nearest) / nearest > PACK_RATIO_TOLERANCE) return { suspected: false };
  return { suspected: true, ratio, packCount: nearest };
}
