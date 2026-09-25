"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DESIGN_PRICE_MAX, designDishKey, type DesignDish } from "@/lib/set-design";
import { menuLineQuantityError } from "../../booking-lines";
import { EVENT_MENU_SECTIONS, typedDishNameError } from "../../menu-lines";

// THE SET-MENU DESIGN WORKSPACE's writes (Nik, 2026-09-24). Owner and admin
// only (requireAdmin; the database's set-menu write policies admit the same
// two). A trial set is a catering_set_menus row with is_draft = true: the
// database hides it and its dishes from sales, keeps it off every booking,
// and never turns a real set back into one.
//
// A draft's SAVE and its MAKING REAL are each one database function, one
// transaction, under a version check (catering_save_set_draft,
// catering_make_set_real): owner and admin share drafts, so a save over
// someone else's newer one is refused, a failure writes nothing, and a set
// that has just become real is never rewritten from here (review,
// 2026-09-24). The checks below say the same things first, in the screen's
// words.

export type DesignResult = {
  error?: string;
  id?: string;
  /** The draft's updated_at after this write: the version its next save sends. */
  updatedAt?: string;
  /** Someone else saved this draft since the screen had it. Nothing was written. */
  conflict?: boolean;
};

const PATH = "/owner/catering/set-menus/design";
const NOT_A_DRAFT = "ไม่พบชุดเมนูฉบับร่างนี้ — อาจถูกทำเป็นชุดจริงหรือลบไปแล้ว กดโหลดหน้าใหม่";
const NOTE_MAX = 300;

function itemsProblem(items: unknown): string | null {
  if (!Array.isArray(items) || items.length > 60) return "รายการอาหารไม่ถูกต้อง";
  const seen = new Set<string>();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const it of items as DesignDish[]) {
    if (!it || typeof it !== "object") return "รายการอาหารไม่ถูกต้อง";
    // A menu dish OR a typed name; a link only on a typed one (the database checks the same).
    const menu = typeof it.menu_id === "string" && uuid.test(it.menu_id);
    const typed = it.menu_id == null && typeof it.dish_name === "string";
    if (!(menu && it.dish_name == null && it.linked_menu_id == null) && !typed) return "รายการอาหารไม่ถูกต้อง";
    if (typed && typedDishNameError(it.dish_name as string)) return typedDishNameError(it.dish_name as string);
    if (typed && it.linked_menu_id != null && !(typeof it.linked_menu_id === "string" && uuid.test(it.linked_menu_id))) return "รายการอาหารไม่ถูกต้อง";
    const k = designDishKey(it);
    if (seen.has(k)) return "มีเมนูเดียวกันซ้ำในชุด";
    seen.add(k);
    if (typeof it.quantity !== "number") return "จำนวนต่อชุดไม่ถูกต้อง";
    const q = menuLineQuantityError("dish", it.quantity);
    if (q) return `จำนวนต่อชุดไม่ถูกต้อง: ${q}`;
    if (!(EVENT_MENU_SECTIONS as readonly string[]).includes(it.section)) return "หมวดของเมนูไม่ถูกต้อง";
    if (it.note !== null && (typeof it.note !== "string" || it.note.length > NOTE_MAX)) return "หมายเหตุของเมนูไม่ถูกต้อง";
  }
  return null;
}

function nameProblem(name: unknown): string | null {
  return typeof name === "string" && name.trim() !== "" && name.trim().length <= 200 ? null : "ใส่ชื่อชุดเมนู (ไม่เกิน 200 ตัวอักษร)";
}

function priceProblem(price: unknown): string | null {
  return typeof price === "number" && Number.isFinite(price) && price >= 0 && price <= DESIGN_PRICE_MAX ? null : "ราคาต่อโต๊ะไม่ถูกต้อง";
}

/** A refusal from one of the draft functions, as the screen shows it. */
function refusal(error: { message: string; hint?: string | null }): DesignResult {
  return { error: error.message, conflict: error.hint === "conflict" };
}

const itemsForDb = (items: DesignDish[]) =>
  items.map((it) => ({
    menu_id: it.menu_id,
    dish_name: it.menu_id == null ? (it.dish_name ?? "").trim() : null,
    linked_menu_id: it.menu_id == null ? it.linked_menu_id ?? null : null,
    quantity: it.quantity, section: it.section, note: it.note?.trim() || null,
  }));

type Db = Awaited<ReturnType<typeof createClient>>;

async function saveThroughDb(supabase: Db, id: string, seen: string, name: string, price: number, items: DesignDish[]): Promise<DesignResult> {
  const { data, error } = await supabase.rpc("catering_save_set_draft", {
    p_id: id, p_seen: seen, p_name: name, p_price: price, p_items: itemsForDb(items),
  });
  if (error) return refusal(error);
  return { id, updatedAt: data as string };
}

