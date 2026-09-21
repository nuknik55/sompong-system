/**
 * "Does the page the person is looking at have unsaved work?" — asked by the
 * app shell, answered by whichever screen is open (Nik, 2026-09-20).
 *
 * WHAT IS REGISTERED TODAY: the two catering screens that hold a draft, the
 * booking screen and the per-event menu. The recipe editor and the SOP form
 * track their own edits and warn on `beforeunload`, but do NOT register
 * here, so signing out still discards those silently — wiring them up is a
 * two-line change each, not made here because neither dirty model has been
 * reviewed for false positives and a warning that cries wolf is worse than
 * none.
 *
 * WHY A REGISTRY AND NOT A PROP. The screens guard themselves: each watches
 * its own edits, warns on `beforeunload`, and catches in-app links in the
 * capture phase. ออกจากระบบ escapes all of that — it is a form submit that
 * ends in a server-side redirect, so no link is clicked and the document is
 * never unloaded. The button lives in the header, which knows nothing about
 * the page under it and is rendered by a layout that never re-renders when
 * the page's state changes. A module-level count is the smallest thing that
 * lets the header ask.
 *
 * A COUNT, NOT A FLAG, because two guarded screens can be mounted at once
 * during a navigation, and because the same screen can register twice under
 * React's development double-invocation. Releasing is idempotent for the
 * same reason: a release that ran twice would take the count below what is
 * actually dirty and the warning would go missing.
 *
 * Client-only by nature. Nothing here touches the DOM, so importing it on
 * the server is harmless; the count is simply always 0 there, and every
 * caller of confirmDiscardUnsaved is a click handler.
 */

let dirtySources = 0;

/**
 * Say that this screen now holds unsaved work. Call it from the same effect
 * that arms the screen's own leave guard, and call the returned release in
 * that effect's cleanup, so the two can never disagree.
 */
export function markUnsaved(): () => void {
  dirtySources += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    dirtySources -= 1;
  };
}

/** Is anything on screen unsaved? */
export function hasUnsavedChanges(): boolean {
  return dirtySources > 0;
}

/** Test seam: no production path resets the count. */
export function resetUnsavedForTest(): void {
  dirtySources = 0;
}

export const SIGN_OUT_UNSAVED_MSG =
  "มีการแก้ไขที่ยังไม่ได้บันทึก — ออกจากระบบโดยไม่บันทึกหรือไม่? การแก้ไขที่ค้างอยู่จะหาย";

/**
 * The prompt to use, or null when this environment has none. Exported so the
 * production branch is reachable from a test: injecting `ask` everywhere
 * left the lines that actually run in a browser with no coverage at all.
 *
 * Reading `confirm` off the object before calling it is what makes a missing
 * or non-function `confirm` a null rather than a TypeError thrown from the
 * expression itself.
 */
export function resolveAsk(win: unknown): ((m: string) => unknown) | null {
  const confirm = (win as { confirm?: unknown } | null | undefined)?.confirm;
  if (typeof confirm !== "function") return null;
  return (m: string) => (confirm as (m: string) => unknown).call(win, m);
}

/**
 * True when the caller may go ahead: nothing is unsaved, or the person said
 * so. False ONLY when they ACTIVELY CANCELLED — so a caller that treats
 * false as "do nothing" leaves them exactly where they were.
 *
 * IT FAILS OPEN, deliberately. Only an explicit `false` counts as a cancel;
 * a prompt that returns undefined — a stub, a polyfill, an embedded webview
 * — lets the action through. Stranding someone who genuinely wants to sign
 * out, on a screen with no visible reason why, is worse than losing an edit
 * they were told about; and there is no third answer to offer them.
 *
 * `ask` is injected by tests; production passes nothing.
 */
export function confirmDiscardUnsaved(message: string, ask?: (m: string) => unknown): boolean {
  if (!hasUnsavedChanges()) return true;
  const prompt = ask ?? resolveAsk(typeof window === "undefined" ? null : window);
  if (!prompt) return true;
  return prompt(message) !== false;
}
