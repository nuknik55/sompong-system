/**
 * The page-level unsaved-changes guard, as a hook (Nik, 2026-09-21).
 *
 * While `dirty` is true, and only then, it:
 *   - asks before the browser leaves the page (close, reload, typed URL) —
 *     `beforeunload`;
 *   - asks before any in-app link navigates, caught in the CAPTURE phase so
 *     it runs before Next.js's Link handler sees the click;
 *   - tells the app shell there is unsaved work, so ออกจากระบบ asks too
 *     (src/lib/unsaved-changes.ts).
 *
 * The browser's own Back button is NOT caught, as decided everywhere else:
 * popstate cannot be refused, and the workaround breaks Back for everyone.
 *
 * Registered only while dirty, so a clean page has no listeners at all and
 * nothing can go stale — the effect re-runs when `dirty` flips, which is a
 * handful of times a session, not once per keystroke.
 *
 * THIS HOOK DOES NOT DECIDE WHAT "DIRTY" MEANS. That is each screen's job,
 * and it is where a guard goes wrong: a warning on a form nobody touched is
 * dismissed by reflex and then absent on the day it matters. Each caller
 * passes a comparison of what a save WOULD WRITE against what was last
 * clean — never a flag set on the first keystroke.
 *
 * The booking screen and the per-event menu still carry their own inline
 * copies of this code, which predate it; they behave the same except that
 * their link prompt treats a non-boolean `confirm` as a cancel, where this
 * one fails open like the sign-out guard.
 */
import { useEffect } from "react";
import { markUnsaved, resolveAsk } from "./unsaved-changes";

export const LEAVE_UNSAVED_MSG = "มีการแก้ไขที่ยังไม่ได้บันทึก — ออกจากหน้านี้โดยไม่บันทึกหรือไม่?";

export function useLeaveGuard(dirty: boolean, message: string = LEAVE_UNSAVED_MSG): void {
  useEffect(() => {
    if (!dirty) return;
    const release = markUnsaved();
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const click = (e: MouseEvent) => {
      // A modified or middle click opens a new tab and leaves this page where
      // it is: nothing to warn about, and cancelling would swallow the tab.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#") || (/^[a-z]+:/i.test(href) && !href.startsWith(location.origin))) return;
      // Fails open: only an explicit false keeps the person here.
      const ask = resolveAsk(window);
      if (ask && ask(message) === false) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      release();
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, message]);
}
