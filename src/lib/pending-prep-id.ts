/**
 * Pure, so it can be tested without a database (pending-prep-id.test.ts).
 * Re-exported by @/lib/pending-data, which is server-only.
 */

/**
 * Which prep recipe a pending change is about, or null when it is not about
 * one. Used to keep a prep's composition out of the approve queue for an
 * admin who has not been granted that recipe — a recipe_edit payload carries
 * the entire item list.
 *
 * It is ALSO the prep approveChange writes to: approval uses this id rather
 * than reading the payload again, so the prep that was checked is the prep
 * that is written. Until item 31 the two could differ. A recipe_edit whose
 * target was anything but exactly "prep" skipped the check, yet approval
 * treats every target other than "menu" as a prep; and a prep_yield_edit
 * was checked on target_id but written to payload.parentId. A request's
 * payload is chosen by whoever inserts it (the table checks only
 * editor_id), so neither could be relied on to agree.
 *
 * The same mapping is written in SQL as public.pending_change_prep_id()
 * (supabase/permissions_batch_2026_09_17.sql), which the table's read
 * policy uses through public.pending_change_visible(). Change both together.
 *
 * ONE DELIBERATE DIFFERENCE in what is visible, not in the mapping: the
 * database also shows a prep_delete whose prep no longer exists, so that an
 * approval which has just deleted the prep (and, by cascade, the approver's
 * grant) can still mark the request approved. The app does not: such a
 * leftover request stays with the owner. No screen files a prep_delete.
 */
export function prepIdOfChange(changeType: string, targetId: string, payload: unknown): string | null {
  // A JSON null or array is a valid jsonb payload; read it as empty.
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
  if (changeType === "recipe_edit") return p.target === "menu" ? null : text(p.parentId) ?? targetId;
  if (changeType === "prep_yield_edit") return text(p.parentId) ?? targetId;
  if (changeType === "prep_delete") return text(p.prepId) ?? targetId;
  // A DUPLICATE is about its source: approving it copies the source's lines,
  // which approveChange refuses unless the approver can see that prep, and
  // the payload carries the source's yield. A plain new prep is about nothing
  // hidden.
  if (changeType === "prep_create") return typeof p.duplicatedFrom === "string" ? p.duplicatedFrom : null;
  return null;
}
