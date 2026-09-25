import "server-only";
import { requireSales } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSetLine, resolveDishes, type DishSource, type EventMenuDish } from "./menu-lines";

/**
 * THE READS of a booking's food lines: its lines (catering_event_menus), the
 * shared sets' rows, and what each set line serves (the booking's own copy,
 * or the shared set for a line from before the copy existed). Sales-safe:
 * names, per-table counts, sections and customer prices only.
 *
 * Moved out of actions.ts on 2026-09-24, verbatim, for the menu card: the
 * card must not import anything that computes cost, and actions.ts holds the
 * admin-only operating-cost functions and imports event-menu.ts's cost
 * figures. actions.ts keeps getCateringEventMenus, getCateringSetMenuItemsForSets
 * and getEventMenuDishes as one-line wrappers of these, so the kitchen sheet,
 * the function sheet, the quotation and the card run ONE body and cannot
 * disagree. Never imports getCostingContext or computeMenuCost.
 */

/**
 * A line in catering_event_menus — "what did we actually order for this
 * event", separate from catering_event_charges ("what's on the quotation").
 * Sale-price fields only; never joins ingredients/menu_recipe_items.
 */
export type CateringEventMenu = {
  id: string;
  set_menu_id: string | null;
  menu_id: string | null;
  /** "set": a shared set, or a custom set that names neither a set nor a dish; "dish": a single dish (event-menu.ts isSetLine). */
  kind: "set" | "dish";
  /**
   * The set's name as THIS booking knows it — stamped when its dishes were
   * copied (catering_copy_set_menu) or typed for a custom set; null on a set
   * line from before the copy existed and on a dish line. Its presence is
   * what says "a copy was made", whatever the copy holds now. Read
   * tolerantly: until the migration runs the column is absent and every line
   * reads as not copied.
   */
  set_name: string | null;
  copied: boolean;
  /**
   * Priced PER GUEST (Nik, 2026-09-25): quantity is the number of guests and
   * the linked charge's unit price is per guest. Fixed when the line is made.
   */
  per_head: boolean;
  name: string;
  quantity: number;
  note: string | null;
  /** menus.selling_price for a DISH line — the kitchen sheet prints it as the
   *  portion size on รายการอาหารเพิ่มเติม rows. null for a set line, whose
   *  dishes carry their own prices through the set expansion. */
  selling_price: number | null;
};

export type CateringSetMenuItem = {
  id: string;
  /** null for a typed dish (dish_name). */
  menu_id: string | null;
  dish_name: string | null;
  linked_menu_id: string | null;
  /** The printed name: the typed name, or the menu's. */
  menu_name: string;
  quantity: number;
  note: string | null;
  /** dish | dessert | drink | free — which group this row prints under on the
   *  three documents. See catering_set_menu_sections_migration.sql. */
  section: string;
  /** menus.selling_price. On the KITCHEN sheet this is the PORTION SIZE the
   *  chef plates to, not a cost and not a total — see src/lib/kitchen-sheet.ts.
   *  menus already grants SELECT to sales (sales_read_menus), the same grant
   *  getCateringDishOptions relies on, so this exposes nothing new. */
  selling_price: number;
};


/**
 * The reads and calls that fail only because the schema is not there yet —
 * a table or function of a migration that has not run. Treated as "not
 * there", never as an unexplained error, so code can deploy before its SQL.
 */
export function isMissingSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code && ["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(error.code)) return true;
  return /schema cache|does not exist/i.test(error.message ?? "");
}

export function toEventMenuDish(it: CateringSetMenuItem, sort_order: number, setMenuId: string): EventMenuDish {
  return {
    id: it.id, menu_id: it.menu_id, dish_name: it.dish_name, linked_menu_id: it.linked_menu_id, menu_name: it.menu_name, selling_price: it.selling_price, quantity: it.quantity,
    section: it.section, sort_order, note: it.note, source_set_menu_id: setMenuId, source_event_menu_id: null,
  };
}