/** A new trial set: empty, or a copy of a real set or of another trial set. */
export async function createDraft(
  source: { from: "scratch" } | { from: "set"; id: string } | { from: "draft"; id: string },
): Promise<DesignResult> {
  await requireAdmin();
  const supabase = await createClient();
  let name: string;
  let price = 0;
  let description: string | null = null;
  let serves: number | null = null;
  let items: DesignDish[] = [];
  if (source.from === "scratch") {
    // Numbered, so two new trial sets are told apart on the chips and lists.
    const { count, error } = await supabase.from("catering_set_menus").select("id", { count: "exact", head: true }).eq("is_draft", true);
    if (error) return { error: error.message };
    name = `ชุดทดลอง ${(count ?? 0) + 1}`;
  } else {
    const { data, error } = await supabase
      .from("catering_set_menus")
      .select("name, price_per_set, description, serves_guests, is_draft, per_head, catering_set_menu_items(menu_id, dish_name, linked_menu_id, quantity, section, note, sort_order)")
      .eq("id", source.id)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data || data.is_draft !== (source.from === "draft")) return { error: "ไม่พบชุดเมนูที่เลือก" };
    // The workspace figures cost and price PER TABLE: a per-head set copied
    // here would come out per table (review, 2026-09-25). Refused, and said.
    if (data.per_head === true) return { error: "ชุดนี้คิดราคาต่อท่าน — หน้านี้ออกแบบได้เฉพาะชุดราคาต่อโต๊ะ แก้ชุดต่อท่านในหน้าจัดการชุดเมนู" };
    name = `${String(data.name).replace(/ [(]ร่าง[)]$/, "")} (ร่าง)`.slice(0, 200);
    // To the satang, so the price field reads it back (parseDesignPrice takes two decimals).
    price = Math.round(Number(data.price_per_set ?? 0) * 100) / 100;
    description = (data.description as string | null) ?? null;
    serves = data.serves_guests == null ? null : Number(data.serves_guests);
    // A copied row is held to the workspace's rules from the start, so what
    // the old editor allowed (a long note, a fourth decimal) cannot make the
    // draft unsaveable.
    items = ((data.catering_set_menu_items as { menu_id: string | null; dish_name: string | null; linked_menu_id: string | null; quantity: number; section: string; note: string | null; sort_order: number }[] | null) ?? [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((it) => {
        const q = Math.round(Number(it.quantity) * 1000) / 1000;
        return { menu_id: it.menu_id, dish_name: it.dish_name, linked_menu_id: it.linked_menu_id, quantity: q > 0 ? q : 1, section: it.section, note: it.note ? it.note.slice(0, NOTE_MAX) : null };
      });
  }
  const { data: created, error: insError } = await supabase
    .from("catering_set_menus")
    .insert({ name, price_per_set: price, description, serves_guests: serves, is_draft: true })
    .select("id, updated_at")
    .single();
  if (insError) return { error: insError.message };
  const saved = await saveThroughDb(supabase, created.id as string, created.updated_at as string, name, price, items);
  if (saved.error) {
    // No half-made trial set left behind: the new row goes again.
    const { error: undoError } = await supabase.from("catering_set_menus").delete().eq("id", created.id).eq("is_draft", true);
    return { error: undoError ? `${saved.error} — และลบชุดที่สร้างค้างไว้ไม่สำเร็จ: ${undoError.message}` : saved.error };
  }
  revalidatePath(PATH);
  revalidatePath("/owner/catering/set-menus");
  return saved;
}

/**
 * Saves a trial set's name, price and dishes, in one transaction. `seen` is
 * the draft's updated_at as this screen last had it.
 */
export async function saveDraft(id: string, seen: string, data: { name: string; price: number; items: DesignDish[] }): Promise<DesignResult> {
  await requireAdmin();
  if (typeof id !== "string" || typeof seen !== "string") return { error: NOT_A_DRAFT };
  const problem = nameProblem(data?.name) ?? priceProblem(data?.price) ?? itemsProblem(data?.items);
  if (problem) return { error: problem };
  const supabase = await createClient();
  const saved = await saveThroughDb(supabase, id, seen, data.name.trim(), data.price, data.items);
  if (saved.error) return saved;
  revalidatePath(PATH);
  revalidatePath("/owner/catering/set-menus");
  return saved;
}

/** Deletes a trial set. A real set is never deleted from here. */
export async function deleteDraft(id: string): Promise<DesignResult> {
  await requireAdmin();
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("catering_set_menus")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("is_draft", true);
  if (error) return { error: error.message };
  if (count !== 1) return { error: NOT_A_DRAFT };
  revalidatePath(PATH);
  revalidatePath("/owner/catering/set-menus");
  return {};
}

/**
 * MAKE IT REAL: the name (prefilled with the draft's, editable) and the
 * price, then the flag cleared — from then on sales can pick it. Refused for
 * a set with no dishes and for a name a real set already has (a booking
 * refuses two sets of one name).
 */
export async function makeDraftReal(id: string, seen: string, name: string, price: number): Promise<DesignResult> {
  await requireAdmin();
  if (typeof id !== "string" || typeof seen !== "string") return { error: NOT_A_DRAFT };
  const problem = nameProblem(name) ?? priceProblem(price) ?? (price > 0 ? null : "ใส่ราคาต่อโต๊ะก่อนทำเป็นชุดจริง");
  if (problem) return { error: problem };
  const supabase = await createClient();
  const { error } = await supabase.rpc("catering_make_set_real", { p_id: id, p_seen: seen, p_name: name.trim(), p_price: price });
  if (error) return refusal(error);
  revalidatePath(PATH);
  revalidatePath("/owner/catering/set-menus");
  return { id };
}
