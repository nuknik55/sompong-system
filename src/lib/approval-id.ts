import { createHash } from "node:crypto";

/**
 * The id of the row a create approval makes, DERIVED from the change id.
 *
 * Derived rather than equal to it, because a pending row's id is not
 * trustworthy: the insert policy on pending_changes checks only editor_id,
 * so a caller can choose the id. Used directly, a forged request whose id
 * equals an existing menu's or prep's id would make that row look like the
 * approval's own earlier work, and copied lines would land in it. A SHA-256
 * of the id cannot be steered onto an existing random UUID.
 *
 * Stable per change and kind, so a retry recognises the row an earlier,
 * failed attempt made (approveChange, queue item 27). Postgres accepts any 32
 * hex digits as a uuid; the version and variant nibbles are set only so the
 * value looks like one.
 */
export function approvalRowId(changeId: string, kind: "menu" | "prep"): string {
  const h = createHash("sha256").update(`approve:${kind}:${changeId}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
