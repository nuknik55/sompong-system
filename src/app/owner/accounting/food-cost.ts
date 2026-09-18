/**
 * The head chef's month: sales, the food he bought, and what that is as a
 * percentage of sales. Nik, 2026-09-18 — this page replaces the P&L for an
 * admin, who no longer sees the shop's profit (queue item 37).
 *
 * Pure, and deliberately the ONLY thing that shapes what the page shows: the
 * action hands it the month's rows and renders nothing else. That is what
 * keeps the rest of the P&L off this page. It takes a chart of accounts and
 * throws away everything that is not an open G100 account, so an entry from
 * another group cannot reach a figure here even if the query that fetched it
 * ever widened. The owner-only account (790) is in G700 and is dropped twice
 * over: by its group, and by is_sensitive.
 *
 * COGS here is what was BOOKED — the purchases the bookkeeper entered — not
 * the recipe cost of what was sold, which is the Menu Engineering figure on
 * /owner. The two answer different questions and will not agree.
 */
import type { MonthCompleteness } from "./summary/completeness";

/** The G100 group header: its code carries the target percentage. */
export const COGS_GROUP = "G100";

export type FoodCostCoaRow = {
  code: string;
  name: string;
  group_code: string | null;
  target_pct: number | null;
  is_sensitive: boolean;
};

export type FoodCostAccount = {
  code: string;
  name: string;
  total: number;
  pctOfRevenue: number | null;
};

export type FoodCostMonth = {
  yearMonth: string;
  /** Every revenue type of the month, added up. */
  revenue: number;
  /** The G100 accounts of the month, added up. */
  cogs: number;
  /** cogs as a percentage of revenue; null when there is no revenue to divide by. */
  pctOfRevenue: number | null;
  /** coa.target_pct on the G100 header — 38 today, and editable on the CoA screen. */
  targetPct: number | null;
  /** Actual minus target, in percentage POINTS. Positive is over target. */
  gapPoints: number | null;
  /** What that gap is worth on this month's sales, in baht. Positive is money over target. */
  gapBaht: number | null;
  /** The month's G100 accounts with an amount, biggest first. */
  accounts: FoodCostAccount[];
} & MonthCompleteness;

export function buildFoodCostMonth(input: {
  yearMonth: string;
  /** Any chart-of-accounts rows; everything outside an open G100 account is ignored. */
  coa: FoodCostCoaRow[];
  /** Any expense entries; only those in an open G100 account are counted. */
  entries: { coa_code: string; amount: number }[];
  /** monthly_revenue rows for the month. */
  revenueRows: { amount: number | null }[];
  completeness: MonthCompleteness;
}): FoodCostMonth {
  const { yearMonth, coa, entries, revenueRows, completeness } = input;

  // Number(): a numeric column can come back from PostgREST as a string,
  // and "800000" + "200000" would concatenate rather than add.
  const num = (v: number | null | undefined) => Number(v ?? 0) || 0;
  const revenue = revenueRows.reduce((s, r) => s + num(r.amount), 0);
  const pct = (part: number) => (revenue > 0 ? (part / revenue) * 100 : null);

  const cogsAccounts = coa.filter((c) => c.group_code === COGS_GROUP && !c.is_sensitive);
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (!cogsAccounts.some((c) => c.code === e.coa_code)) continue;
    totals.set(e.coa_code, (totals.get(e.coa_code) ?? 0) + num(e.amount));
  }

  const allTotals = cogsAccounts.map((c) => ({ code: c.code, name: c.name, total: totals.get(c.code) ?? 0 }));
  // The TOTAL counts every G100 account, a negative one included (a delivery
  // credited back). Adding up only the positive rows, as the P&L's group
  // totals still do, overstates food cost and can turn a month that was
  // under target into one over it. The table below leaves out only the
  // accounts with nothing in them at all.
  const cogs = allTotals.reduce((s, a) => s + a.total, 0);
  const accounts = allTotals
    .filter((a) => a.total !== 0)
    // Biggest first: a list of what to look at, not a ledger.
    .sort((a, b) => b.total - a.total)
    .map((a) => ({ ...a, pctOfRevenue: pct(a.total) }));
  const pctOfRevenue = pct(cogs);
  const targetPct = coa.find((c) => c.code === COGS_GROUP)?.target_pct ?? null;
  const gapPoints = pctOfRevenue != null && targetPct != null ? pctOfRevenue - targetPct : null;

  return {
    yearMonth,
    revenue,
    cogs,
    pctOfRevenue,
    targetPct,
    gapPoints,
    gapBaht: gapPoints != null ? (gapPoints / 100) * revenue : null,
    accounts,
    ...completeness,
  };
}
