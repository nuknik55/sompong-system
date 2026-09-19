/**
 * A booking's OWN menu — catering per-event menus, round 1 (Nik, 2026-09-19).
 *
 * THE MODEL. A shared set menu (catering_set_menus + _items) is reference
 * data, edited by owner and admin. Picking one for a booking COPIES its
 * dishes into catering_event_menu_items, keyed by the booking's set line
 * (catering_event_menus.id). From then on the copy is the record: editing it
 * never touches the shared set, and the shared set changing later never
 * changes what a past booking shows. A booking may also start a custom set
 * (a set line with a name and no shared source) and add dishes from scratch.
 *
 * BOOKINGS FROM BEFORE THIS FEATURE have set lines with no copy. They fall
 * back to the shared set, exactly as every screen read them until now
 * (`source: "shared"`), and the menu page offers to make the copy. Nothing is
 * materialised behind anyone's back.
 *
 * Pure — no import of a value — so every figure here is a test, and the page
 * that renders them can be given exactly what it will send to the browser
 * (buildEventMenuView), which is how "sales never receives a cost" is tested
 * rather than asserted.
 */
import type { EventMenuAccess } from "@/lib/event-menu-access";

/** One course of a booking's set: a copied row, or a shared row when falling back. */
export type EventMenuDish = {
  id: string;
  menu_id: string;
  menu_name: string;
  /** menus.selling_price — a customer price, sales-readable. */
  selling_price: number;
  /** Per table (per set), as catering_set_menu_items.quantity is. */
  quantity: number;
  section: string;
  sort_order: number;
  note: string | null;
};

export type DishSource = "copy" | "shared" | "none";

/** A set line of the booking, with what is served at it. */
export type EventMenuLine = {
  /** catering_event_menus.id */
  id: string;
  name: string;
  /** catering_event_menus.quantity — tables. */
  tables: number;
  /** The linked charge's unit_price. null when the line has no charge (should not happen; shown as "—"). */
  pricePerTable: number | null;
  /** Provenance: the shared set it was copied from, or null for a custom set. */
  sourceSetMenuId: string | null;
  source: DishSource;
  dishes: EventMenuDish[];
};

/** Owner/admin only. Never built for any other access level — see buildEventMenuView. */
export type EventMenuCost = {
  costPerTable: number;
  pct: number | null;
  hasUnknownCost: boolean;
};

export type EventMenuView = {
  lines: EventMenuLine[];
  canEdit: boolean;
  locked: boolean;
  /** null for every access level but "edit", whatever the caller passed. */
  costByLine: Record<string, EventMenuCost> | null;
};

/** A swap whose new dish differs in price by more than this from the old one is flagged. */
export const SWAP_WARN_RATIO = 0.1;

/**
 * A set line is one copied from a shared set (set_menu_id) or a custom set —
 * which, by the widened CHECK, is the line that names neither a set nor a
 * dish. Decided from the two columns every screen already reads, so no
 * screen needs the new set_name column to exist yet.
 */
export function isSetLine(line: { set_menu_id: string | null; menu_id: string | null }): boolean {
  return line.set_menu_id != null || line.menu_id == null;
}

/**
 * The page's lines: every set line of the booking with its price per table
 * (the linked charge's unit_price) and what is served at it. Dish lines are
 * not part of any set and are left out — they print under รายการเพิ่มเติม on
 * the sheets, as before.
 */
export function buildEventMenuLines(
  eventMenus: { id: string; set_menu_id: string | null; menu_id: string | null; name: string; quantity: number }[],
  charges: { event_menu_id: string | null; unit_price: number }[],
  dishesByLine: Map<string, { source: DishSource; dishes: EventMenuDish[] }>,
): EventMenuLine[] {
  const priceByLine = new Map<string, number>();
  for (const c of charges) if (c.event_menu_id && !priceByLine.has(c.event_menu_id)) priceByLine.set(c.event_menu_id, c.unit_price);
  return eventMenus.filter(isSetLine).map((m) => {
    const resolved = dishesByLine.get(m.id) ?? { source: "none" as DishSource, dishes: [] };
    return {
      id: m.id,
      name: m.name,
      tables: m.quantity,
      pricePerTable: priceByLine.get(m.id) ?? null,
      sourceSetMenuId: m.set_menu_id,
      source: resolved.source,
      dishes: resolved.dishes,
    };
  });
}

/** Σ selling price × per-table quantity: what the dishes would cost the customer bought singly. */
export function dishesTotalPerTable(dishes: EventMenuDish[]): number {
  return dishes.reduce((s, d) => s + d.selling_price * d.quantity, 0);
}

/**
 * The set's discount against its dishes' own prices. VISIBLE TO SALES: both
 * inputs are customer prices. 4,800 of dishes sold as a 4,500 set = 6.25% off.
 * Negative when the set sells for MORE than its dishes — shown, not hidden,
 * because that is a pricing fact the person quoting should see.
 */
