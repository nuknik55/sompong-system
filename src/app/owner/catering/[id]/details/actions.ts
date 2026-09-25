"use server";

import { revalidatePath } from "next/cache";
import { requireSales } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  BLOCKS_PER_SHEET_MAX, IMAGES_PER_SHEET_MAX, blockProblem, captionProblem, sheetNotesProblem, type SheetBlock, type SheetImage,
} from "@/lib/event-sheet";
import { logCateringActivity } from "../../activity-log";
import { sheetToken } from "./sheet-data";

export type SaveSheetResult = { error?: string; conflict?: boolean; token?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BAD = "ข้อมูลไม่ถูกต้อง — ยังไม่ได้บันทึกอะไร";
const CONFLICT = "ใบรายละเอียดงานนี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง ยังไม่ได้บันทึกอะไร";

type Version = { id: string; updated_at: string };

/** The token (sheet-data.ts sheetToken) as the database function takes it; null when it is not one. */
function seenFromToken(token: string): { notes: string | null; blocks: Version[]; images: Version[] } | null {
  const parse = (list: unknown): Version[] | null => {
    if (!Array.isArray(list)) return null;
    const out: Version[] = [];
    for (const x of list) {
      const at = typeof x === "string" ? x.indexOf("@") : -1;
      if (at <= 0) return null;
      out.push({ id: (x as string).slice(0, at), updated_at: (x as string).slice(at + 1) });
    }
    return out;
  };
  try {
    const [notes, blocks, images] = JSON.parse(token) as [unknown, unknown, unknown];
    if (notes !== null && typeof notes !== "string") return null;
    const b = parse(blocks);
    const g = parse(images);
    return b && g ? { notes, blocks: b, images: g } : null;
  } catch {
    return null;
  }
}

/**
 * Saves a booking's event-details sheet: its job notes, its picked terms and
 * its picked library images, in the order given (Nik, 2026-09-24). Images
 * picked from the computer for one print are never sent here: they stay in
 * the browser that prints them.
 *
 * The same rules as the booking's other non-price fields, as the menu card
 * has them (menu-card/actions.ts): owner, admin and sales, nothing on a
 * cancelled booking, and NOTHING on a cost-locked booking for anyone. One
 * history line after the write.
 *
 * THE WRITE IS ONE DATABASE FUNCTION, catering_save_event_sheet: everything
 * in one transaction, whole or not at all, refused when the sheet changed
 * since the screen opened it (the token), with the booking row locked so two
 * saves take turns. The checks here say the same things first, in the
 * screen's words; the function decides.
 *
 * Imports nothing that computes cost (menu-card/cost-isolation.test.ts).
 */
export async function saveEventSheet(
  eventId: string,
  token: string,
  sheet: { notes: string; blocks: SheetBlock[]; images: SheetImage[] },
): Promise<SaveSheetResult> {
  const profile = await requireSales();
  if (typeof eventId !== "string" || !UUID.test(eventId) || typeof token !== "string" || !sheet || typeof sheet !== "object") return { error: BAD };
  if (typeof sheet.notes !== "string") return { error: BAD };
  const notesProblem = sheetNotesProblem(sheet.notes);
  if (notesProblem) return { error: notesProblem };
  const { blocks, images } = sheet;
  if (!Array.isArray(blocks) || blocks.length > BLOCKS_PER_SHEET_MAX) return { error: BAD };
  if (!Array.isArray(images) || images.length > IMAGES_PER_SHEET_MAX) return { error: BAD };
  const ids = new Set<string>();
  for (const b of blocks) {
    if (!b || typeof b !== "object" || typeof b.id !== "string" || !UUID.test(b.id) || ids.has(b.id)) return { error: BAD };
    if (typeof b.block_id !== "string" || !UUID.test(b.block_id)) return { error: BAD };
    ids.add(b.id);
    const problem = blockProblem(b);
    if (problem) return { error: problem };
  }
  const picked = new Set<string>();
  for (const g of images) {
    if (!g || typeof g !== "object" || typeof g.id !== "string" || !UUID.test(g.id) || ids.has(g.id)) return { error: BAD };
    if (typeof g.image_id !== "string" || !UUID.test(g.image_id)) return { error: BAD };
    if (picked.has(g.image_id)) return { error: "เลือกรูปเดียวกันซ้ำในใบรายละเอียดงาน" };
    ids.add(g.id);
    picked.add(g.image_id);
    const problem = captionProblem(g.caption);
    if (problem) return { error: problem };
  }
  const seen = seenFromToken(token);
  if (!seen) return { error: CONFLICT, conflict: true };

  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("catering_save_event_sheet", {
    p_event_id: eventId,
    p_seen: seen,
    p_notes: sheet.notes.trim() === "" ? null : sheet.notes,
    p_blocks: blocks.map((b) => ({ id: b.id, block_id: b.block_id, title: b.title, body: b.body })),
    p_images: images.map((g) => ({ id: g.id, image_id: g.image_id, caption: g.caption })),
  });
  if (error) return { error: error.hint === "conflict" ? CONFLICT : error.message, conflict: error.hint === "conflict" };

  const noteCount = sheet.notes.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  await logCateringActivity(
    supabase,
    eventId,
    profile.id,
    "event_sheet_edited",
    `แก้ใบรายละเอียดงาน (${blocks.length} หัวข้อ, รูปจากคลัง ${images.length} รูป, บันทึกงาน ${noteCount} ข้อ)`,
  );
  revalidatePath(`/owner/catering/${eventId}/details`);
  revalidatePath(`/owner/catering/${eventId}`);
  // The version the function read inside its own transaction: never a later save of someone else's.
  const v = version as { notes: string | null; blocks: Version[]; images: Version[] } | null;
  return { token: v ? sheetToken(v.notes, v.blocks, v.images) : undefined };
}
