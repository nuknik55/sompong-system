/**
 * The six revenue categories a POS product can belong to.
 *
 * Mirrors the CHECK on pos_item_categories.category exactly — change both or
 * neither. The order here is the display order of the selector.
 *
 * This is a plain module on purpose. A "use server" file may export only
 * async functions, so a const like this cannot live in actions.ts (that exact
 * mistake passed tsc and eslint and failed the build once). Both the server
 * action and the client component import it from here.
 */
export const CATEGORIES = ["food", "dessert", "drink", "coffee", "souvenir", "other"] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  food: "อาหาร",
  dessert: "ของหวาน",
  drink: "เครื่องดื่ม",
  coffee: "ร้านกาแฟ",
  souvenir: "ของฝาก",
  other: "อื่นๆ",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}
