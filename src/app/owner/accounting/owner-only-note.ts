/**
 * The one line a non-owner sees on the money pages that leave out
 * owner-only accounts (790): break-even, the P&L summary, the printable P&L
 * and its Excel file. Nik, 2026-09-17 (queue item 32): owner-only rows are
 * hidden with no count and no "rows not shown" notice, and these four
 * outputs carry this neutral line instead.
 *
 * It depends on the role ALONE, never on the month's data, so it cannot say
 * whether anything was left out: a non-owner sees it every month, whether or
 * not 790 has entries. The owner, whose figures are whole, never sees it.
 */
export const OWNER_ONLY_NOTE = "ตัวเลขฉบับเต็มดูได้ที่บัญชีเจ้าของร้าน";

/** Everyone but the owner sees the note, an unknown or missing role included. */
export function showsOwnerOnlyNote(role: string | null | undefined): boolean {
  return role !== "owner";
}
