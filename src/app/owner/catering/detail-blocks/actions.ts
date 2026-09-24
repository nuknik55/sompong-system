"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { blockProblem, isLibraryImagePath, venueTagsProblem, type BlockKind } from "@/lib/event-sheet";

// THE EVENT-DETAILS SHEET's LIBRARY (Nik, 2026-09-24): terms text, room
// photos and layout diagrams, each tagged with the venues it suits. Owner and
// admin keep it (requireAdmin; the database's write policy admits the same
// two). A booking holds its own COPY of what it picked, so editing a block
// here never changes a booking's sheet. A block a booking uses cannot be
// deleted (the database's ON DELETE RESTRICT), and no image is ever removed
// from the bucket, so a booking's picked image stays.

export type LibraryResult = { error?: string; id?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PATH = "/owner/catering/detail-blocks";

export type LibraryBlockInput = {
  kind: BlockKind;
  title: string;
  body: string | null;
  image_path: string | null;
  venue_tags: string[];
  sort_order: number;
};

function inputProblem(b: LibraryBlockInput): string | null {
  if (!b || typeof b !== "object") return "ข้อมูลไม่ถูกต้อง";
  const shape = blockProblem({ kind: b.kind, title: b.title, body: b.kind === "terms" ? b.body : null, image_path: b.kind === "terms" ? null : b.image_path }, isLibraryImagePath);
  if (shape) return shape;
  if (b.kind !== "terms" && typeof b.body === "string" && b.body.length > 4000) return "ข้อความยาวเกิน 4,000 ตัวอักษร";
  const tags = venueTagsProblem(b.venue_tags);
  if (tags) return tags;
  if (!Number.isInteger(b.sort_order) || Math.abs(b.sort_order) > 100000) return "ลำดับไม่ถูกต้อง";
  return null;
}

/** Adds a block (id null) or edits one. */
export async function saveLibraryBlock(id: string | null, b: LibraryBlockInput): Promise<LibraryResult> {
  const profile = await requireAdmin();
  if (id !== null && (typeof id !== "string" || !UUID.test(id))) return { error: "ข้อมูลไม่ถูกต้อง" };
  const problem = inputProblem(b);
  if (problem) return { error: problem };
  const row = {
    kind: b.kind,
    title: b.title.trim(),
    body: b.kind === "terms" ? b.body : null,
    image_path: b.kind === "terms" ? null : b.image_path,
    venue_tags: b.venue_tags.map((t) => t.trim()),
    sort_order: b.sort_order,
  };
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

/** Deletes a block no booking uses. A used one is refused by the database; the message says why. */
export async function deleteLibraryBlock(id: string): Promise<LibraryResult> {
  await requireAdmin();
  if (typeof id !== "string" || !UUID.test(id)) return { error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error, count } = await supabase.from("catering_detail_blocks").delete({ count: "exact" }).eq("id", id);
  if (error) {
    return { error: error.code === "23503" ? "หัวข้อนี้ถูกใช้ในใบรายละเอียดงานของงานแล้ว จึงลบไม่ได้ (แก้ไขได้ — งานที่ใช้ไปแล้วเก็บฉบับของตัวเองไว้)" : error.message };
  }
  if (count !== 1) return { error: "ไม่พบหัวข้อนี้แล้ว — โหลดหน้าใหม่" };
  revalidatePath(PATH);
  return {};
}
