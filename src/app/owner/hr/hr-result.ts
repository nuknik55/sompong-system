import type { HrActionResult } from "./actions";

/**
 * Item 12 adapter for the HR clients. The converted actions RETURN their
 * Thai message (production redacts a thrown Server Action message — that was
 * the defect); the HR clients all carry optimistic-rollback logic in their
 * existing catch blocks, so rather than duplicating every rollback into an
 * if-branch, the error is rethrown LOCALLY. A client-side throw is never
 * redacted — only the server->client message was — so the existing catch
 * shows the real text through the path that already owns the rollback.
 */
export function okOrThrow(result: HrActionResult): void {
  if (result.status === "error") throw new Error(result.message);
}
