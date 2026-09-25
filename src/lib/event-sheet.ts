/**
 * THE EVENT-DETAILS SHEET's rules (ใบรายละเอียดงาน, Nik, 2026-09-24): the
 * pure half, tested (event-sheet.test.ts). The database holds the same limits
 * (catering_event_sheet_and_set_drafts_migration.sql); these are the screen's
 * copy of them, so a refusal is said before anything is sent.
 *
 * The sheet is customer-facing and goes with the quotation: the dishes, the
 * free items, the job notes, terms texts and images picked from the two
 * libraries, and images picked from the computer for one print only (never
 * uploaded). It carries no price, no cost and no kitchen note.
 */

export const SHEET_NOTES_MAX = 4000;
export const BLOCK_TITLE_MAX = 200;
export const BLOCK_BODY_MAX = 4000;
export const CAPTION_MAX = 300;
export const VENUE_TAGS_MAX = 20;
export const VENUE_TAG_MAX_LENGTH = 60;
export const BLOCKS_PER_SHEET_MAX = 40;
/** Library images one sheet may show (the database function's limit). */
export const IMAGES_PER_SHEET_MAX = 40;
/** Images picked from the computer for one print (never uploaded). */
export const PRINT_IMAGES_MAX = 6;
/** Files the image library's bucket may hold (the upload policy's cap). */
export const LIBRARY_FILES_MAX = 100;
/** The long side a library image is resized to in the browser before upload. */
export const IMAGE_LONG_SIDE = 1600;
/** The bucket's own limit (file_size_limit). */
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** What the library takes, and what the print page offers to pick. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** A terms text in the library, as the screens read it. */
export type LibraryBlock = {
  id: string;
  title: string;
  body: string;
  venue_tags: string[];
  sort_order: number;
};

/** A terms text on a booking's sheet: a copy of a library block. */
export type SheetBlock = {
  id: string;
  block_id: string;
  title: string;
  body: string;
};

/** An image in the library: a file of the private bucket, with a default caption. */
export type LibraryImage = {
  id: string;
  name: string;
  caption: string | null;
  image_path: string;
  venue_tags: string[];
  sort_order: number;
};

/** A library image on a booking's sheet, with this booking's caption (null prints the library's). */
export type SheetImage = {
  id: string;
  image_id: string;
  caption: string | null;
};

// The names the app gives library uploads, and the only ones the bucket
// accepts (catering_detail_upload_allowed): lib/, a timestamp of 10–16
// digits, a dash, 4–16 lower-case letters or digits, and .jpg, .png or .webp.
const LIB_PATH = /^lib\/[0-9]{10,16}-[0-9a-z]{4,16}[.](jpg|png|webp)$/;

export function isLibraryImagePath(p: unknown): p is string {
  return typeof p === "string" && LIB_PATH.test(p);
}

/** 8 lower-case letters or digits, from any random source that gives numbers in [0, 1). */
export function randomName(random: () => number = Math.random): string {
  const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return out;
}

export function libraryImagePath(ext: "jpg" | "png" | "webp", now: number, rand: string): string {
  return `lib/${now}-${rand}.${ext}`;
}

/** The job notes, one per line, as they print: numbered, blank lines dropped, a typed "1." not doubled. */
export function sheetNoteLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    // A typed "1." or "2)" followed by a space; never a time or a decimal
    // ("15.30 น." is a time, and printed as it was typed).
    .map((l) => l.trim().replace(/^[0-9]{1,3}[.)](\s+|$)/, "").trim())
    .filter((l) => l !== "");
}

export function sheetNotesProblem(text: unknown): string | null {
  if (text === null) return null;
  if (typeof text !== "string") return "บันทึกงานไม่ถูกต้อง";
  return text.length > SHEET_NOTES_MAX ? `บันทึกงานยาวเกิน ${SHEET_NOTES_MAX.toLocaleString("th-TH")} ตัวอักษร` : null;
}

