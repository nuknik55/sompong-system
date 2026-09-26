import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isMissingColumn, isMissingRelation } from "@/lib/schema-fallback";
import { SOP_REQUEST_REFUSAL, sopVisibleTo, type SopVisibility } from "@/lib/sop-visibility";

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
  /** Open to chosen accounts only (a lock on the screen). Anyone reading it may see it: the database hides it from everyone else. */
  restricted: boolean;
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
  /** Open to chosen accounts only (a lock on the screen). */
  restricted: boolean;
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

type SopRow = { id: string; menu_id: string; updated_at: string; author_name: string | null; demo_video_url: string | null; visibility: string };

/**
 * The SOP rows this person may see (the database hides the rest), with their
 * visibility. Before sop_visibility_and_editor_cost_switch_migration.sql adds
 * the column, every SOP is open to everyone, as it was.
 */
async function readSops(supabase: Awaited<ReturnType<typeof createClient>>, menuId?: string): Promise<SopRow[]> {
  const cols = "id, menu_id, updated_at, author_name, demo_video_url";
  let q = supabase.from("menu_sops").select(`${cols}, visibility`);
  if (menuId) q = q.eq("menu_id", menuId);
  const r = await q;
  if (!r.error) return (r.data ?? []) as unknown as SopRow[];
  if (!isMissingColumn(r.error, "visibility")) throw new Error(`อ่าน SOP ไม่สำเร็จ: ${r.error.message}`);
  let q2 = supabase.from("menu_sops").select(cols);
  if (menuId) q2 = q2.eq("menu_id", menuId);
  const r2 = await q2;
  if (r2.error) throw new Error(`อ่าน SOP ไม่สำเร็จ: ${r2.error.message}`);
  return ((r2.data ?? []) as unknown as Omit<SopRow, "visibility">[]).map((x) => ({ ...x, visibility: "all" }));
}

/** All menus + their SOP status — used for the index/list page. */
export async function getSopList(): Promise<SopListItem[]> {
  const supabase = await createClient();

  const [{ data: menus }, sops, { data: steps }] = await Promise.all([
    supabase.from("menus").select("id, name, category").order("name"),
    readSops(supabase),
    supabase.from("menu_sop_steps").select("sop_id, section"),
  ]);

  // Count steps per section per SOP
  const stepCounts = new Map<string, Record<string, number>>();
  for (const s of steps ?? []) {
    if (!stepCounts.has(s.sop_id)) stepCounts.set(s.sop_id, { prep: 0, cook: 0, plating: 0, checklist: 0 });
    const c = stepCounts.get(s.sop_id)!;
    c[s.section] = (c[s.section] ?? 0) + 1;
  }

  const sopByMenuId = new Map<string, SopRow>();
  for (const s of sops) sopByMenuId.set(s.menu_id, s);

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
      restricted: sop?.visibility === "chosen",
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

  const [sop] = await readSops(supabase, menuId);
  if (!sop) return null;
  const menu = await getMenuOption(menuId);

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
    restricted: sop.visibility === "chosen",
    ingredients,
    prepSteps: mapSteps("prep"),
    cookSteps: mapSteps("cook"),
    platingSteps: mapSteps("plating"),
    checklist: mapSteps("checklist"),
  };
}

// ── Per-SOP "who can see" (Nik, 2026-09-26) ─────────────────────────

/**
 * An SOP's setting, for the owner/admin panel: its visibility and the chosen
 * accounts. Null before the migration adds them (the panel is not shown).
 */
export async function getSopVisibility(sopId: string): Promise<{ visibility: SopVisibility; viewerIds: string[] } | null> {
  const supabase = await createClient();
  const [sop, viewers] = await Promise.all([
    supabase.from("menu_sops").select("visibility").eq("id", sopId).maybeSingle(),
    supabase.from("menu_sop_viewers").select("profile_id").eq("sop_id", sopId),
  ]);
  if (sop.error && isMissingColumn(sop.error, "visibility")) return null;
  if (viewers.error && isMissingRelation(viewers.error)) return null;
  if (sop.error) throw new Error(`อ่านการตั้งค่า SOP ไม่สำเร็จ: ${sop.error.message}`);
  if (viewers.error) throw new Error(`อ่านรายชื่อที่เห็น SOP ไม่สำเร็จ: ${viewers.error.message}`);
  if (!sop.data) return null;
  return {
    visibility: sop.data.visibility === "chosen" ? "chosen" : "all",
    viewerIds: (viewers.data ?? []).map((v) => v.profile_id as string),
  };
}

/** The accounts that may be chosen: everyone but owner and admin (they see every SOP). */
export async function getSopTeam(): Promise<{ id: string; full_name: string; role: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("profiles").select("id, full_name, role").not("role", "in", "(owner,admin)");
  if (error) throw new Error(`อ่านรายชื่อพนักงานไม่สำเร็จ: ${error.message}`);
  const order = ["editor", "staff", "hr", "sales"];
  return (data ?? [])
    .map((p) => ({ id: p.id as string, full_name: p.full_name as string, role: p.role as string }))
    .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.full_name.localeCompare(b.full_name, "th"));
}

/**
 * For approving an SOP request: null when its sender may see the SOP of that
 * menu (or there is none yet: a new SOP is open to all), else the refusal.
 * Read with the approver's session, which sees every SOP. Fails CLOSED: a
 * read that fails refuses.
 */
export async function sopRequestRefusal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  menuId: string,
  requesterId: string,
): Promise<string | null> {
  const sop = await supabase.from("menu_sops").select("id, visibility").eq("menu_id", menuId).maybeSingle();
  if (sop.error) {
    if (isMissingColumn(sop.error, "visibility")) return null;
    return `ตรวจสิทธิ์ SOP ไม่สำเร็จ จึงยังไม่อนุมัติ: ${sop.error.message}`;
  }
  if (!sop.data || sop.data.visibility === "all") return null;
  const [who, viewers] = await Promise.all([
    supabase.from("profiles").select("id, role").eq("id", requesterId).maybeSingle(),
    supabase.from("menu_sop_viewers").select("profile_id").eq("sop_id", sop.data.id),
  ]);
  if (who.error || viewers.error) return "ตรวจสิทธิ์ SOP ไม่สำเร็จ จึงยังไม่อนุมัติ";
  const ok = sopVisibleTo(
    { visibility: sop.data.visibility as string, viewerIds: (viewers.data ?? []).map((v) => v.profile_id as string) },
    { id: requesterId, role: (who.data?.role as string | undefined) ?? null },
  );
  return ok ? null : SOP_REQUEST_REFUSAL;
}
