/**
 * How a role may change a recipe or an SOP. One rule, read by the pages that
 * show an editor and by the action that saves a recipe:
 *   "direct"   owner and admin: the change is saved;
 *   "request"  editor: the change becomes a request an admin approves;
 *   "view"     every other role: read-only, and no costs shown.
 *
 * An ALLOWLIST, on purpose. The recipe pages used to test
 * `role === "staff"` for read-only, and saveRecipeItems refused only staff,
 * so hr and sales got an editable editor with a cost panel, and their saves
 * reached the direct-save branch, where the table skipped their edits
 * without an error and the screen said it had saved (queue item 34). A
 * check that names the one role to exclude admits every other role,
 * including any added later.
 *
 * Pure, so every case is a test (edit-access.test.ts).
 */
export type EditAccess = "direct" | "request" | "view";

export function editAccess(role: string | null | undefined): EditAccess {
  if (role === "owner" || role === "admin") return "direct";
  if (role === "editor") return "request";
  return "view";
}
