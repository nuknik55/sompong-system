// How the POS sales import turns a POS count into the app's units.
//
// One menu row in the import can be fed by several POS names: กุ้งก้ามกรามเผา
// takes "กุ้งก้ามกรามเผา" (counted in ขีด, ÷10), "…1 กก." (÷1) and "…5 ขีด"
// (÷2). Each name carries its OWN divisor, so every sum here divides each
// source by its own divisor and never divides a row's total. Dividing the
// total is what the หาร button used to do: pressed on a row that already
// held converted kilos, it divided them a second time, and it was offered
// again on every import, so pressing it twice silently cut a month's
// figures to a tenth (Nik, 2026-09-21).

export type SalesSource = {
  /** The POS product name, folded the way the importer folds it. */
  productName: string;
  qtySold: number;
  /** The divisor in effect: the saved one, or 1 for a name matched with none. */
  divisor: number;
  /**
   * True when a pos_sales_aliases row supplies the divisor. False only for a
   * POS name that matches the menu's own name and has no divisor saved: the
   * one case where the import may offer หาร.
   */
  saved: boolean;
};

/** A row's quantity in app units: each source over its own divisor, to the hundredth. */
export function sourcesQty(sources: SalesSource[]): number {
  return Math.round(sources.reduce((sum, s) => sum + s.qtySold / s.divisor, 0) * 100) / 100;
}

/**
 * The source หาร may divide, or null. Null means every source already has a
 * divisor in effect, and the row shows those divisors instead of a หาร box.
 */
export function divisibleSource(sources: SalesSource[]): SalesSource | null {
  return sources.find((s) => !s.saved) ?? null;
}

/**
 * A row's sources after this session's changes: a divisor just saved for its
 * unsaved source (หาร), and POS names just tied to it (ผูกเข้าเมนู).
 */
export function withSessionChanges(
  sources: SalesSource[],
  dividedBy: number | undefined,
  merged: SalesSource[] = [],
): SalesSource[] {
  const base = sources.map((s) => (!s.saved && dividedBy ? { ...s, divisor: dividedBy, saved: true } : s));
  return [...base, ...merged];
}

/**
 * A divisor a person typed, rounded to the four decimals pos_sales_aliases
 * stores (numeric(10,4)), or null unless that is 0.0001 – 1,000. Without the
 * rounding, 0.00001 passed here, divided this session's figures by it, and
 * was stored as 0 — so every later import silently used ÷1.
 */
export function validDivisor(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  const stored = Math.round(n * 10000) / 10000;
  return stored >= 0.0001 && stored <= 1000 ? stored : null;
}

/**
 * The menus whose figure would come out differently if the file were routed
 * NOW: the apply calls this with the file's POS rows and the divisors as
 * they are at that moment, and refuses if any comes back. A divisor edited
 * in another tab after the preview was read would otherwise be applied with
 * its old value.
 */
export function movedSinceRead(
  updates: { menuId: string; newQty: number }[],
  posRows: { productName: string; qtySold: number }[],
  aliasesNow: SalesAlias[],
  menusNow: SalesMenu[],
): string[] {
  const { byMenu } = routeSales(posRows.map((r) => ({ ...r, netRevenue: 0 })), aliasesNow, menusNow);
  return updates
    .filter((u) => Math.abs(sourcesQty(byMenu.get(u.menuId)?.sources ?? []) - u.newQty) > 0.005)
    .map((u) => u.menuId);
}

export type SalesPosRow = { productName: string; qtySold: number; netRevenue: number };
export type SalesAlias = { pos_product_name: string; menu_id: string; divisor: unknown };
export type SalesMenu = { id: string; name: string };

/**
 * THE IMPORT'S ROUTING RULE, in this order, for each POS name:
 *   1. a divisor saved for the name, whose menu still exists: that menu,
 *      counted over that divisor (saved: true);
 *   2. otherwise a menu whose name IS the POS name: that menu, as it stands
 *      (÷1, saved: false) — the only source หาร may divide;
 *   3. otherwise unmatched.
 * A stored divisor that is not a number above 0 counts as 1. Here rather
 * than inline in the server action so that a regression that read a saved
 * name as unsaved — bringing back a หาร that divides converted kilos — fails
 * a test.
 */
export function routeSales(rows: SalesPosRow[], aliases: SalesAlias[], menus: SalesMenu[]) {
  const menuIds = new Set(menus.map((m) => m.id));
  const menuByName = new Map(menus.map((m) => [m.name.trim(), m.id]));
  const aliasByName = new Map(aliases.map((a) => [a.pos_product_name.trim(), a]));
  const byMenu = new Map<string, { sources: SalesSource[]; netRevenue: number }>();
  const unmatched: { productName: string; qtySold: number }[] = [];
  for (const row of rows) {
    const name = row.productName.trim();
    const alias = aliasByName.get(name);
    let menuId: string | undefined;
    let source: SalesSource | undefined;
    if (alias && menuIds.has(alias.menu_id)) {
      const d = Number(alias.divisor);
      menuId = alias.menu_id;
      source = { productName: name, qtySold: row.qtySold, divisor: d > 0 ? d : 1, saved: true };
    } else if (menuByName.has(name)) {
      menuId = menuByName.get(name);
      source = { productName: name, qtySold: row.qtySold, divisor: 1, saved: false };
    }
    if (!menuId || !source) {
      unmatched.push({ productName: row.productName, qtySold: row.qtySold });
      continue;
    }
    const entry = byMenu.get(menuId) ?? { sources: [], netRevenue: 0 };
    entry.sources.push(source);
    entry.netRevenue += row.netRevenue;
    byMenu.set(menuId, entry);
  }
  return { byMenu, unmatched };
}