export async function readEventMenus(eventId: string): Promise<CateringEventMenu[]> {
  await requireSales();
  const supabase = await createClient();
  // catering_event_charges(label): a CUSTOM set (catering per-event menus)
  // names neither a shared set nor a dish, so its name is the label of the
  // charge created with it. The newest columns go first and fall away ONE AT
  // A TIME when a migration has not run (per_head, then set_name), so a
  // missing per_head never costs the copy marker (review, 2026-09-25).
  const base = "id, set_menu_id, menu_id, quantity, note";
  const embeds = "catering_set_menus(name), menus(name, selling_price), catering_event_charges(label)";
  let rows: Record<string, unknown>[] = [];
  for (const cols of [`${base}, set_name, per_head, ${embeds}`, `${base}, set_name, ${embeds}`, `${base}, ${embeds}`]) {
    const { data, error } = await supabase.from("catering_event_menus").select(cols as string).eq("event_id", eventId).order("sort_order");
    if (error && isMissingSchemaError(error)) continue;
    if (error) throw error;
    rows = (data ?? []) as unknown as Record<string, unknown>[];
    break;
  }
  return rows.map((r: Record<string, unknown>) => {
    const setMenu = r.catering_set_menus as { name: string } | null;
    const dish = r.menus as { name: string; selling_price: number } | null;
    const linkedCharges = r.catering_event_charges as { label: string }[] | null;
    const line = { set_menu_id: r.set_menu_id as string | null, menu_id: r.menu_id as string | null };
    const set_name = (r.set_name as string | null | undefined) ?? null;
    return {
      id: r.id as string,
      set_menu_id: line.set_menu_id,
      menu_id: line.menu_id,
      kind: isSetLine(line) ? "set" as const : "dish" as const,
      set_name,
      copied: set_name != null,
      per_head: r.per_head === true,
      // The booking's own name for the set first — a shared set renamed later
      // must not rename a past booking's menu (review, 2026-09-19).
      name: set_name ?? setMenu?.name ?? dish?.name ?? linkedCharges?.[0]?.label ?? "ชุดเมนูของงาน",
      quantity: r.quantity as number,
      note: r.note as string | null,
      selling_price: dish?.selling_price ?? null,
    };
  });
}

/**
 * The same rows as getCateringSetMenuItems, for MANY sets at once and behind
 * requireSales() instead of requireAdmin() — the service function sheet is a
 * service-team document and a sales session must be able to print it.
 *
 * A separate function rather than relaxing the gate above, deliberately.
 * getCateringSetMenuItems is called by the set-menu editor and by the event
 * cost page, both of which are admin-only by design and say so at the top of
 * their files; widening its gate would widen theirs. Nothing here is
 * cost-bearing — this table holds no price and no recipe, only which dish sits
 * in which package — and RLS on catering_set_menu_items already admits
 * 'sales', so this grants no access the role did not have.
 *
 * One query for every set on the booking, keyed by set_menu_id, rather than
 * the per-set loop the cost page does.
 */
export async function readSetMenuItemsForSets(
  setMenuIds: string[],
): Promise<Map<string, CateringSetMenuItem[]>> {
  await requireSales();
  const out = new Map<string, CateringSetMenuItem[]>();
  if (setMenuIds.length === 0) return out;
  const supabase = await createClient();
  const read = (typed: boolean) => supabase
    .from("catering_set_menu_items")
    .select((typed ? "id, set_menu_id, menu_id, dish_name, linked_menu_id, quantity, note, section, menus(name, selling_price)"
                  : "id, set_menu_id, menu_id, quantity, note, section, menus(name, selling_price)") as string)
    .in("set_menu_id", setMenuIds)
    .order("sort_order");
  // Before the typed-dishes migration there is no dish_name: every row is a menu dish.
  let { data, error } = await read(true);
  if (error && isMissingSchemaError(error)) ({ data, error } = await read(false));
  if (error) throw error;
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const key = r.set_menu_id as string;
    const list = out.get(key) ?? [];
    const dishName = (r.dish_name as string | null) ?? null;
    list.push({
      id: r.id as string,
      menu_id: (r.menu_id as string | null) ?? null,
      dish_name: dishName,
      linked_menu_id: (r.linked_menu_id as string | null) ?? null,
      // A typed dish prints as typed, and has no selling price of its own.
      menu_name: dishName ?? (r.menus as { name: string; selling_price: number } | null)?.name ?? "-",
      selling_price: dishName != null ? 0 : (r.menus as { selling_price: number } | null)?.selling_price ?? 0,
      quantity: r.quantity as number,
      note: r.note as string | null,
      section: r.section as string,
    });
    out.set(key, list);
  }
  return out;
}

