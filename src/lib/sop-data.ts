import "server-only";
import { createClient } from "@/lib/supabase/server";

// ── Types ────────────────────────────────────────────────────────

export type SopListItem = {
  menuId: string;
  menuName: string;
  menuCategory: string | null;
  sopId: string | null;
  updatedAt: string | null;
  authorName: string | null;
  // null = no SOP yet; number = step count for that section
  prepCount: number | null;
  cookCount: number | null;
  platingCount: number | null;
  checklistCount: number | null;
  hasVideo: boolean | null;
};

export type MenuIngredientForSop = {
  ingredientId: string;
  name: string;
  quantity: number;
  unit: string | null;
  note: string; // from menu_sop_ingredient_notes, empty if no SOP yet
};

export type SopStepRecord = {
  id: string;
  section: "prep" | "cook" | "plating" | "checklist";
  sortOrder: number;
  text: string;
  photoUrl: string | null;
};

export type SopFullData = {
  sopId: string;
  menuId: string;
  menuName: string;
  menuCategory: string | null;
  authorName: string | null;
  updatedAt: string;
  demoVideoUrl: string | null;
  ingredients: MenuIngredientForSop[];
  prepSteps: SopStepRecord[];
  cookSteps: SopStepRecord[];
  platingSteps: SopStepRecord[];
  checklist: SopStepRecord[];
};

export type MenuOption = {
  id: string;
  name: string;
  category: string | null;
};

// ── Fetchers ─────────────────────────────────────────────────────

/** All menus + their SOP status — used for the index/list page. */
export async function getSopList(): Promise<SopListItem[]> {
  const supabase = await createClient();

  const [{ data: menus }, { data: sops }, { data: steps }] = await Promise.all([
    supabase.from("menus").select("id, name, category").order("name"),
    supabase.from("menu_sops").select("id, menu_id, updated_at, author_name, demo_video_url"),
    supabase.from("menu_sop_steps").select("sop_id, section"),
  ]);

  // Count steps per section per SOP
  const stepCounts = new Map<string, Record<string, number>>();
  for (const s of steps ?? []) {
    if (!stepCounts.has(s.sop_id)) stepCounts.set(s.sop_id, { prep: 0, cook: 0, plating: 0, checklist: 0 });
    const c = stepCounts.get(s.sop_id)!;
    c[s.section] = (c[s.section] ?? 0) + 1;
  }

  const sopByMenuId = new Map<string, { id: string; updated_at: string; author_name: string | null; demo_video_url: string | null }>();
  for (const s of sops ?? []) sopByMenuId.set(s.menu_id, s);

  return (menus ?? []).map((m) => {
    const sop = sopByMenuId.get(m.id) ?? null;
    const counts = sop ? (stepCounts.get(sop.id) ?? { prep: 0, cook: 0, plating: 0, checklist: 0 }) : null;
    return {
      menuId: m.id,
      menuName: m.name,
      menuCategory: m.category,
      sopId: sop?.id ?? null,
      updatedAt: sop?.updated_at ?? null,
      authorName: sop?.author_name ?? null,
      prepCount: counts?.prep ?? null,
      cookCount: counts?.cook ?? null,
      platingCount: counts?.plating ?? null,
      checklistCount: counts?.checklist ?? null,
      hasVideo: sop ? !!(sop.demo_video_url?.trim()) : null,
    };
  });
}

/** All menus for the menu-picker combobox on the /sop/new page. */
export async function getAllMenuOptions(): Promise<MenuOption[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("menus").select("id, name, category").order("name");
  return data ?? [];
}

/** Get a single menu's name/category. Returns null if not found. */
export async function getMenuOption(menuId: string): Promise<MenuOption | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("menus")
    .select("id, name, category")
    .eq("id", menuId)
    .single();
  return data ?? null;
}

/** Recipe ingredients for a menu, including any SOP notes if a SOP exists. */
export async function getMenuIngredientsForSop(
  menuId: string,
  sopId?: string
): Promise<MenuIngredientForSop[]> {
  const supabase = await createClient();

  const [{ data: items }, { data: notes }] = await Promise.all([
    supabase
      .from("menu_recipe_items")
      .select("quantity, ingredients(id, name, usage_unit)")
      .eq("menu_id", menuId),
    sopId
      ? supabase
          .from("menu_sop_ingredient_notes")
          .select("ingredient_id, note")
          .eq("sop_id", sopId)
      : Promise.resolve({ data: [] }),
  ]);

  const noteMap = new Map<string, string>();
  for (const n of notes ?? []) noteMap.set(n.ingredient_id, n.note);

  return (items ?? [])
    .filter((it) => it.ingredients)
    .map((it) => {
      const ing = it.ingredients as unknown as { id: string; name: string; usage_unit: string | null };
      return {
        ingredientId: ing.id,
        name: ing.name,
        quantity: it.quantity,
        unit: ing.usage_unit,
        note: noteMap.get(ing.id) ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "th"));
}

/** Full SOP data for a given menu. Returns null if no SOP exists yet. */
export async function getSopByMenuId(menuId: string): Promise<SopFullData | null> {
  const supabase = await createClient();

  const { data: sop } = await supabase
    .from("menu_sops")
    .select("id, menu_id, author_name, updated_at, demo_video_url, menus(id, name, category)")
    .eq("menu_id", menuId)
    .single();

  if (!sop) return null;

  const menu = sop.menus as unknown as { id: string; name: string; category: string | null } | null;

  const [ingredients, { data: steps }] = await Promise.all([
    getMenuIngredientsForSop(menuId, sop.id),
    supabase
      .from("menu_sop_steps")
      .select("id, section, sort_order, text, photo_url")
      .eq("sop_id", sop.id)
      .order("sort_order"),
  ]);

  function mapSteps(section: string): SopStepRecord[] {
    return (steps ?? [])
      .filter((s) => s.section === section)
      .map((s) => ({
        id: s.id,
        section: s.section as SopStepRecord["section"],
        sortOrder: s.sort_order,
        text: s.text,
        photoUrl: s.photo_url ?? null,
      }));
  }

  return {
    sopId: sop.id,
    menuId: sop.menu_id,
    menuName: menu?.name ?? "",
    menuCategory: menu?.category ?? null,
    authorName: sop.author_name,
    updatedAt: sop.updated_at,
    demoVideoUrl: sop.demo_video_url,
    ingredients,
    prepSteps: mapSteps("prep"),
    cookSteps: mapSteps("cook"),
    platingSteps: mapSteps("plating"),
    checklist: mapSteps("checklist"),
  };
}
