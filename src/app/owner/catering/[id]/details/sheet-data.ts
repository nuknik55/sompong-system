import "server-only";
import { requireSales } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { freeItemLines, sheetNoteLines, type BlockKind, type LibraryBlock, type SheetBlock } from "@/lib/event-sheet";
import { readEventMenuDishes, readEventMenus } from "../../menu-read";
import { EVENT_MENU_SECTION_LIST } from "../../menu-lines";
import { LOCATION_TYPE_LABEL, VENUE_LABEL } from "../../location";
import type { DocHeaderEvent, DocHeaderSettings } from "../doc-header";

// ── THE EVENT-DETAILS SHEET's reads (Nik, 2026-09-24) ─────────────────────────
//
// Owner, admin and sales (requireSales; the database's policies admit the
// same three). COST ISOLATION: the sheet goes to the customer and a sales
// session prints it, so these reads select no price, no amount, no cost and
// no kitchen or internal note, and this file imports nothing that computes
// cost — not actions.ts, not event-menu.ts, not shared-utils.tsx.
// menu-card/cost-isolation.test.ts walks the sheet's pages and actions.

export const DETAILS_BUCKET = "catering-details";
/** How long a signed image link lives: long enough to print, short enough not to be a share link. */
const SIGNED_URL_SECONDS = 60 * 60;

export type SheetEvent = DocHeaderEvent & {
  id: string;
  status: string;
  cost_locked_at: string | null;
  sheet_notes: string | null;
  table_count: number | null;
};

export async function readSheetEvent(id: string): Promise<SheetEvent | null> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_events")
    .select("id, status, cost_locked_at, sheet_notes, table_count, quote_number, quote_revision, quoted_at, event_date, start_time, end_time, location_type, venue, room_portion, offsite_address, guest_count, catering_customers(name, company_name, contact_person, phone, address)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as unknown as Record<string, unknown>;
  const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? (v[0] as T) ?? null : (v as T | null));
  const c = one<{ name: string | null; company_name: string | null; contact_person: string | null; phone: string | null; address: string | null }>(r.catering_customers);
  return {
    id: r.id as string,
    status: r.status as string,
    cost_locked_at: (r.cost_locked_at as string | null) ?? null,
    sheet_notes: (r.sheet_notes as string | null) ?? null,
    table_count: r.table_count == null ? null : Number(r.table_count),
    quote_number: (r.quote_number as string | null) ?? null,
    quote_revision: Number(r.quote_revision ?? 0),
    quoted_at: (r.quoted_at as string | null) ?? null,
    customer_name: c?.name ?? null,
    customer_company_name: c?.company_name ?? null,
    customer_contact_person: c?.contact_person ?? null,
    customer_phone: c?.phone ?? null,
    customer_address: c?.address ?? null,
    event_date: r.event_date as string,
    start_time: (r.start_time as string | null) ?? null,
    end_time: (r.end_time as string | null) ?? null,
    location_type: r.location_type as string,
    venue: (r.venue as string | null) ?? null,
    room_portion: (r.room_portion as string | null) ?? null,
    offsite_address: (r.offsite_address as string | null) ?? null,
    guest_count: r.guest_count == null ? null : Number(r.guest_count),
  };
}

/** The letterhead's company lines. Never the bank: the sheet asks for no money. */
export async function readSheetSettings(): Promise<DocHeaderSettings | null> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_settings")
    .select("company_name, address, tax_id, phone")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The names a library block's venue tags are matched against: the room, and inside or outside. */
export function venueNames(e: { location_type: string; venue: string | null }): string[] {
  const out = [LOCATION_TYPE_LABEL[e.location_type] ?? ""];
  if (e.location_type === "in_house" && e.venue) out.push(VENUE_LABEL[e.venue] ?? e.venue);
  return out.filter(Boolean);
}

export type StoredSheetBlock = SheetBlock & { updated_at: string };

export async function readSheetBlocks(eventId: string): Promise<StoredSheetBlock[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_event_detail_blocks")
    .select("id, block_id, kind, title, body, image_path, caption, updated_at")
    .eq("event_id", eventId)
    .order("sort_order")
    .order("id");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    block_id: (r.block_id as string | null) ?? null,
    kind: r.kind as BlockKind,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    image_path: (r.image_path as string | null) ?? null,
    caption: (r.caption as string | null) ?? null,
    updated_at: r.updated_at as string,
  }));
}

export async function readLibraryBlocks(): Promise<LibraryBlock[]> {
  await requireSales();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_detail_blocks")
    .select("id, kind, title, body, image_path, venue_tags, sort_order")
    .order("sort_order")
    .order("title")
    .order("id");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: r.kind as BlockKind,
    title: r.title as string,
    body: (r.body as string | null) ?? null,
    image_path: (r.image_path as string | null) ?? null,
    venue_tags: (r.venue_tags as string[] | null) ?? [],
    sort_order: Number(r.sort_order ?? 0),
  }));
}