/** Venue tags as typed: comma or line separated, trimmed, each once (case and spacing ignored). */
export function parseVenueTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const tag = raw.replace(/\s+/g, " ").trim();
    const key = tagKey(tag);
    if (tag === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function venueTagsProblem(tags: unknown): string | null {
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string" || t.trim() === "")) return "ประเภทสถานที่ไม่ถูกต้อง";
  if (tags.length > VENUE_TAGS_MAX) return `ใส่ประเภทสถานที่ได้ไม่เกิน ${VENUE_TAGS_MAX} รายการ`;
  if (tags.some((t: string) => t.length > VENUE_TAG_MAX_LENGTH)) return `ชื่อประเภทสถานที่ยาวเกิน ${VENUE_TAG_MAX_LENGTH} ตัวอักษร`;
  return null;
}

const tagKey = (t: string) => t.replace(/\s+/g, "").toLowerCase();

/**
 * A library for one booking: entries tagged with one of the booking's venue
 * names first, then the rest, each group in the library's own order. A tag
 * matches a name ignoring case and spaces ("ห้อง v1" is "ห้อง V1"). The same
 * for terms and for images.
 */
export function blocksForVenue<T extends { venue_tags: string[] }>(blocks: T[], venueNames: string[]): { matching: T[]; others: T[] } {
  const names = new Set(venueNames.filter(Boolean).map(tagKey));
  const matching: T[] = [];
  const others: T[] = [];
  for (const b of blocks) (b.venue_tags.some((t) => names.has(tagKey(t))) ? matching : others).push(b);
  return { matching, others };
}

/** Why a terms text cannot be stored, in Thai; null when it can (the database's CHECKs). */
export function blockProblem(b: { title: unknown; body: unknown }): string | null {
  if (typeof b.title !== "string" || b.title.trim() === "") return "ใส่ชื่อหัวข้อ";
  if (b.title.trim().length > BLOCK_TITLE_MAX) return `ชื่อหัวข้อยาวเกิน ${BLOCK_TITLE_MAX} ตัวอักษร`;
  if (typeof b.body !== "string" || b.body.trim() === "") return `“${b.title.trim()}”: ใส่ข้อความ`;
  if (b.body.length > BLOCK_BODY_MAX) return `ข้อความยาวเกิน ${BLOCK_BODY_MAX.toLocaleString("th-TH")} ตัวอักษร`;
  return null;
}

/** Why a caption cannot be stored; null when it can. */
export function captionProblem(c: unknown): string | null {
  if (c === null) return null;
  return typeof c === "string" && c.length <= CAPTION_MAX ? null : `คำอธิบายรูปยาวเกิน ${CAPTION_MAX} ตัวอักษร`;
}

/** The caption a sheet prints for a library image: this booking's, else the library's default. */
export function printedCaption(own: string | null, fallback: string | null): string | null {
  const t = own?.trim();
  return t ? t : fallback?.trim() || null;
}


/** A price-box line as the free mark reads it. */
export type FreeMarkLine = { kind: string; label: string; amount: number; free: boolean; unitPrice?: number };

/** May this line carry แถมฟรี at all? Rates, typed lines and single dishes; never a set or the discount. */
export function canMarkFree(kind: string): boolean {
  return kind === "dish" || kind === "rate" || kind === "manual";
}

/** Why a line marked free cannot be saved; null when it can. A free line is a ฿0 line. */
export function freeMarkProblem(l: FreeMarkLine): string | null {
  if (!l.free) return null;
  if (!canMarkFree(l.kind)) return "แถมฟรีได้เฉพาะเมนูเดี่ยวหรือรายการค่าใช้จ่าย ไม่ใช่ชุดเมนูหรือส่วนลด";
  // A dish marked free is charged ฿0 BY the mark (the screen sets it, the
  // database prices it so): no screen can price a single dish.
  if (l.kind === "dish") return null;
  if (l.amount !== 0 || (l.unitPrice ?? 0) !== 0) return "รายการแถมฟรีต้องเป็น ฿0 — ราคาต่อหน่วย 0 และยอด 0";
  return null;
}

/**
 * THE WARNING, never a block: lines at ฿0 that are not marked free. They
 * save as they are, and do NOT print under รายการแถมฟรี: a ฿0 price alone
 * never means free (Nik, 2026-09-24).
 */
export function unmarkedZeroLines(lines: FreeMarkLine[]): string[] {
  return lines
    .filter((l) => canMarkFree(l.kind) && !l.free && l.amount === 0 && l.label.trim() !== "")
    .map((l) => l.label.trim());
}

/**
 * รายการแถมฟรี as the sheet prints it: the lines marked free, then each set's
 * own "free" section, in that order, names only.
 */
export function freeItemLines(
  markedFree: { label: string; quantity: number }[],
  setFreeDishes: { name: string }[],
): string[] {
  // To three decimals, as the sheets print a quantity; one of a thing prints no count.
  const qty = (q: number) => { const r = Number(q.toFixed(3)); return r === 1 ? "" : ` × ${r}`; };
  return [
    ...markedFree.map((c) => `${c.label.trim()}${qty(c.quantity)}`),
    ...setFreeDishes.map((d) => d.name.trim()),
  ].filter((s) => s !== "");
}
