/**
 * Run with: npm test — the count the app shell asks before signing out.
 *
 * Both directions matter and they are not symmetric. Losing the count
 * silently loses someone's typing; holding it too long strands someone who
 * genuinely wants to sign out, on a screen with no visible way to clear it.
 * The release is therefore idempotent AND complete.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  markUnsaved, hasUnsavedChanges, resetUnsavedForTest, confirmDiscardUnsaved, resolveAsk, SIGN_OUT_UNSAVED_MSG,
} from "./unsaved-changes.ts";

beforeEach(() => resetUnsavedForTest());

test("nothing is unsaved until a screen says so, and releasing clears it", () => {
  assert.equal(hasUnsavedChanges(), false);
  const release = markUnsaved();
  assert.equal(hasUnsavedChanges(), true);
  release();
  assert.equal(hasUnsavedChanges(), false);
});

test("RELEASING TWICE MUST NOT TAKE THE COUNT BELOW WHAT IS DIRTY", () => {
  // React invokes an effect twice in development: mount, clean up, mount.
  // A release that decremented on both cleanups would hide a real edit.
  const a = markUnsaved();
  const b = markUnsaved();
  a();
  a();
  a();
  assert.equal(hasUnsavedChanges(), true, "b is still dirty");
  b();
  assert.equal(hasUnsavedChanges(), false);
  // And the count cannot go negative and then swallow the next edit.
  b();
  const c = markUnsaved();
  assert.equal(hasUnsavedChanges(), true);
  c();
  assert.equal(hasUnsavedChanges(), false);
});

test("TWO SCREENS AT ONCE: both must release before the shell stops asking", () => {
  // A navigation can have the old screen and the new one mounted together.
  const menu = markUnsaved();
  const booking = markUnsaved();
  assert.equal(hasUnsavedChanges(), true);
  menu();
  assert.equal(hasUnsavedChanges(), true, "the booking screen is still dirty");
  booking();
  assert.equal(hasUnsavedChanges(), false);
});

test("A CLEAN PAGE NEVER ASKS — the sign-out just happens", () => {
  let asked = false;
  const spy = () => { asked = true; return false; };
  assert.equal(confirmDiscardUnsaved(SIGN_OUT_UNSAVED_MSG, spy), true);
  assert.equal(asked, false, "no prompt on a clean page");
});

test("A DIRTY PAGE ASKS, and the answer is obeyed in both directions", () => {
  const release = markUnsaved();
  assert.equal(confirmDiscardUnsaved(SIGN_OUT_UNSAVED_MSG, () => true), true, "confirmed: go ahead");
  assert.equal(confirmDiscardUnsaved(SIGN_OUT_UNSAVED_MSG, () => false), false, "cancelled: do nothing");
  // Asking does not clear the count: cancelling leaves the page exactly as
  // it was, still dirty, still guarded.
  assert.equal(hasUnsavedChanges(), true);
  release();
});

test("the message names what is at stake, in Thai", () => {
  assert.match(SIGN_OUT_UNSAVED_MSG, /ออกจากระบบ/);
  assert.match(SIGN_OUT_UNSAVED_MSG, /ยังไม่ได้บันทึก/);
});

// ── The branch that actually runs in a browser ──────────────────────────────
//
// Injecting `ask` in every test above left these lines with no coverage:
// the review found a dead guard and an uncoerced return in them, neither of
// which any test could have gone red for.

test("RESOLVING THE PROMPT: a window without a usable confirm yields null, never a thrown TypeError", () => {
  assert.equal(resolveAsk(undefined), null);
  assert.equal(resolveAsk(null), null);
  assert.equal(resolveAsk({}), null, "no confirm at all");
  assert.equal(resolveAsk({ confirm: "not a function" }), null);
  const win = { confirm: (m: string) => m === "yes" };
  const ask = resolveAsk(win)!;
  assert.equal(typeof ask, "function");
  assert.equal(ask("yes"), true);
  assert.equal(ask("no"), false);
});

test("RESOLVING THE PROMPT: confirm is called with the window as its receiver", () => {
  const win = { marker: 7, confirm(this: { marker: number }) { return this?.marker === 7; } };
  assert.equal(resolveAsk(win)!("x"), true, "an unbound confirm would lose `this`");
});

test("IT FAILS OPEN: only an explicit false strands anyone", () => {
  const release = markUnsaved();
  // The one answer that means "stay here".
  assert.equal(confirmDiscardUnsaved(SIGN_OUT_UNSAVED_MSG, () => false), false);
  // Everything else lets the person out. A confirm that returns undefined —
  // a stub, a polyfill, an embedded webview — must not trap them on a screen
  // with no visible reason why.
  for (const answer of [undefined, null, true, 0, "", "cancel"]) {
    assert.equal(confirmDiscardUnsaved(SIGN_OUT_UNSAVED_MSG, () => answer), true, `answer ${String(answer)}`);
  }
  release();
});

test("IT FAILS OPEN: no prompt available at all lets the sign-out through", () => {
  const release = markUnsaved();
  assert.equal(hasUnsavedChanges(), true);
  // resolveAsk returns null for this environment; the caller must not be
  // told "cancelled" by an environment that never asked.
  assert.equal(confirmDiscardUnsaved(SIGN_OUT_UNSAVED_MSG, resolveAsk({}) ?? undefined), true);
  release();
});