/**
 * The sheet's conflict token: its notes and every block's id and last change.
 * A save sends the token its screen opened with and is refused when the sheet
 * has changed since, so two people cannot silently overwrite each other.
 */
export function sheetToken(notes: string | null, blocks: { id: string; updated_at: string }[]): string {
  return JSON.stringify([notes, blocks.map((b) => `${b.id}@${b.updated_at}`)]);
}

/** Signed links for the bucket's private images, read with the caller's own session (its read policy decides). */
export async function signImages(paths: (string | null)[]): Promise<Record<string, string>> {
  await requireSales();
  const unique = [...new Set(paths.filter((p): p is string => typeof p === "string"))];
  if (unique.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(DETAILS_BUCKET).createSignedUrls(unique, SIGNED_URL_SECONDS);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl && !d.error) out[d.path] = d.signedUrl;
  return out;
}

export type SheetMenu = { name: string; quantity: number; sections: { label: string; dishes: string[] }[] };

/** Everything the printed sheet shows, and nothing it does not. */
export type SheetContent = {
  event: SheetEvent;
  settings: DocHeaderSettings | null;
  sets: SheetMenu[];
  extras: { name: string; quantity: number }[];
  free: string[];
  notes: string[];
  blocks: (SheetBlock & { url: string | null })[];
};

/** A booking id as the address bar may carry it: anything else is a page not found, never a database error. */
export const isBookingId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);

/** Nothing to print: no food, no free item, no note, no block. The quotation appends the sheet otherwise. */
export function sheetIsEmpty(c: SheetContent): boolean {
  return c.sets.length === 0 && c.extras.length === 0 && c.free.length === 0 && c.notes.length === 0 && c.blocks.length === 0;
}

export async function readSheetContent(eventId: string): Promise<SheetContent | null> {
  await requireSales();
  const event = await readSheetEvent(eventId);
  if (!event) return null;
  const supabase = await createClient();
  const [settings, menus, dishesByLine, blocks, freeRes] = await Promise.all([
    readSheetSettings(),
    readEventMenus(eventId),
    readEventMenuDishes(eventId),
    readSheetBlocks(eventId),
    // The lines marked แถมฟรี: their names and counts only, never a price.
    // A rate's line by the rate's customer name, as the quotation prints it.
    supabase
      .from("catering_event_charges")
      .select("label, quantity, event_menu_id, catering_rates(display_label)")
      .eq("event_id", eventId)
      .eq("is_free", true)
      .order("sort_order")
      .order("id"),
  ]);
  if (freeRes.error) throw freeRes.error;
  const freeCharges = ((freeRes.data ?? []) as { label: string; quantity: number; event_menu_id: string | null; catering_rates: { display_label: string | null } | { display_label: string | null }[] | null }[])
    .map((c) => {
      const rate = Array.isArray(c.catering_rates) ? c.catering_rates[0] ?? null : c.catering_rates;
      return { label: rate?.display_label ?? c.label, quantity: c.quantity, event_menu_id: c.event_menu_id };
    });
  const freeLineIds = new Set(freeCharges.map((c) => c.event_menu_id).filter(Boolean));

  const sets: SheetMenu[] = [];
  const setFree: { name: string }[] = [];
  for (const m of menus) {
    if (m.kind !== "set") continue;
    const dishes = dishesByLine.get(m.id)?.dishes ?? [];
    // Dish names only: a dish's note is the kitchen's, never the customer's.
    sets.push({
      name: m.name,
      quantity: Number(m.quantity),
      sections: EVENT_MENU_SECTION_LIST
        .filter((s) => s.value !== "free")
        .map((s) => ({ label: s.label, dishes: dishes.filter((d) => d.section === s.value).map((d) => d.menu_name) }))
        .filter((s) => s.dishes.length > 0),
    });
    for (const d of dishes) if (d.section === "free") setFree.push({ name: d.menu_name });
  }
  const extras = menus
    .filter((m) => m.kind !== "set" && !freeLineIds.has(m.id))
    .map((m) => ({ name: m.name, quantity: Number(m.quantity) }));

  const urls = await signImages(blocks.map((b) => b.image_path));
  return {
    event,
    settings,
    sets,
    extras,
    free: freeItemLines(freeCharges.map((c) => ({ label: c.label, quantity: Number(c.quantity) })), setFree),
    notes: sheetNoteLines(event.sheet_notes),
    blocks: blocks.map((b) => ({
      id: b.id, block_id: b.block_id, kind: b.kind, title: b.title, body: b.body, image_path: b.image_path, caption: b.caption,
      url: b.image_path ? urls[b.image_path] ?? null : null,
    })),
  };
}
