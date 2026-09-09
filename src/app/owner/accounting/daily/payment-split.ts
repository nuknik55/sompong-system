/**
 * How an expense entry's payment method is treated on the daily screen.
 *
 * Extracted from DailyEntryClient so it can be tested. Both functions here
 * fix a defect of the same shape: code that asked "is it cash?" and treated
 * everything else as a transfer.
 *
 * ── WHY THAT SHAPE IS DANGEROUS HERE ──────────────────────────────────────
 *
 * payment_method is not a label on a past event. It decides what Nik pays:
 *
 *   cash      already settled
 *   transfer  NOT yet paid — a to-pay list he works through twice a week
 *   accrual   a real cost with nothing to pay: platform GP withheld by Grab
 *             and LineMan before the payout arrives, and POS discounts, where
 *             no money moves at all
 *
 * `accrual` became writable the moment the POS-import schema migration ran.
 * An else-branch that folds it into `transfer` turns roughly ฿162,000 a month
 * of money that was never owed into money Nik is told to send.
 *
 * A separate and load-bearing fact, because it is the opposite of what it
 * looks like: the weekly transfer slip does NOT filter on payment_method at
 * all. getWeeklyTransferData selects on `supplier_id IS NOT NULL`. Entries
 * written by the POS import stay off the pay-out list because they carry no
 * supplier, not because they are marked accrual. Nothing in this file changes
 * that; see the comment beside the hardcoded NULL in
 * supabase/pos_revenue_import_rpc.sql.
 */

export type PaymentMethod = "cash" | "transfer" | "accrual";

export type PaymentBuckets = { cash: number; transfer: number; accrual: number };

type SplittableEntry = { payment_method: string; amount: number };

/**
 * Sum entries into three named buckets, keyed by whatever `keyOf` returns.
 *
 * Every method gets its own branch and an unrecognised one is counted in
 * NONE of them. That is deliberate: silently absorbing an unknown value is
 * how this defect happened, and a bucket total that is quietly too high is
 * worse than one that is visibly too low. `total` is returned separately so a
 * caller can tell the two apart.
 */
export function splitByPaymentMethod<T extends SplittableEntry>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
): { groups: { label: string; buckets: PaymentBuckets; total: number }[]; totals: PaymentBuckets } {
  const map = new Map<string, PaymentBuckets & { total: number }>();
  const totals: PaymentBuckets = { cash: 0, transfer: 0, accrual: 0 };

  for (const e of entries) {
    const key = keyOf(e);
    const prev = map.get(key) ?? { cash: 0, transfer: 0, accrual: 0, total: 0 };
    if (e.payment_method === "cash") {
      prev.cash += e.amount;
      totals.cash += e.amount;
    } else if (e.payment_method === "transfer") {
      prev.transfer += e.amount;
      totals.transfer += e.amount;
    } else if (e.payment_method === "accrual") {
      prev.accrual += e.amount;
      totals.accrual += e.amount;
    }
    // An unrecognised method falls through to `total` only.
    prev.total += e.amount;
    map.set(key, prev);
  }

  return {
    groups: [...map.entries()].map(([label, b]) => ({
      label,
      buckets: { cash: b.cash, transfer: b.transfer, accrual: b.accrual },
      total: b.total,
    })),
    totals,
  };
}

/**
 * Whether the daily screen's edit dialog may edit this entry.
 *
 * The dialog offers exactly two amount boxes, เงินสด and โอน, and resolves the
 * method from which one was filled. It cannot express `accrual`, so saving an
 * accrual entry through it silently rewrites the method — and an entry that
 * was "nothing to pay" joins the to-pay list.
 *
 * It is worse than a wrong value, because the dialog also cannot SHOW the
 * amount: it loads the figure into the cash box only for a cash entry and the
 * transfer box only for a transfer entry, so an accrual entry opens with both
 * boxes empty. The user sees ฿102,876 in the table, opens it, and finds
 * blanks.
 *
 * Hand-editing these is not a meaningful operation anyway: they are written
 * and replaced wholesale by the POS import, so an edit survives only until
 * the next run. The screen says so instead of pretending otherwise.
 */
export function isDailyEditable(entry: { payment_method: string }): boolean {
  return entry.payment_method === "cash" || entry.payment_method === "transfer";
}

/**
 * The method an edited entry should carry, given the two amount boxes.
 *
 * `current` is the method the entry already had. It is a parameter rather
 * than an assumption because the old rule — `cash > 0 ? "cash" : "transfer"`
 * — had no way to leave a method alone, so every save asserted one of two
 * values whether or not the user had expressed a preference.
 *
 * Callers should refuse the edit entirely for a non-editable entry
 * (isDailyEditable); this function preserves `current` as a second line of
 * defence rather than as the primary one.
 */
export function resolveEditPaymentMethod(
  cash: number,
  transfer: number,
  current: string,
): PaymentMethod {
  if (cash > 0) return "cash";
  if (transfer > 0) return "transfer";
  if (current === "cash" || current === "transfer" || current === "accrual") return current;
  return "transfer";
}
