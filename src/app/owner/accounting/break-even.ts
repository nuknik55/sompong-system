/**
 * Break-even arithmetic. Pure — the page feeds it the month's summary, the
 * chart of accounts, and the month's covers; nothing here reads a table.
 *
 * ── THE RESOLUTION RULE (coa.cost_behavior) ────────────────────────────────
 *
 *   an account uses its own cost_behavior;
 *   NULL inherits the group header;
 *   'excluded' is explicit and never inherited (998 ร้านกาแฟ: reimbursed
 *   money, neither fixed nor variable);
 *   a header that is NULL excludes its whole group (G950 Tax, G990 CapEx).
 *
 * ── WHAT THE FIGURE IS, AND IS NOT ────────────────────────────────────────
 *
 * contribution margin = 1 − variable ÷ revenue
 * break-even revenue  = fixed ÷ contribution margin
 * safety margin       = revenue − break-even revenue
 * break-even bills    = break-even revenue ÷ (revenue ÷ bills), when the
 *                       month has covers
 *
 * "Fixed" here is fixed BY HEADER for most groups: utilities, marketing,
 * maintenance and supply are classified whole, though each has a part that
 * moves with sales. Labour is the one group split per account. So the
 * margin is an approximation of a known shape — the true margin is somewhat
 * lower and the true break-even somewhat higher — and the page says so in
 * words beside the figure rather than presenting it as a fact.
 */

export type CostBehavior = "fixed" | "variable" | "excluded";

export type CoaBehaviorRow = { code: string; group_code: string | null; cost_behavior: CostBehavior | null };

export type BreakEvenInput = {
  revenue: number;
  /** Per-account totals for the month, every group including Tax and CapEx. */
  accounts: { code: string; total: number }[];
  coa: CoaBehaviorRow[];
  covers: { bills: number; customers: number } | null;
};

export type BreakEvenResult = {
  revenue: number;
  variable: number;
  fixed: number;
  /** Left out by rule: Tax, CapEx, and 'excluded' accounts. Shown, never summed in. */
  excluded: number;
  /** 0–1. null when revenue is 0. */
  contributionMargin: number | null;
  /** null when the margin is 0 or negative (fixed costs cannot be covered at any volume) or revenue is 0. */
  breakEvenRevenue: number | null;
  safetyMargin: number | null;
  /** Bills needed to break even, from revenue per bill. null without covers or without a break-even. */
  breakEvenBills: number | null;
  revenuePerBill: number | null;
  /** Groups whose accounts were classified by the header alone — the approximation the page names. */
  fixedByHeader: string[];
  /** Accounts the rule could not place: an account whose header is NULL is excluded by design and is NOT listed here. */
  unresolved: string[];
};

/** The behaviour an account actually gets, or null when it is left out. */
export function resolveBehavior(account: CoaBehaviorRow, headerOf: ReadonlyMap<string, CoaBehaviorRow>): CostBehavior | null {
  if (account.cost_behavior === "excluded") return "excluded";
  if (account.cost_behavior !== null) return account.cost_behavior;
  const header = account.group_code ? headerOf.get(account.group_code) : undefined;
  const h = header?.cost_behavior ?? null;
  // A header cannot be 'excluded' (enforced by CHECK); NULL on a header
  // means the group is out. Either way the account is out.
  return h === "fixed" || h === "variable" ? h : null;
}

export function breakEven(input: BreakEvenInput): BreakEvenResult {
  const headerOf = new Map(input.coa.filter((c) => c.group_code === null).map((c) => [c.code, c]));
  const byCode = new Map(input.coa.map((c) => [c.code, c]));

  let variable = 0, fixed = 0, excluded = 0;
  const unresolved: string[] = [];
  const headerOnlyGroups = new Set<string>();
  for (const a of input.accounts) {
    if (a.total === 0) continue;
    const row = byCode.get(a.code);
    if (!row) { unresolved.push(a.code); continue; }
    const b = resolveBehavior(row, headerOf);
    if (b === "variable") variable += a.total;
    else if (b === "fixed") fixed += a.total;
    else excluded += a.total;
    if (b !== null && b !== "excluded" && row.cost_behavior === null && row.group_code) headerOnlyGroups.add(row.group_code);
  }

  const revenue = input.revenue;
  const contributionMargin = revenue > 0 ? 1 - variable / revenue : null;
  const breakEvenRevenue = contributionMargin !== null && contributionMargin > 0 ? fixed / contributionMargin : null;
  const safetyMargin = breakEvenRevenue !== null ? revenue - breakEvenRevenue : null;
  const revenuePerBill = input.covers && input.covers.bills > 0 && revenue > 0 ? revenue / input.covers.bills : null;
  const breakEvenBills = breakEvenRevenue !== null && revenuePerBill !== null ? breakEvenRevenue / revenuePerBill : null;

  return {
    revenue,
    variable: round2(variable),
    fixed: round2(fixed),
    excluded: round2(excluded),
    contributionMargin,
    breakEvenRevenue: breakEvenRevenue !== null ? round2(breakEvenRevenue) : null,
    safetyMargin: safetyMargin !== null ? round2(safetyMargin) : null,
    breakEvenBills: breakEvenBills !== null ? Math.ceil(breakEvenBills) : null,
    revenuePerBill: revenuePerBill !== null ? round2(revenuePerBill) : null,
    fixedByHeader: [...headerOnlyGroups].filter((g) => headerOf.get(g)?.cost_behavior === "fixed").sort(),
    unresolved,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