export function discountFigure(
  dishesTotal: number,
  pricePerTable: number | null,
): { dishesTotal: number; pricePerTable: number; amount: number; pct: number } | null {
  if (pricePerTable == null || !Number.isFinite(pricePerTable) || !(dishesTotal > 0)) return null;
  const amount = dishesTotal - pricePerTable;
  return { dishesTotal, pricePerTable, amount, pct: (amount / dishesTotal) * 100 };
}

export function discountText(fig: ReturnType<typeof discountFigure>): string {
  if (!fig) return "ยังคำนวณส่วนลดไม่ได้ — ต้องมีเมนูและราคาต่อโต๊ะ";
  const pct = Math.abs(fig.pct).toFixed(2);
  if (Math.abs(fig.amount) < 0.005) return `ราคาชุดเท่ากับราคาเมนูแยกพอดี (${fig.dishesTotal.toLocaleString("th-TH")} บาท)`;
  return fig.amount > 0
    ? `ราคาเมนูแยกรวม ${fig.dishesTotal.toLocaleString("th-TH")} บาท ขายเป็นชุด ${fig.pricePerTable.toLocaleString("th-TH")} บาท — ลด ${pct}%`
    : `ราคาเมนูแยกรวม ${fig.dishesTotal.toLocaleString("th-TH")} บาท แต่ขายเป็นชุด ${fig.pricePerTable.toLocaleString("th-TH")} บาท — แพงกว่าราคาแยก ${pct}%`;
}

/** OWNER AND ADMIN ONLY — the caller decides whether to compute the cost at all. 2,000 against 4,500 = 44.44%. */
export function foodCostFigure(costPerTable: number, pricePerTable: number | null): { cost: number; pct: number | null } {
  const pct = pricePerTable != null && pricePerTable > 0 ? (costPerTable / pricePerTable) * 100 : null;
  return { cost: costPerTable, pct };
}

/**
 * Swapping a course for one whose price differs by more than 10% from the
 * one it replaces is flagged. A WARNING: the swap goes ahead if the person
 * confirms. Exactly 10% is not "more than".
 */
export function swapPriceWarning(oldPrice: number, newPrice: number): { warn: boolean; diffPct: number | null } {
  if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice) || oldPrice <= 0) return { warn: false, diffPct: null };
  const diffPct = ((newPrice - oldPrice) / oldPrice) * 100;
  return { warn: Math.abs(newPrice - oldPrice) / oldPrice > SWAP_WARN_RATIO + 1e-12, diffPct };
}

export function swapWarningText(oldName: string, oldPrice: number, newName: string, newPrice: number): string {
  const { diffPct } = swapPriceWarning(oldPrice, newPrice);
  const dir = newPrice > oldPrice ? "แพงกว่า" : "ถูกกว่า";
  return (
    `${newName} (${newPrice.toLocaleString("th-TH")} บาท) ${dir} ${oldName} (${oldPrice.toLocaleString("th-TH")} บาท) ` +
    `อยู่ ${Math.abs(diffPct ?? 0).toFixed(1)}% — เกิน 10% ตรวจสอบราคาชุดก่อนยืนยัน`
  );
}

/**
 * What is served at a set line.
 *
 * `copied` is whether a copy was ever MADE for the line — the line's own
 * marker (set_name, stamped by catering_copy_set_menu), not its row count.
 * The 2026-09-19 review found the row count could not tell "never copied"
 * from "copied, then every course removed": the emptied copy silently fell
 * back to the shared set on every screen, showed a false legacy banner, and
 * could not be added to. A copied line with no rows is a copy with no rows.
 * Only a line never copied reads the shared set (a booking from before the
 * feature); a line with neither is empty.
 */
export function resolveDishes(
  copy: EventMenuDish[] | undefined,
  shared: EventMenuDish[] | undefined,
  copied: boolean,
): { source: DishSource; dishes: EventMenuDish[] } {
  if (copied || (copy && copy.length > 0)) return { source: "copy", dishes: copy ?? [] };
  if (shared && shared.length > 0) return { source: "shared", dishes: shared };
  return { source: "none", dishes: [] };
}

/**
 * What the page sends to the browser. THE COST IS DROPPED unless the access
 * is "edit" — so even a page that computed one by mistake could not ship it
 * to a sales session. The page does not compute one for sales either; this
 * is the second lock, and it is the one a test can hold.
 */
export function buildEventMenuView(input: {
  access: EventMenuAccess;
  locked: boolean;
  lines: EventMenuLine[];
  costByLine: Record<string, EventMenuCost> | null;
}): EventMenuView {
  const edit = input.access === "edit";
  return {
    lines: input.lines,
    canEdit: edit && !input.locked,
    locked: input.locked,
    costByLine: edit ? input.costByLine : null,
  };
}
