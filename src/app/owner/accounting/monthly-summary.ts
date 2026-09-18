/**
 * The month's expense side, grouped: what the P&L summary, the print page and
 * break-even all read. Pure, and extracted from getMonthlySummary on
 * 2026-09-18 so the rule below could be tested rather than asserted.
 *
 * THE RULE THAT CHANGED (Nik approved, 2026-09-18): a group's total, and the
 * operating total above it, count every account in the group — including one
 * that nets NEGATIVE for the month, which happens when a delivery is credited
 * back in full. Until then the totals were added up from the display list,
 * which dropped anything not strictly positive, so a credit reduced nothing
 * and the month read as more expensive than it was. Only the DISPLAY leaves
 * accounts out, and only those with nothing in them at all.
 */
import type { CoaAccount, MonthlySummaryGroup } from "./actions";

/**
 * Groups excluded from operating expenses.
 *
 * WHY. With CapEx inside operating expenses, any month containing a large
 * purchase reads as a bad trading month even though nothing about the business
 * changed — a fridge makes the month look worse than the month before it. That
 * destroys month-over-month comparability, which is the whole reason this
 * system exists: spotting margin drift and cost creep. A capital purchase is
 * not a trading result.
 *
 * Both figures stay on the page. This is not hiding them; it is stopping them
 * distorting the trend line.
 *
 * G990 was ALREADY meant to be non-operating: it is the only group in the COA
 * with target_pct = null, while all eleven others carry a percent-of-revenue
 * target. This restores an intent the data already encoded.
 *
 * G950 is different — it shipped with target_pct = 1, so moving it out is a
 * genuine change of intent rather than a restoration. Its target is cleared by
 * supabase/clear_tax_group_target.sql, because a target on a line that is no
 * longer measured against revenue is just a stale number waiting to mislead.
 *
 * NOTE ON NAMING: G950 holds VAT and withholding tax (ภพ.30, ภงด.1,3,53) —
 * transactional taxes, not income tax on profit. There is no income-tax line
 * anywhere in this system. So the headline figure is "operating profit"
 * (กำไรจากการดำเนินงาน) and must NOT be labelled ก่อนภาษี, which would be a new
 * wrong label replacing an old one.
 */
export const NON_OPERATING_GROUPS = ["G950", "G990"] as const;

export function isNonOperatingGroup(code: string): boolean {
  return (NON_OPERATING_GROUPS as readonly string[]).includes(code);
}

export type MonthlySummaryTotals = {
  /** Operating groups only. */
  groups: MonthlySummaryGroup[];
  /** CapEx and Tax. */
  nonOperating: MonthlySummaryGroup[];
  operatingExpense: number;
  capex: number;
  tax: number;
};

export function buildMonthlySummaryGroups(input: {
  /** The chart of accounts this caller may see (sensitive rows already filtered for a non-owner). */
  visibleCoa: CoaAccount[];
  /** The month's total per account code. */
  totals: Map<string, number>;
  totalRevenue: number;
}): MonthlySummaryTotals {
  const { visibleCoa, totals, totalRevenue } = input;
  const pct = (part: number) => (totalRevenue > 0 ? (part / totalRevenue) * 100 : null);

  const groupHeaders = visibleCoa.filter((c) => c.group_code === null && c.code.startsWith("G"));
  const buildGroup = (g: CoaAccount): MonthlySummaryGroup => {
    const all = visibleCoa
      .filter((c) => c.group_code === g.code)
      .map((c) => {
        const total = totals.get(c.code) ?? 0;
        return { code: c.code, name: c.name, total, pct_of_revenue: pct(total), is_sensitive: c.is_sensitive };
      });
    // Every account, then the display list: see THE RULE THAT CHANGED above.
    const groupTotal = all.reduce((s, a) => s + a.total, 0);
    return {
      group_code: g.code,
      group_name: g.name,
      target_pct: g.target_pct,
      total: groupTotal,
      pct_of_revenue: pct(groupTotal),
      accounts: all.filter((a) => a.total !== 0),
    };
  };

  const groups = groupHeaders.filter((g) => !isNonOperatingGroup(g.code)).map(buildGroup);
  const nonOperating = groupHeaders.filter((g) => isNonOperatingGroup(g.code)).map(buildGroup);

  return {
    groups,
    nonOperating,
    operatingExpense: groups.reduce((s, g) => s + g.total, 0),
    capex: nonOperating.find((g) => g.group_code === "G990")?.total ?? 0,
    tax: nonOperating.find((g) => g.group_code === "G950")?.total ?? 0,
  };
}