/**
 * What is served at each set line of a booking — the booking's own copy, or
 * the shared set for a line from before the copy existed. Sales-safe: names,
 * per-table counts, sections, customer prices and provenance ids only. Every
 * screen that expands a set (kitchen sheet, function sheet, quotation, cost
 * page, the lock, the menu page, the price box's dish names) reads THIS, so
 * they cannot disagree.
 */
export async function readEventMenuDishes(eventId: string): Promise<Map<string, { source: DishSource; dishes: EventMenuDish[] }>> {
  await requireSales();
  const supabase = await createClient();
  const lines = (await readEventMenus(eventId)).filter((l) => l.kind === "set");
  const out = new Map<string, { source: DishSource; dishes: EventMenuDish[] }>();
  if (lines.length === 0) return out;

  const copyByLine = new Map<string, EventMenuDish[]>();
  const readCopy = (typed: boolean) => supabase
    .from("catering_event_menu_items")
    .select((typed ? "id, event_menu_id, menu_id, dish_name, linked_menu_id, quantity, section, sort_order, note, source_set_menu_id, source_event_menu_id, menus(name, selling_price)"
                  : "id, event_menu_id, menu_id, quantity, section, sort_order, note, source_set_menu_id, source_event_menu_id, menus(name, selling_price)") as string)
    .eq("event_id", eventId)
    .order("sort_order")
    .order("id");
  // Before the typed-dishes migration there is no dish_name: read the copy
  // without it rather than lose the copy (review, 2026-09-25).
  let { data, error } = await readCopy(true);
  if (error && isMissingSchemaError(error)) ({ data, error } = await readCopy(false));
  if (error && !isMissingSchemaError(error)) throw error;
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const menu = r.menus as { name: string; selling_price: number } | null;
    const key = r.event_menu_id as string;
    const list = copyByLine.get(key) ?? [];
    const dishName = (r.dish_name as string | null) ?? null;
    list.push({
      id: r.id as string,
      menu_id: (r.menu_id as string | null) ?? null,
      dish_name: dishName,
      linked_menu_id: (r.linked_menu_id as string | null) ?? null,
      menu_name: dishName ?? menu?.name ?? "-",
      selling_price: dishName != null ? 0 : Number(menu?.selling_price ?? 0),
      quantity: Number(r.quantity),
      section: r.section as string,
      sort_order: Number(r.sort_order),
      note: r.note as string | null,
      source_set_menu_id: (r.source_set_menu_id as string | null) ?? null,
      source_event_menu_id: (r.source_event_menu_id as string | null) ?? null,
    });
    copyByLine.set(key, list);
  }

  // The shared set, for lines NEVER copied: bookings from before the feature.
  // A line whose copy was made and then emptied is a copy with no rows, not a
  // fall-back (resolveDishes) — so the shared set is fetched only for lines
  // without the marker and without rows.
  const needShared = lines.filter((l) => l.set_menu_id && !l.copied && !(copyByLine.get(l.id)?.length));
  const sharedBySet = await readSetMenuItemsForSets([...new Set(needShared.map((l) => l.set_menu_id as string))]);
  for (const l of lines) {
    const shared = l.set_menu_id && !l.copied
      ? sharedBySet.get(l.set_menu_id)?.map((it, i) => toEventMenuDish(it, (i + 1) * 10, l.set_menu_id as string))
      : undefined;
    out.set(l.id, resolveDishes(copyByLine.get(l.id), shared, l.copied));
  }
  return out;
}

