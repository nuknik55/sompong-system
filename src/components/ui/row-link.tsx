"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

/** The row's own look: a pointer, a hover, and a focus ring for the keyboard.
 *  (A class glued to a `${...}` is invisible to Tailwind's scanner, so the
 *  classes live here, whole.) */
const ROW =
  "cursor-pointer transition-colors hover:bg-neutral-100 focus-visible:bg-primary-soft " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary";

/** A clicked or keyboard-opened control inside the row is its own action. */
const OWN_ACTION = "a, button, input, select, textarea, label, summary, [data-row-stop]";

/**
 * A table row that opens a record: the whole row is the way in (Nik,
 * 2026-09-23), so no row carries a ดู link.
 *
 * - Clicking anywhere on the row opens `href`; Ctrl/⌘-click and a
 *   middle click open it in a new tab, as a link would.
 * - The row is focusable, Enter opens it, and focus shows a ring.
 * - A button, link or field inside the row (ลบ) does its own thing and never
 *   opens the row; so does anything inside an element marked
 *   `data-row-stop` (a cell of actions). Selecting text is not a click.
 *
 * It navigates with router.push, so it must not be used on a page with an
 * unsaved-changes guard: the guard sees link clicks, not this.
 */
export function RowLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function isOwnAction(target: EventTarget | null, row: HTMLElement): boolean {
    const hit = target instanceof Element ? target.closest(OWN_ACTION) : null;
    return hit !== null && hit !== row && row.contains(hit);
  }

  function onClick(e: MouseEvent<HTMLTableRowElement>) {
    if (isOwnAction(e.target, e.currentTarget)) return;
    if (window.getSelection()?.toString()) return;
    if (e.ctrlKey || e.metaKey) {
      window.open(href, "_blank", "noopener");
      return;
    }
    router.push(href);
  }

  function onAuxClick(e: MouseEvent<HTMLTableRowElement>) {
    if (e.button !== 1 || isOwnAction(e.target, e.currentTarget)) return;
    window.open(href, "_blank", "noopener");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.key !== "Enter" || e.target !== e.currentTarget) return;
    e.preventDefault();
    router.push(href);
  }

  return (
    <tr
      tabIndex={0}
      onClick={onClick}
      onAuxClick={onAuxClick}
      onKeyDown={onKeyDown}
      className={[ROW, className].filter(Boolean).join(" ")}
    >
      {children}
    </tr>
  );
}
