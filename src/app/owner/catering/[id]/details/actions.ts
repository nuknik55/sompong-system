"use server";

import { revalidatePath } from "next/cache";
import { requireSales } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  BLOCKS_PER_SHEET_MAX, SHEET_MAX_IMAGES, blockProblem, imageCount, isEventImagePath, isLibraryImagePath,
  sheetNotesProblem, type SheetBlock,
} from "@/lib/event-sheet";
import { logCateringActivity } from "../../activity-log";
import { sheetToken } from "./sheet-data";

export type SaveSheetResult = { error?: string; conflict?: boolean; token?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BAD = "ข้อมูลไม่ถูกต้อง — ยังไม่ได้บันทึกอะไร";
const CONFLICT = "ใบรายละเอียดงานนี้ถูกแก้จากที่อื่นหลังจากเปิดหน้านี้ — โหลดหน้าใหม่แล้วแก้อีกครั้ง ยังไม่ได้บันทึกอะไร";

/** The token (sheet-data.ts sheetToken) as the database function takes it; null when it is not one. */
function seenFromToken(token: string): { notes: string | null; blocks: { id: string; updated_at: string }[] } | null {
  try {
    const [notes, blocks] = JSON.parse(token) as [unknown, unknown];
    if ((notes !== null && typeof notes !== "string") || !Array.isArray(blocks)) return null;
    const parsed = blocks.map((b) => {
      const at = typeof b === "string" ? b.indexOf("@") : -1;
      return at > 0 ? { id: (b as string).slice(0, at), updated_at: (b as string).slice(at + 1) } : null;
    });
    if (parsed.some((b) => b === null)) return null;
    return { notes, blocks: parsed as { id: string; updated_at: string }[] };
  } catch {
    return null;
  }
}

/**
 * Saves a booking's event-details sheet: its job notes and its blocks, in
 * the order given (Nik, 2026-09-24).
 *
 * The same rules as the booking's other non-price fields, as the menu card
 * has them (menu-card/actions.ts): owner, admin and sales, nothing on a
 * cancelled booking, and NOTHING on a cost-locked booking for anyone. One
 * history line after the write.
 *
 * THE WRITE IS ONE DATABASE FUNCTION, catering_save_event_sheet: the notes
 * and every block in one transaction, whole or not at all, refused when the
 * sheet changed since the screen opened it (the token), with the booking row
 * locked so two saves take turns (review, 2026-09-24: a save written as
 * separate requests could leave half a sheet, and its check-then-write
 * token let two editors merge). The checks here say the same things first,
 * in the screen's words; the function decides. A library image is accepted
 * there when a library block holds it OR this booking already shows it, so a
 * library block that changed its image does not lock bookings out.
 *
 * Imports nothing that computes cost (menu-card/cost-isolation.test.ts).
 */
export async function saveEventSheet(
  eventId: string,
  token: string,
  sheet: { notes: string; blocks: SheetBlock[] },
): Promise<SaveSheetResult> {
  const profile = await requireSales();
  if (typeof eventId !== "string" || !UUID.test(eventId) || typeof token !== "string" || !sheet || typeof sheet !== "object") return { error: BAD };
  if (typeof sheet.notes !== "string") return { error: BAD };
  const notesProblem = sheetNotesProblem(sheet.notes);
  if (notesProblem) return { error: notesProblem };
  const blocks = sheet.blocks;
  if (!Array.isArray(blocks) || blocks.length > BLOCKS_PER_SHEET_MAX) return { error: BAD };
  const imageOk = (p: unknown) => isLibraryImagePath(p) || isEventImagePath(eventId, p);
  const seenIds = new Set<string>();
  for (const b of blocks) {
    if (!b || typeof b !== "object" || typeof b.id !== "string" || !UUID.test(b.id) || seenIds.has(b.id)) return { error: BAD };
    seenIds.add(b.id);
    if (b.block_id !== null && (typeof b.block_id !== "string" || !UUID.test(b.block_id))) return { error: BAD };
    const problem = blockProblem(b, imageOk);
    if (problem) return { error: problem };
  }
  if (imageCount(blocks) > SHEET_MAX_IMAGES) return { error: `ใบรายละเอียดงานมีรูปได้ไม่เกิน ${SHEET_MAX_IMAGES} รูป` };
  const seen = seenFromToken(token);
  if (!seen) return { error: CONFLICT, conflict: true };

  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("catering_save_event_sheet", {
    p_event_id: eventId,
    p_seen: seen,
    p_notes: sheet.notes.trim() === "" ? null : sheet.notes,
    p_blocks: blocks.map((b) => ({
      id: b.id, block_id: b.block_id, kind: b.kind, title: b.title,
      body: b.kind === "terms" ? b.body : null,
      image_path: b.kind === "terms" ? null : b.image_path,
      caption: b.kind === "terms" ? null : b.caption,
    })),
  });
  if (error) return { error: error.hint === "conflict" ? CONFLICT : error.message, conflict: error.hint === "conflict" };

  const images = imageCount(blocks);
  const noteCount = sheet.notes.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  await logCateringActivity(
    supabase,
    eventId,
    profile.id,
    "event_sheet_edited",
    `แก้ใบรายละเอียดงาน (${blocks.length} หัวข้อ, รูป ${images} รูป, บันทึกงาน ${noteCount} ข้อ)`,
  );
  revalidatePath(`/owner/catering/${eventId}/details`);
  revalidatePath(`/owner/catering/${eventId}`);
  // The version the function read inside its own transaction: never a later save of someone else's.
  const v = version as { notes: string | null; blocks: { id: string; updated_at: string }[] } | null;
  return { token: v ? sheetToken(v.notes, v.blocks) : undefined };
}
