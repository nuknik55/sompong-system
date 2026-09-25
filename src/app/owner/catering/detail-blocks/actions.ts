"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { blockProblem, captionProblem, isLibraryImagePath, venueTagsProblem } from "@/lib/event-sheet";

// THE EVENT-DETAILS SHEET's LIBRARIES (Nik, 2026-09-24): terms texts, and
// images (room photos, table-layout diagrams), each tagged with the venues
// it suits. Owner and admin keep them (requireAdmin; the database's write
// policies admit the same two). A booking holds its own COPY of a picked
// text, and a picked image with its own caption, so editing here never
// changes a booking's text or caption. A block or an image a booking uses
// cannot be deleted (the database's ON DELETE RESTRICT), and no file is ever
// removed from the bucket.

export type LibraryResult = { error?: string; id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PATH = "/owner/catering/detail-blocks";
const IN_USE = "ถูกใช้ในใบรายละเอียดงานของงานแล้ว จึงลบไม่ได้ (แก้ไขได้ — งานที่ใช้ไปแล้วเก็บฉบับของตัวเองไว้)";

const sortProblem = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && Math.abs(n) <= 100000 ? null : "ลำดับไม่ถูกต้อง");

export type LibraryBlockInput = { title: string; body: string; venue_tags: string[]; sort_order: number };

/** Adds a terms text (id null) or edits one. */
export async function saveLibraryBlock(id: string | null, b: LibraryBlockInput): Promise<LibraryResult> {
  const profile = await requireAdmin();
  if (id !== null && (typeof id !== "string" || !UUID.test(id))) return { error: "ข้อมูลไม่ถูกต้อง" };
  if (!b || typeof b !== "object") return { error: "ข้อมูลไม่ถูกต้อง" };
  const problem = blockProblem(b) ?? venueTagsProblem(b.venue_tags) ?? sortProblem(b.sort_order);
  if (problem) return { error: problem };
  const row = { title: b.title.trim(), body: b.body, venue_tags: b.venue_tags.map((t) => t.trim()), sort_order: b.sort_order };
  const supabase = await createClient();
  if (id === null) {
    const { data, error } = await supabase.from("catering_detail_blocks").insert({ ...row, created_by: profile.id }).select("id").single();
    if (error) return { error: error.message };
    revalidatePath(PATH);
    return { id: data.id as string };
  }
  const { error, count } = await supabase.from("catering_detail_blocks").update(row, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (count !== 1) return { error: "ไม่พบหัวข้อนี้แล้ว — โหลดหน้าใหม่" };
  revalidatePath(PATH);
  return { id };
}

/** Deletes a terms text no booking uses. */
export async function deleteLibraryBlock(id: string): Promise<LibraryResult> {
  await requireAdmin();
  if (typeof id !== "string" || !UUID.test(id)) return { error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error, count } = await supabase.from("catering_detail_blocks").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.code === "23503" ? `หัวข้อนี้${IN_USE}` : error.message };
  if (count !== 1) return { error: "ไม่พบหัวข้อนี้แล้ว — โหลดหน้าใหม่" };
  revalidatePath(PATH);
  return {};
}

export type LibraryImageInput = { name: string; caption: string | null; image_path: string; venue_tags: string[]; sort_order: number };

/**
 * Adds an image (id null; its file already uploaded to the library's folder)
 * or edits one's name, default caption, venues and order. An image's FILE is
 * never changed once saved: the bookings that picked it print it, so a new
 * picture is a new library image.
 */
export async function saveLibraryImage(id: string | null, g: LibraryImageInput): Promise<LibraryResult> {
  const profile = await requireAdmin();
  if (id !== null && (typeof id !== "string" || !UUID.test(id))) return { error: "ข้อมูลไม่ถูกต้อง" };
  if (!g || typeof g !== "object") return { error: "ข้อมูลไม่ถูกต้อง" };
  if (typeof g.name !== "string" || g.name.trim() === "" || g.name.trim().length > 200) return { error: "ใส่ชื่อรูป (ไม่เกิน 200 ตัวอักษร)" };
  const problem = captionProblem(g.caption) ?? venueTagsProblem(g.venue_tags) ?? sortProblem(g.sort_order);
  if (problem) return { error: problem };
  const row = { name: g.name.trim(), caption: g.caption?.trim() || null, venue_tags: g.venue_tags.map((t) => t.trim()), sort_order: g.sort_order };
  const supabase = await createClient();
  if (id === null) {
    if (!isLibraryImagePath(g.image_path)) return { error: "อัปโหลดรูปก่อน" };
    const { data, error } = await supabase.from("catering_detail_images").insert({ ...row, image_path: g.image_path, created_by: profile.id }).select("id").single();
    if (error) return { error: error.code === "23505" ? "รูปไฟล์นี้อยู่ในคลังแล้ว" : error.message };
    revalidatePath(PATH);
    return { id: data.id as string };
  }
  const { error, count } = await supabase.from("catering_detail_images").update(row, { count: "exact" }).eq("id", id);
  if (error) return { error: error.message };
  if (count !== 1) return { error: "ไม่พบรูปนี้แล้ว — โหลดหน้าใหม่" };
  revalidatePath(PATH);
  return { id };
}

/** Deletes a library image no booking uses. Its file stays in the bucket (nothing deletes there). */
export async function deleteLibraryImage(id: string): Promise<LibraryResult> {
  await requireAdmin();
  if (typeof id !== "string" || !UUID.test(id)) return { error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error, count } = await supabase.from("catering_detail_images").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: error.code === "23503" ? `รูปนี้${IN_USE}` : error.message };
  if (count !== 1) return { error: "ไม่พบรูปนี้แล้ว — โหลดหน้าใหม่" };
  revalidatePath(PATH);
  return {};
}
